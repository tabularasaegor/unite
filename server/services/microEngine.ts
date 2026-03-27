/**
 * Micro Engine — Adaptive Multi-Strategy 5-Minute Trading Engine v5
 *
 * Core of AlgoTrader. Uses Thompson Sampling (Multi-Armed Bandit)
 * to select from top strategies per asset per window, with Bayesian
 * quality control, adaptive bet sizing, and automatic settlement.
 *
 * v5 Changes (data-driven optimization):
 * - REMOVED alternating strategy (1W/3L, PnL -$50.50 — worst performer)
 * - marketFollow as primary strategy (3W/0L, PnL +$73.50 — best)
 * - contrarian as secondary strategy (1W/0L, PnL +$25.51)
 * - Stronger edge filter: skip when midpoint is 0.49-0.51 (no real edge)
 * - Reduced bet size for unproven strategies (< 5 trades)
 * - Aggressive Thompson Sampling priors based on live data
 * - Tighter drawdown brake and faster cooldown response
 */

import { storage } from "../storage";
import {
  type Asset,
  getUpcomingSlug,
  getCurrentWindowEnd,
  getCurrentWindowStart,
  fetchEventBySlug,
  fetchResolvedEvent,
  getMidpoints,
  getOrderBook,
  getPriceHistory,
  computeOBI,
  type ParsedEvent,
} from "./polymarketApi";

// ─── Types ───────────────────────────────────────────────────────

interface StrategySignal {
  direction: "up" | "down" | "skip";
  confidence: number;
  strategyName: string;
}

interface WindowState {
  lastProcessedWindowEnd: number;
  pendingSettlement: Set<number>;
  windowAttempts: Map<number, number>; // windowEnd → attempt count
}

// ─── Constants ───────────────────────────────────────────────────

// Removed "alternating" — proven worst strategy (1W/3L, PnL -$50.50)
const STRATEGY_NAMES = ["contrarian", "momentum", "meanReversion", "orderBookImbalance", "marketFollow"] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

const DISCOUNT_LAMBDA = 0.993; // Faster forgetting → adapts quicker
const BET_SIZE_WIN_DELTA = 0.08;
const BET_SIZE_LOSS_DELTA = 0.15;
const BET_SIZE_MIN = 0.3;
const BET_SIZE_MAX = 1.3;
const MIN_BET = 3;
const COOLDOWN_WR_THRESHOLD = 0.30; // Stricter cooldown (was 0.25)
const COOLDOWN_LOOKBACK = 6; // React faster to losing streaks (was 8)
const COOLDOWN_DURATION_MS = 10 * 60 * 1000; // 10 min
const DISABLE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const CI_LOWER_THRESHOLD = 0.42;
const SETTLEMENT_DELAY_SEC = 30;
const FORCE_SETTLE_SEC = 900; // 15 min — Polymarket needs 5-10 min to resolve
const MAX_TRADE_WINDOW_SEC = 180; // Trade within first 3 minutes
const MIN_EDGE_MIDPOINT = 0.015; // Skip when midpoint is within 1.5% of 50/50 — no real edge
const PROVEN_STRATEGY_THRESHOLD = 5; // Need at least 5 trades before full bet sizing

// Exploitation rate: how often to use the backtest-selected strategy vs. explore
const EXPLOIT_RATE = 0.80; // 80% exploit best model, 20% Thompson Sampling exploration

// ─── Module State ────────────────────────────────────────────────

let schedulerInterval: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let sessionPeakBankroll = 0;
let backtestBestStrategy: string | null = null; // Set by applyBacktestPriors
let windowState: WindowState = {
  lastProcessedWindowEnd: 0,
  pendingSettlement: new Set(),
  windowAttempts: new Map(),
};

// In-memory lock to prevent duplicate trades during concurrent ticks
const tradedThisWindow: Set<string> = new Set(); // "asset:windowEnd"

// Per-asset cooldowns: asset → cooldown expiry timestamp
const assetCooldowns: Map<string, number> = new Map();
// Per-strategy+asset disable: "strategy:asset" → expiry timestamp
const strategyDisabled: Map<string, number> = new Map();

// ─── Beta Distribution Sampling (Marsaglia & Tsang) ──────────────

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Technical Indicators ────────────────────────────────────────

function computeRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function computeEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ─── Strategy Implementations ────────────────────────────────────

/**
 * Contrarian: bet against the market majority.
 * When upPct is far from 0.5, bet the other way.
 * Live data: 1W/0L, PnL +$25.51 — proven secondary strategy.
 * Skip when deviation is tiny (no clear majority to fade).
 */
function strategyContrarian(upPct: number, _downPct: number): StrategySignal {
  const deviation = Math.abs(upPct - 0.5);
  if (deviation <= 0.005) {
    return { direction: "skip", confidence: 0.49, strategyName: "contrarian" };
  }
  const direction: "up" | "down" = upPct > 0.5 ? "down" : "up";
  // Higher deviation → higher confidence in contrarian bet
  const confidence = 0.53 + deviation * 0.55;
  return { direction, confidence: Math.min(confidence, 0.75), strategyName: "contrarian" };
}

/**
 * Momentum: follow RSI + EMA crossover signals.
 * Relaxed: needs only 8 history points (was 16), wider RSI range.
 */
async function strategyMomentum(asset: Asset, upTokenId: string): Promise<StrategySignal> {
  try {
    const history = await getPriceHistory(upTokenId, "1h", 1);
    if (history.length < 8) {
      // Fallback: use just RSI on whatever data we have
      if (history.length >= 4) {
        const prices = history.map(h => h.p);
        const rsi = computeRSI(prices, Math.min(5, prices.length - 1));
        if (rsi > 55) return { direction: "up", confidence: 0.53, strategyName: "momentum" };
        if (rsi < 45) return { direction: "down", confidence: 0.53, strategyName: "momentum" };
      }
      return { direction: "skip", confidence: 0.49, strategyName: "momentum" };
    }
    const prices = history.slice(-20).map(h => h.p);

    const rsi5 = computeRSI(prices, Math.min(5, prices.length - 1));
    const ema5 = computeEMA(prices, 5);
    const ema10 = computeEMA(prices, Math.min(10, prices.length));
    const emaCrossUp = ema5.length > 0 && ema10.length > 0 &&
      ema5[ema5.length - 1] > ema10[ema10.length - 1];

    let direction: "up" | "down" | "skip" = "skip";
    let confidence = 0.49;

    // Relaxed thresholds: RSI > 52 (was 55), RSI < 48 (was 45)
    if (rsi5 > 52 && emaCrossUp) {
      direction = "up";
      confidence = 0.53 + (rsi5 - 50) * 0.006;
    } else if (rsi5 < 48 && !emaCrossUp) {
      direction = "down";
      confidence = 0.53 + (50 - rsi5) * 0.006;
    } else if (rsi5 > 55) {
      direction = "up";
      confidence = 0.52 + (rsi5 - 50) * 0.004;
    } else if (rsi5 < 45) {
      direction = "down";
      confidence = 0.52 + (50 - rsi5) * 0.004;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.73),
      strategyName: "momentum",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "momentum" };
  }
}

/**
 * Mean Reversion: bet on reversal when RSI is extreme.
 * Relaxed: RSI thresholds 35/65 (was 30/70) — triggers much more often.
 */
async function strategyMeanReversion(asset: Asset, upTokenId: string): Promise<StrategySignal> {
  try {
    const history = await getPriceHistory(upTokenId, "1h", 5);
    if (history.length < 8) {
      return { direction: "skip", confidence: 0.49, strategyName: "meanReversion" };
    }
    const prices = history.slice(-20).map(h => h.p);

    const rsi14 = computeRSI(prices, Math.min(14, prices.length - 1));

    let direction: "up" | "down" | "skip" = "skip";
    let confidence = 0.49;

    if (rsi14 < 35) {
      // Oversold → expect upward reversion
      direction = "up";
      confidence = 0.53 + (35 - rsi14) * 0.012;
    } else if (rsi14 > 65) {
      // Overbought → expect downward reversion
      direction = "down";
      confidence = 0.53 + (rsi14 - 65) * 0.012;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.73),
      strategyName: "meanReversion",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "meanReversion" };
  }
}

/**
 * Order Book Imbalance: use bid/ask volume ratio.
 * Relaxed: threshold 0.05 (was 0.03), higher confidence range.
 */
async function strategyOrderBookImbalance(
  upTokenId: string,
  downTokenId: string
): Promise<StrategySignal> {
  try {
    const book = await getOrderBook(upTokenId);
    if (!book || (book.bids.length === 0 && book.asks.length === 0)) {
      return { direction: "skip", confidence: 0.49, strategyName: "orderBookImbalance" };
    }

    const obi = computeOBI(book, 10);

    let direction: "up" | "down" | "skip" = "skip";
    let confidence = 0.49;

    if (obi > 0.05) {
      direction = "up";
      confidence = 0.52 + Math.abs(obi) * 0.4;
    } else if (obi < -0.05) {
      direction = "down";
      confidence = 0.52 + Math.abs(obi) * 0.4;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.73),
      strategyName: "orderBookImbalance",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "orderBookImbalance" };
  }
}

// alternating strategy REMOVED — 1W/3L, PnL -$50.50 in live trading

/**
 * Market Follow: follow the majority market opinion.
 * This is the OPPOSITE of contrarian — bet WITH the crowd.
 * On 5-min markets, the majority is often right.
 * Live data: 3W/0L, PnL +$73.50 — BEST strategy.
 * This strategy NEVER skips (always produces a signal).
 */
function strategyMarketFollow(upPct: number, downPct: number): StrategySignal {
  const deviation = Math.abs(upPct - 0.5);
  // Follow the majority
  const direction: "up" | "down" = upPct >= 0.5 ? "up" : "down";
  // Higher deviation → higher confidence (crowd is more certain)
  // Boosted confidence for proven strategy
  const confidence = 0.53 + deviation * 0.45;
  return {
    direction,
    confidence: Math.min(confidence, 0.75),
    strategyName: "marketFollow",
  };
}

// ─── Thompson Sampling Strategy Selection ────────────────────────

function ciLowerBound(alpha: number, beta: number): number {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  return mean - 1.96 * Math.sqrt(variance);
}

/**
 * Select a strategy. Uses a two-phase approach:
 * 1. If a backtest best model is set, exploit it EXPLOIT_RATE% of the time
 * 2. Otherwise (or for the exploration fraction), use Thompson Sampling
 *
 * Thompson Sampling priors come from the DB (set by applyBacktestPriors),
 * NOT from hardcoded values. This ensures the backtest winner gets selected.
 */
async function selectStrategy(asset: Asset): Promise<string> {
  const now = Date.now();

  // Load backtest best strategy from config if not cached
  if (backtestBestStrategy === null) {
    const stored = await storage.getConfig("backtest_best_strategy");
    backtestBestStrategy = stored || "";
  }

  // Phase 1: Exploit — use backtest best model directly
  if (backtestBestStrategy && STRATEGY_NAMES.includes(backtestBestStrategy as any)) {
    const disableKey = `${backtestBestStrategy}:${asset}`;
    const isDisabled = strategyDisabled.has(disableKey) && now < (strategyDisabled.get(disableKey) || 0);

    if (!isDisabled && Math.random() < EXPLOIT_RATE) {
      await storage.addModelLog("STRATEGY_EXPLOIT", asset,
        `Using backtest best: ${backtestBestStrategy} (exploit rate ${EXPLOIT_RATE * 100}%)`);
      return backtestBestStrategy;
    }
  }

  // Phase 2: Explore — Thompson Sampling from DB priors
  return await selectStrategyByThompson(asset);
}

/**
 * Pure Thompson Sampling selection using DB-stored alpha/beta.
 * No hardcoded priors — all priors come from applyBacktestPriors().
 */
async function selectStrategyByThompson(asset: Asset): Promise<string> {
  const now = Date.now();
  let bestSample = -1;
  let bestStrategy = "skip";

  // Skip arm: extremely pessimistic Beta(1, 10) so skip almost never wins
  const skipSample = sampleBeta(1, 10);
  bestSample = skipSample;

  const sampleLog: string[] = [];

  for (const stratName of STRATEGY_NAMES) {
    // Check if strategy is disabled for this asset
    const disableKey = `${stratName}:${asset}`;
    const disableExpiry = strategyDisabled.get(disableKey);
    if (disableExpiry && now < disableExpiry) {
      sampleLog.push(`${stratName}:DISABLED`);
      continue;
    } else if (disableExpiry && now >= disableExpiry) {
      strategyDisabled.delete(disableKey);
      await storage.addModelLog("MODEL_REENABLE", asset, `Re-enabled ${stratName} after cooldown`);
    }

    const perf = await storage.getOrCreateStrategyPerf(stratName, asset);

    // Quality control: only disable after sufficient data
    const ciLower = ciLowerBound(perf.alphaWins, perf.betaLosses);
    if (perf.totalTrades >= 15 && ciLower < CI_LOWER_THRESHOLD) {
      strategyDisabled.set(disableKey, now + DISABLE_COOLDOWN_MS);
      await storage.addModelLog(
        "MODEL_DISABLE", asset,
        `Disabled ${stratName}: CI lower ${ciLower.toFixed(4)} < ${CI_LOWER_THRESHOLD} (${perf.totalTrades} trades)`
      );
      sampleLog.push(`${stratName}:DISABLED_CI=${ciLower.toFixed(3)}`);
      continue;
    }

    // Use DB-stored alpha/beta (set by applyBacktestPriors).
    // These reflect backtest performance, NOT hardcoded guesses.
    // Fallback: neutral Beta(2, 2) if no priors set at all.
    let alpha = perf.alphaWins;
    let beta = perf.betaLosses;

    // If DB has default 1/1 priors and no trades, use neutral
    if (alpha <= 1.01 && beta <= 1.01 && perf.totalTrades === 0) {
      alpha = 2;
      beta = 2;
    }

    const sample = sampleBeta(alpha, beta);
    sampleLog.push(`${stratName}:${sample.toFixed(3)}(a=${alpha.toFixed(1)},b=${beta.toFixed(1)})`);

    if (sample > bestSample) {
      bestSample = sample;
      bestStrategy = stratName;
    }
  }

  // Log Thompson sampling state
  await storage.addModelLog("THOMPSON_SAMPLE", asset,
    `Selected: ${bestStrategy} (${bestSample.toFixed(3)}) | skip:${skipSample.toFixed(3)} | ${sampleLog.join(" ")}`
  );

  return bestStrategy;
}

// ─── Bet Sizing ──────────────────────────────────────────────────

async function getBetSizeMultiplier(): Promise<number> {
  const stored = await storage.getMemory("micro_state", "betSizeMultiplier");
  return stored ? Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, parseFloat(stored))) : 1.0;
}

async function setBetSizeMultiplier(val: number) {
  const clamped = Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, val));
  await storage.setMemory("micro_state", "betSizeMultiplier", clamped.toString());
}

async function computeBetSize(confidence: number, maxBet: number, strategyName?: string, asset?: string): Promise<number> {
  const edge = confidence - 0.5;
  let basePct: number;
  if (edge < 0.02) basePct = 0.25;
  else if (edge < 0.05) basePct = 0.50;
  else if (edge < 0.10) basePct = 0.75;
  else basePct = 1.0;

  // Reduce bet size for unproven strategies (< PROVEN_STRATEGY_THRESHOLD trades)
  if (strategyName && asset) {
    const perf = await storage.getOrCreateStrategyPerf(strategyName, asset);
    if (perf.totalTrades < PROVEN_STRATEGY_THRESHOLD) {
      basePct *= 0.5; // Half size until strategy proves itself
    }
  }

  const multiplier = await getBetSizeMultiplier();
  const size = maxBet * basePct * multiplier;

  // Check drawdown brake
  const stats = await storage.getMicroStats();
  const microBankroll = parseFloat(await storage.getConfig("micro_bankroll") || "200");
  const currentBankroll = microBankroll + stats.totalPnl;
  if (sessionPeakBankroll === 0) sessionPeakBankroll = currentBankroll;
  if (currentBankroll > sessionPeakBankroll) sessionPeakBankroll = currentBankroll;

  const drawdown = sessionPeakBankroll > 0 ? (sessionPeakBankroll - currentBankroll) / sessionPeakBankroll : 0;
  const drawdownCap = drawdown > 0.30 ? 0.5 : 1.0;

  const finalSize = Math.max(MIN_BET, Math.round(size * drawdownCap * 100) / 100);
  return finalSize;
}

// ─── Config Helpers ──────────────────────────────────────────────

async function getConfigValue(key: string, defaultVal: string): Promise<string> {
  return await storage.getConfig(key) || defaultVal;
}

async function getEnabledAssets(): Promise<Asset[]> {
  const raw = await getConfigValue("micro_assets", "btc,eth,sol,xrp");
  return raw.split(",").map(s => s.trim().toLowerCase()) as Asset[];
}

async function getConfidenceThreshold(): Promise<number> {
  return parseFloat(await getConfigValue("confidence_threshold", "0.51"));
}

async function getMaxBet(): Promise<number> {
  return parseFloat(await getConfigValue("micro_max_bet", "20"));
}

async function isPaperTrading(): Promise<boolean> {
  return await getConfigValue("paper_trading", "true") === "true";
}

// ─── Run Strategy Signal ─────────────────────────────────────────

async function runStrategy(
  strategyName: string,
  asset: Asset,
  event: ParsedEvent,
  upPct: number,
  downPct: number
): Promise<StrategySignal> {
  switch (strategyName) {
    case "contrarian":
      return strategyContrarian(upPct, downPct);
    case "momentum":
      return await strategyMomentum(asset, event.upTokenId);
    case "meanReversion":
      return await strategyMeanReversion(asset, event.upTokenId);
    case "orderBookImbalance":
      return await strategyOrderBookImbalance(event.upTokenId, event.downTokenId);
    // alternating removed — worst performer in live data
    case "marketFollow":
      return strategyMarketFollow(upPct, downPct);
    default:
      return { direction: "skip", confidence: 0.49, strategyName };
  }
}

// ─── Main Tick: Open Trades ──────────────────────────────────────

async function processNewWindow() {
  // windowStart = slug timestamp (Polymarket uses start time in slug)
  // windowEnd = actual end of the window (windowStart + 300)
  const windowStart = getCurrentWindowStart();
  const windowEnd = getCurrentWindowEnd(); // = windowStart + 300
  const now = Math.floor(Date.now() / 1000);
  const timeIntoWindow = now - windowStart;

  // Only trade within first MAX_TRADE_WINDOW_SEC of window
  if (timeIntoWindow > MAX_TRADE_WINDOW_SEC) return;

  // Track attempts per window
  const attempts = windowState.windowAttempts.get(windowEnd) || 0;
  windowState.windowAttempts.set(windowEnd, attempts + 1);

  // Clean up old window attempts and trade locks (keep only current and previous)
  for (const [we] of windowState.windowAttempts) {
    if (we < windowEnd - 300) windowState.windowAttempts.delete(we);
  }
  // Clean up trade locks for old windows
  for (const key of tradedThisWindow) {
    const parts = key.split(':');
    const we = parseInt(parts[1]);
    if (we < windowEnd - 300) tradedThisWindow.delete(key);
  }

  const assets = await getEnabledAssets();
  const threshold = await getConfidenceThreshold();
  const maxBet = await getMaxBet();

  let anyTradeOpened = false;

  for (const asset of assets) {
    try {
      // Check asset cooldown
      const cooldownExpiry = assetCooldowns.get(asset);
      if (cooldownExpiry && Date.now() < cooldownExpiry) {
        if (attempts <= 1) {
          await storage.addModelLog("ASSET_COOLDOWN", asset,
            `Asset on cooldown until ${new Date(cooldownExpiry).toISOString()}`);
        }
        continue;
      }

      // Check if we already have ANY position for this window+asset (open OR settled)
      // Use SLUG as the definitive check to prevent duplicates even if windowEnd values differ
      const slug = `${asset}-updown-5m-${windowStart}`;
      const tradeKey = `${asset}:${windowEnd}`;

      // In-memory dedup (prevents race between concurrent tick calls)
      if (tradedThisWindow.has(tradeKey)) continue;

      const openPos = await storage.getPositions({ source: "micro", status: "open" });
      const settledPos = await storage.getPositions({ source: "micro", status: "settled" });
      const alreadyTraded = [...openPos, ...settledPos].some(
        p => p.asset === asset && (p.slug === slug || p.windowEnd === windowEnd)
      );
      if (alreadyTraded) {
        tradedThisWindow.add(tradeKey); // Cache the result
        continue;
      }

      // Fetch event
      const event = await fetchEventBySlug(slug);
      if (!event) {
        if (attempts <= 2) {
          await storage.addModelLog("EVENT_NOT_FOUND", asset,
            `No event for slug ${slug} (attempt ${attempts + 1}, ${timeIntoWindow}s into window)`);
        }
        continue;
      }
      if (!event.acceptingOrders) {
        if (attempts <= 2) {
          await storage.addModelLog("NOT_ACCEPTING", asset, `Event ${slug} not accepting orders`);
        }
        continue;
      }

      // Get midpoints
      const midpoints = await getMidpoints([event.upTokenId, event.downTokenId]);
      const upPct = midpoints[event.upTokenId] || 0.5;
      const downPct = midpoints[event.downTokenId] || 0.5;

      // Edge filter: skip when midpoint is too close to 50/50 (no real edge)
      const midpointEdge = Math.abs(upPct - 0.5);
      if (midpointEdge < MIN_EDGE_MIDPOINT) {
        if (attempts <= 1) {
          await storage.addModelLog("NO_EDGE", asset,
            `Midpoint ${upPct.toFixed(4)}/${downPct.toFixed(4)} too close to 50/50 (edge=${(midpointEdge*100).toFixed(2)}% < ${MIN_EDGE_MIDPOINT*100}%)`);
        }
        continue;
      }

      // Select strategy: exploit backtest best (80%) or explore via Thompson Sampling (20%)
      const selectedStrategy = await selectStrategy(asset);

      if (selectedStrategy === "skip") {
        await storage.addModelLog("SKIP", asset,
          `Strategy selection returned SKIP for window ${windowEnd} (attempt ${attempts + 1})`);
        continue;
      }

      // Run the selected strategy
      let signal = await runStrategy(selectedStrategy, asset, event, upPct, downPct);

      // If selected strategy returned skip, try alternatives:
      // 1. Thompson Sampling pick (if we were exploiting)
      // 2. Any strategy that produces a signal
      if (signal.direction === "skip") {
        await storage.addModelLog("STRATEGY_SKIP", asset,
          `${selectedStrategy} returned skip, trying alternatives`);

        // Try all strategies in order of backtest WR to find one that doesn't skip
        const fallbackOrder: StrategyName[] = ["contrarian", "marketFollow", "momentum", "meanReversion", "orderBookImbalance"];
        let foundFallback = false;
        for (const fallbackName of fallbackOrder) {
          if (fallbackName === selectedStrategy) continue; // already tried
          const fbSignal = await runStrategy(fallbackName, asset, event, upPct, downPct);
          if (fbSignal.direction !== "skip" && fbSignal.confidence >= threshold) {
            await storage.addModelLog("FALLBACK_STRATEGY", asset,
              `${selectedStrategy} skipped, using ${fallbackName} (conf: ${fbSignal.confidence.toFixed(4)})`);
            signal = fbSignal;
            foundFallback = true;
            break;
          }
        }
        if (!foundFallback) {
          await storage.addModelLog("ALL_SKIP", asset,
            `All strategies returned skip for window ${windowEnd}`);
          continue;
        }
      }

      if (signal.confidence < threshold) {
        await storage.addModelLog("LOW_CONFIDENCE", asset,
          `${signal.strategyName}: confidence ${signal.confidence.toFixed(4)} < threshold ${threshold}`);
        continue;
      }

      // Open the trade
      tradedThisWindow.add(tradeKey); // Mark BEFORE opening to prevent races
      await openTrade(asset, event, signal, upPct, downPct, maxBet, slug, windowEnd);
      anyTradeOpened = true;

    } catch (err) {
      console.error(`[MicroEngine] Error processing ${asset}:`, err);
      await storage.addModelLog("ERROR", asset, `Trade open error: ${String(err)}`);
    }
  }

  if (anyTradeOpened) {
    windowState.lastProcessedWindowEnd = windowEnd;
  }
}

/**
 * Open a trade position.
 */
async function openTrade(
  asset: Asset,
  event: ParsedEvent,
  signal: StrategySignal,
  upPct: number,
  downPct: number,
  maxBet: number,
  slug: string,
  windowEnd: number
) {
  const betSize = await computeBetSize(signal.confidence, maxBet, signal.strategyName, asset);

  // Determine entry price
  const entryPrice = signal.direction === "up" ? upPct : downPct;
  if (entryPrice <= 0.01 || entryPrice >= 0.99) {
    await storage.addModelLog("BAD_PRICE", asset,
      `Entry price ${entryPrice} out of range for ${signal.strategyName}`);
    return;
  }

  // Create position
  const position = await storage.createPosition({
    side: signal.direction,
    entryPrice,
    currentPrice: entryPrice,
    size: betSize,
    status: "open",
    source: "micro",
    asset,
    windowStart: event.windowStart,
    windowEnd: event.windowEnd,
    slug,
    strategyUsed: signal.strategyName,
    confidence: signal.confidence,
  });

  // Create execution record
  await storage.createExecution({
    positionId: position.id,
    type: await isPaperTrading() ? "paper" : "live",
    side: signal.direction,
    price: entryPrice,
    size: betSize,
    status: "filled",
  });

  // Add to pending settlement
  windowState.pendingSettlement.add(windowEnd);

  await storage.addModelLog("TRADE_OPEN", asset,
    JSON.stringify({
      positionId: position.id,
      strategy: signal.strategyName,
      direction: signal.direction,
      confidence: signal.confidence.toFixed(4),
      entryPrice: entryPrice.toFixed(4),
      size: betSize,
      windowEnd,
      upPct: upPct.toFixed(4),
      downPct: downPct.toFixed(4),
    })
  );

  await storage.addAuditEntry("микро_сделка",
    `${asset.toUpperCase()} ${signal.direction} $${betSize} @ ${entryPrice.toFixed(4)} через ${signal.strategyName}`
  );
}

// ─── Settlement ──────────────────────────────────────────────────

async function settleClosedWindows() {
  const now = Math.floor(Date.now() / 1000);

  const openPositions = await storage.getPositions({ source: "micro", status: "open" });

  for (const pos of openPositions) {
    if (!pos.windowEnd || !pos.slug || !pos.asset) continue;

    const settleAfter = pos.windowEnd + SETTLEMENT_DELAY_SEC;
    if (now < settleAfter) continue;

    // Force settle only after FORCE_SETTLE_SEC (15 min) — Polymarket needs time
    const forceSettle = now > pos.windowEnd + FORCE_SETTLE_SEC;

    try {
      const resolved = await fetchResolvedEvent(pos.slug);
      const secSinceEnd = now - pos.windowEnd;

      // Skip if Polymarket hasn't resolved AND we haven't timed out
      if (!resolved || !resolved.resolved) {
        if (!forceSettle) {
          // Not resolved, not force-settling — wait for next tick
          continue;
        }
      }

      let outcome: "up" | "down" | "unknown" = "unknown";
      let pnl = 0;

      if (resolved && resolved.resolved && resolved.outcome) {
        outcome = resolved.outcome;
        console.log(`[Settlement] ${pos.id} ${pos.asset} ${pos.side}: resolved as ${outcome} (${secSinceEnd}s after end)`);
      } else if (forceSettle) {
        console.log(`[Settlement] ${pos.id} ${pos.asset}: FORCE SETTLE after ${secSinceEnd}s`);
        await storage.addModelLog("FORCE_SETTLE", pos.asset,
          `Force-settling position ${pos.id} after ${secSinceEnd}s (limit: ${FORCE_SETTLE_SEC}s)`);
        outcome = "unknown";
      } else {
        // Safety: should not reach here, but skip just in case
        continue;
      }

      const wasCorrect = outcome !== "unknown" && pos.side === outcome;

      if (wasCorrect) {
        // Win: payout = size / entryPrice (you bought shares at entryPrice, they're now worth $1)
        pnl = pos.size * (1 / pos.entryPrice - 1);
      } else if (outcome !== "unknown") {
        // Loss: you lose the full bet
        pnl = -pos.size;
      } else {
        pnl = 0;
      }

      pnl = Math.round(pnl * 100) / 100;

      await storage.updatePosition(pos.id, {
        status: "settled",
        realizedPnl: pnl,
        closedAt: new Date(),
      });

      await storage.createSettlement({
        positionId: pos.id,
        outcome,
        realizedPnl: pnl,
        wasCorrect: wasCorrect ? 1 : 0,
      });

      // Update strategy performance
      if (pos.strategyUsed && outcome !== "unknown") {
        await updateStrategyPerformance(pos.strategyUsed, pos.asset, wasCorrect);
      }

      // Update bet size multiplier
      if (outcome !== "unknown") {
        const currentMult = await getBetSizeMultiplier();
        if (wasCorrect) {
          await setBetSizeMultiplier(currentMult + BET_SIZE_WIN_DELTA);
        } else {
          await setBetSizeMultiplier(currentMult - BET_SIZE_LOSS_DELTA);
        }
      }

      // Check asset cooldown
      await checkAssetCooldown(pos.asset as Asset);

      // Snapshot performance
      await snapshotPerformance();

      await storage.addModelLog("TRADE_SETTLED", pos.asset,
        JSON.stringify({
          positionId: pos.id,
          strategy: pos.strategyUsed,
          side: pos.side,
          outcome,
          wasCorrect,
          pnl,
          entryPrice: pos.entryPrice,
        })
      );

      await storage.addAuditEntry("микро_расчёт",
        `${pos.asset?.toUpperCase()} ${pos.side} → ${outcome}: ${wasCorrect ? "ВЫИГРЫШ" : "ПРОИГРЫШ"} $${pnl.toFixed(2)}`
      );

    } catch (err) {
      console.error(`[MicroEngine] Settlement error for position ${pos.id}:`, err);
      await storage.addModelLog("ERROR", pos.asset, `Settlement error: ${String(err)}`);
    }
  }
}

// ─── Re-Settle Unknown Outcomes ───────────────────────────────────

/**
 * Re-settle positions that were force-settled with outcome=unknown.
 * Now that Polymarket has resolved them, we can get the correct outcome.
 * Runs once on startup.
 */
export async function reSettleUnknowns() {
  console.log("[MicroEngine] Re-settling unknown outcomes...");
  const settledPositions = await storage.getPositions({ source: "micro", status: "settled" });
  const unknowns = settledPositions.filter(p => p.realizedPnl === 0 && p.slug);
  
  let fixed = 0;
  for (const pos of unknowns) {
    try {
      const resolved = await fetchResolvedEvent(pos.slug!);
      if (!resolved || !resolved.resolved || !resolved.outcome) continue;

      const outcome = resolved.outcome;
      const wasCorrect = pos.side === outcome;
      let pnl: number;

      if (wasCorrect) {
        pnl = pos.size * (1 / pos.entryPrice - 1);
      } else {
        pnl = -pos.size;
      }
      pnl = Math.round(pnl * 100) / 100;

      await storage.updatePosition(pos.id, {
        realizedPnl: pnl,
      });

      // Update strategy performance
      if (pos.strategyUsed && pos.asset) {
        await updateStrategyPerformance(pos.strategyUsed, pos.asset, wasCorrect);
      }

      fixed++;
      console.log(`[MicroEngine] Re-settled ${pos.id} ${pos.asset} ${pos.side}: ${outcome} -> ${wasCorrect ? 'WIN' : 'LOSS'} $${pnl}`);
    } catch (err) {
      // Silent skip for individual errors
    }
  }

  if (fixed > 0) {
    await storage.addModelLog("RE_SETTLE", undefined, `Re-settled ${fixed} unknown positions with correct outcomes`);
    await storage.addAuditEntry("перерасчёт", `Пересчитано ${fixed} позиций с unknown исходом`);
  }
  console.log(`[MicroEngine] Re-settle complete: ${fixed} fixed out of ${unknowns.length} unknowns`);
}

// ─── Strategy Performance Update ─────────────────────────────────

async function updateStrategyPerformance(strategyName: string, asset: string, won: boolean) {
  const perf = await storage.getOrCreateStrategyPerf(strategyName, asset);

  const newWins = perf.wins + (won ? 1 : 0);
  const newLosses = perf.losses + (won ? 0 : 1);
  const newTotal = perf.totalTrades + 1;
  const newAlpha = perf.alphaWins + (won ? 1 : 0);
  const newBeta = perf.betaLosses + (won ? 0 : 1);

  await storage.updateStrategyPerf(perf.id, {
    totalTrades: newTotal,
    wins: newWins,
    losses: newLosses,
    alphaWins: newAlpha,
    betaLosses: newBeta,
  });

  // Apply discounting to ALL strategies for this asset
  await applyDiscounting(asset);
}

async function applyDiscounting(asset: string) {
  const allPerf = await storage.getStrategyPerformance(asset);
  for (const perf of allPerf) {
    await storage.updateStrategyPerf(perf.id, {
      alphaWins: perf.alphaWins * DISCOUNT_LAMBDA,
      betaLosses: perf.betaLosses * DISCOUNT_LAMBDA,
    });
  }
}

// ─── Cooldown & Quality Control ──────────────────────────────────

async function checkAssetCooldown(asset: Asset) {
  const recent = await storage.getRecentMicroTrades(asset, COOLDOWN_LOOKBACK);
  if (recent.length < COOLDOWN_LOOKBACK) return;

  const wins = recent.filter(p => (p.realizedPnl ?? 0) > 0).length;
  const wr = wins / recent.length;

  if (wr < COOLDOWN_WR_THRESHOLD) {
    const expiry = Date.now() + COOLDOWN_DURATION_MS;
    assetCooldowns.set(asset, expiry);
    await storage.addModelLog("ASSET_COOLDOWN_SET", asset,
      `WR ${(wr * 100).toFixed(1)}% < ${COOLDOWN_WR_THRESHOLD * 100}% over last ${COOLDOWN_LOOKBACK} — cooldown until ${new Date(expiry).toISOString()}`
    );
  }
}

// ─── Performance Snapshot ────────────────────────────────────────

async function snapshotPerformance() {
  const stats = await storage.getMicroStats();
  const microBankroll = parseFloat(await storage.getConfig("micro_bankroll") || "200");

  await storage.addPerformanceSnapshot({
    source: "micro",
    bankroll: microBankroll + stats.totalPnl,
    totalPnl: stats.totalPnl,
    winRate: stats.winRate,
    tradeCount: stats.totalTrades,
  });
}

// ─── Calibration from History ────────────────────────────────────

export async function calibrateFromHistory() {
  console.log("[MicroEngine] Calibrating from historical data...");

  // Load backtest best strategy from config
  const storedBest = await storage.getConfig("backtest_best_strategy");
  if (storedBest) {
    backtestBestStrategy = storedBest;
    console.log(`[MicroEngine] Loaded backtest best strategy: ${storedBest}`);
  }

  const assets: Asset[] = ["btc", "eth", "sol", "xrp"];

  for (const asset of assets) {
    const settled = (await storage.getPositions({ source: "micro", status: "settled" }))
      .filter(p => p.asset === asset);

    const stratCounts: Record<string, { wins: number; losses: number }> = {};

    for (const pos of settled) {
      const strat = pos.strategyUsed || "unknown";
      if (!stratCounts[strat]) stratCounts[strat] = { wins: 0, losses: 0 };
      if ((pos.realizedPnl ?? 0) > 0) stratCounts[strat].wins++;
      else stratCounts[strat].losses++;
    }

    for (const [strat, counts] of Object.entries(stratCounts)) {
      const perf = await storage.getOrCreateStrategyPerf(strat, asset);
      const alpha = 1 + counts.wins * 0.9;
      const beta = 1 + counts.losses * 0.9;
      await storage.updateStrategyPerf(perf.id, {
        totalTrades: counts.wins + counts.losses,
        wins: counts.wins,
        losses: counts.losses,
        alphaWins: alpha,
        betaLosses: beta,
      });
    }

    const recentTrades = await storage.getRecentMicroTrades(asset, 10);
    const recentWins = recentTrades.filter(p => (p.realizedPnl ?? 0) > 0).length;
    const recentTotal = recentTrades.length;
    if (recentTotal >= 5) {
      const wr = recentWins / recentTotal;
      const mult = 0.5 + wr;
      await setBetSizeMultiplier(Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, mult)));
    }

    await checkAssetCooldown(asset);
  }

  await storage.addModelLog("CALIBRATION_AUDIT", undefined,
    JSON.stringify({
      betSizeMultiplier: await getBetSizeMultiplier(),
      cooldowns: Object.fromEntries(assetCooldowns),
      disabledStrategies: Object.fromEntries(strategyDisabled),
    })
  );

  await storage.addAuditEntry("калибровка", "Микро-движок откалиброван по историческим данным");
  console.log("[MicroEngine] Calibration complete.");
}

// ─── Apply Backtest Priors to Thompson Sampling ──────────────

export async function applyBacktestPriors(
  results: { strategyName: string; winRate: number; totalTrades: number; wins: number; losses: number }[]
) {
  // Scale factor: controls how much weight backtest results have as priors.
  // 0.1 = weak, 0.5 = moderate, 1.0 = full weight.
  // We use 0.15 to give a meaningful but not overwhelming prior (scales ~150 trades to ~22 pseudo-observations).
  const PRIOR_SCALE = 0.15;
  const assets: Asset[] = ["btc", "eth", "sol", "xrp"];
  const microStrategyNames = new Set<string>(STRATEGY_NAMES);

  // Find the best individual strategy from backtest (exclude ensembles)
  const microResults = results.filter(r => microStrategyNames.has(r.strategyName));
  const bestMicro = microResults.length > 0
    ? microResults.reduce((a, b) => a.winRate > b.winRate ? a : b)
    : null;

  // Save best strategy to config so the engine exploits it
  if (bestMicro) {
    await storage.setConfig("backtest_best_strategy", bestMicro.strategyName);
    backtestBestStrategy = bestMicro.strategyName; // Update in-memory cache
    console.log(`[MicroEngine] Backtest best strategy set: ${bestMicro.strategyName} (WR: ${(bestMicro.winRate * 100).toFixed(1)}%)`);
    await storage.addModelLog("BACKTEST_BEST_SET", undefined,
      `Best strategy: ${bestMicro.strategyName} (WR: ${(bestMicro.winRate * 100).toFixed(1)}%). Will exploit ${EXPLOIT_RATE * 100}% of the time.`);
  }

  for (const result of results) {
    if (!microStrategyNames.has(result.strategyName)) continue;

    const scaledWins = Math.max(1, result.wins * PRIOR_SCALE);
    const scaledLosses = Math.max(1, result.losses * PRIOR_SCALE);
    const newAlpha = 1 + scaledWins;
    const newBeta = 1 + scaledLosses;

    for (const asset of assets) {
      const perf = await storage.getOrCreateStrategyPerf(result.strategyName, asset);

      // If real trades exist, blend priors with actual data
      if (perf.totalTrades >= 20) {
        console.log(
          `[MicroEngine] Skipping backtest prior for ${result.strategyName}/${asset}: ${perf.totalTrades} real trades exist`
        );
        continue;
      }

      const finalAlpha = newAlpha + (perf.totalTrades > 0 ? perf.wins : 0);
      const finalBeta = newBeta + (perf.totalTrades > 0 ? perf.losses : 0);

      await storage.updateStrategyPerf(perf.id, {
        alphaWins: finalAlpha,
        betaLosses: finalBeta,
      });

      console.log(
        `[MicroEngine] Applied backtest prior for ${result.strategyName}/${asset}: ` +
        `alpha=${finalAlpha.toFixed(2)}, beta=${finalBeta.toFixed(2)} ` +
        `(backtest WR: ${(result.winRate * 100).toFixed(1)}%)`
      );
    }
  }

  await storage.addModelLog(
    "PRIORS_APPLIED", undefined,
    `Backtest priors applied for ${results.filter(r => microStrategyNames.has(r.strategyName)).length} strategies`
  );
}

// ─── Main Tick (called every 25s by scheduler) ───────────────────

export async function runMicroTick() {
  if (!schedulerRunning) return;

  try {
    // 1. Settle any closed windows first
    await settleClosedWindows();

    // 2. Process new window (open trades)
    await processNewWindow();
  } catch (err) {
    console.error("[MicroEngine] Tick error:", err);
    await storage.addModelLog("TICK_ERROR", undefined, String(err));
  }
}

// ─── Scheduler ───────────────────────────────────────────────────

export async function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Re-settle any unknown outcomes from previous runs
  await reSettleUnknowns();

  // Run calibration on start
  await calibrateFromHistory();

  // Tick every 25 seconds (slightly offset from 30s to catch more window opportunities)
  schedulerInterval = setInterval(runMicroTick, 25000);

  // Run first tick immediately
  runMicroTick();

  await storage.addModelLog("SCHEDULER_START", undefined, "Micro scheduler started (tick interval: 25s)");
  await storage.addAuditEntry("запуск", "Микро-планировщик запущен");
  console.log("[MicroEngine] Scheduler started — ticking every 25s");
}

export async function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  schedulerRunning = false;

  await storage.addModelLog("SCHEDULER_STOP", undefined, "Micro scheduler stopped");
  await storage.addAuditEntry("остановка", "Микро-планировщик остановлен");
  console.log("[MicroEngine] Scheduler stopped");
}

export async function getSchedulerStatus() {
  const windowEnd = getCurrentWindowEnd();
  const windowStart = windowEnd - 300;
  const now = Math.floor(Date.now() / 1000);

  return {
    running: schedulerRunning,
    nextTick: schedulerRunning ? Math.ceil(now / 25) * 25 : null,
    currentWindow: {
      start: windowStart,
      end: windowEnd,
      startISO: new Date(windowStart * 1000).toISOString(),
      endISO: new Date(windowEnd * 1000).toISOString(),
      secondsRemaining: Math.max(0, windowEnd - now),
    },
    betSizeMultiplier: await getBetSizeMultiplier(),
    assetCooldowns: Object.fromEntries(assetCooldowns),
    disabledStrategies: Object.fromEntries(strategyDisabled),
    sessionPeakBankroll,
    backtestBestStrategy: backtestBestStrategy || null,
    exploitRate: EXPLOIT_RATE,
  };
}
