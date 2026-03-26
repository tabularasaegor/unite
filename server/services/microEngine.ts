/**
 * Micro Engine — Adaptive Multi-Strategy 5-Minute Trading Engine
 *
 * Core of AlgoTrader v3. Uses Thompson Sampling (Multi-Armed Bandit)
 * to select from 5 strategies per asset per window, with Bayesian
 * quality control, adaptive bet sizing, and automatic settlement.
 */

import { storage } from "../storage";
import {
  type Asset,
  getUpcomingSlug,
  getCurrentWindowEnd,
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
  pendingSettlement: Set<number>; // windowEnd timestamps pending settlement
}

// ─── Constants ───────────────────────────────────────────────────

const STRATEGY_NAMES = ["contrarian", "momentum", "meanReversion", "orderBookImbalance", "alternating"] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

const DISCOUNT_LAMBDA = 0.995;
const BET_SIZE_WIN_DELTA = 0.1;
const BET_SIZE_LOSS_DELTA = 0.2;
const BET_SIZE_MIN = 0.3;
const BET_SIZE_MAX = 1.5;
const MIN_BET = 3;
const COOLDOWN_WR_THRESHOLD = 0.3;
const COOLDOWN_LOOKBACK = 5;
const COOLDOWN_DURATION_MS = 10 * 60 * 1000; // 10 min
const DISABLE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const CI_LOWER_THRESHOLD = 0.48;
const SETTLEMENT_DELAY_SEC = 20;

// ─── Module State ────────────────────────────────────────────────

let schedulerInterval: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let sessionPeakBankroll = 0;
let windowState: WindowState = {
  lastProcessedWindowEnd: 0,
  pendingSettlement: new Set(),
};

// Per-asset cooldowns: asset → cooldown expiry timestamp
const assetCooldowns: Map<string, number> = new Map();
// Per-strategy+asset disable: "strategy:asset" → expiry timestamp
const strategyDisabled: Map<string, number> = new Map();

// ─── Beta Distribution Sampling (Box-Muller approximation) ──────

/**
 * Sample from Beta(alpha, beta) distribution.
 * Uses the gamma-distribution method: X ~ Gamma(a,1), Y ~ Gamma(b,1), then X/(X+Y) ~ Beta(a,b).
 * Gamma samples via Marsaglia & Tsang's method.
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost for shape < 1
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  // Marsaglia & Tsang
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
  // Box-Muller transform
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

function strategyContrarian(upPct: number, _downPct: number): StrategySignal {
  const deviation = Math.abs(upPct - 0.5);
  if (deviation <= 0.03) {
    return { direction: "skip", confidence: 0.49, strategyName: "contrarian" };
  }
  // Bet against majority
  const direction: "up" | "down" = upPct > 0.5 ? "down" : "up";
  const confidence = 0.5 + deviation * 0.3;
  return { direction, confidence: Math.min(confidence, 0.70), strategyName: "contrarian" };
}

async function strategyMomentum(asset: Asset, upTokenId: string): Promise<StrategySignal> {
  try {
    const history = await getPriceHistory(upTokenId, "1h", 1);
    if (history.length < 16) {
      return { direction: "skip", confidence: 0.49, strategyName: "momentum" };
    }
    const prices = history.slice(-20).map(h => h.p);

    // RSI(5) for momentum
    const rsi5 = computeRSI(prices, 5);

    // EMA crossover confirmation
    const ema5 = computeEMA(prices, 5);
    const ema15 = computeEMA(prices, 15);
    const emaCrossUp = ema5.length > 0 && ema15.length > 0 &&
      ema5[ema5.length - 1] > ema15[ema15.length - 1];

    let direction: "up" | "down" | "skip" = "skip";
    let confidence = 0.49;

    if (rsi5 > 55 && emaCrossUp) {
      direction = "up";
      confidence = 0.50 + (rsi5 - 50) * 0.005;
    } else if (rsi5 < 45 && !emaCrossUp) {
      direction = "down";
      confidence = 0.50 + (50 - rsi5) * 0.005;
    } else if (rsi5 > 55) {
      direction = "up";
      confidence = 0.50 + (rsi5 - 50) * 0.003;
    } else if (rsi5 < 45) {
      direction = "down";
      confidence = 0.50 + (50 - rsi5) * 0.003;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.70),
      strategyName: "momentum",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "momentum" };
  }
}

async function strategyMeanReversion(asset: Asset, upTokenId: string): Promise<StrategySignal> {
  try {
    const history = await getPriceHistory(upTokenId, "1h", 5);
    if (history.length < 15) {
      return { direction: "skip", confidence: 0.49, strategyName: "meanReversion" };
    }
    const prices = history.slice(-20).map(h => h.p);

    // RSI(14) on 5-min data
    const rsi14 = computeRSI(prices, 14);

    let direction: "up" | "down" | "skip" = "skip";
    let confidence = 0.49;

    if (rsi14 < 30) {
      // Oversold → expect upward reversion
      direction = "up";
      confidence = 0.50 + (30 - rsi14) * 0.01;
    } else if (rsi14 > 70) {
      // Overbought → expect downward reversion
      direction = "down";
      confidence = 0.50 + (rsi14 - 70) * 0.01;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.70),
      strategyName: "meanReversion",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "meanReversion" };
  }
}

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

    if (obi > 0.15) {
      direction = "up";
      confidence = 0.50 + Math.abs(obi) * 0.2;
    } else if (obi < -0.15) {
      direction = "down";
      confidence = 0.50 + Math.abs(obi) * 0.2;
    }

    return {
      direction,
      confidence: Math.min(confidence, 0.70),
      strategyName: "orderBookImbalance",
    };
  } catch {
    return { direction: "skip", confidence: 0.49, strategyName: "orderBookImbalance" };
  }
}

function strategyAlternating(windowEnd: number): StrategySignal {
  const parity = Math.floor(windowEnd / 300) % 2;
  return {
    direction: parity === 0 ? "up" : "down",
    confidence: 0.50,
    strategyName: "alternating",
  };
}

// ─── Thompson Sampling Strategy Selection ────────────────────────

/**
 * Compute 95% CI lower bound for a Beta(alpha, beta).
 * CI lower ≈ mean - 1.96 * std
 */
function ciLowerBound(alpha: number, beta: number): number {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  return mean - 1.96 * Math.sqrt(variance);
}

/**
 * Select a strategy for a given asset using Thompson Sampling.
 * Returns the chosen strategy name (or "skip").
 */
function selectStrategyByThompson(asset: Asset): string {
  const now = Date.now();
  let bestSample = -1;
  let bestStrategy = "skip";

  // Sample from "skip" arm — starts at Beta(1,1)
  const skipPerf = storage.getOrCreateStrategyPerf("skip", asset);
  const skipSample = sampleBeta(skipPerf.alphaWins, skipPerf.betaLosses);

  bestSample = skipSample;
  bestStrategy = "skip";

  for (const stratName of STRATEGY_NAMES) {
    // Check if strategy is disabled for this asset
    const disableKey = `${stratName}:${asset}`;
    const disableExpiry = strategyDisabled.get(disableKey);
    if (disableExpiry && now < disableExpiry) {
      continue; // Strategy disabled
    } else if (disableExpiry && now >= disableExpiry) {
      // Re-enable
      strategyDisabled.delete(disableKey);
      storage.addModelLog("MODEL_REENABLE", asset, `Re-enabled ${stratName} after cooldown`);
    }

    const perf = storage.getOrCreateStrategyPerf(stratName, asset);

    // Quality control: check 95% CI lower bound
    const ciLower = ciLowerBound(perf.alphaWins, perf.betaLosses);
    if (perf.totalTrades >= 10 && ciLower < CI_LOWER_THRESHOLD) {
      strategyDisabled.set(disableKey, now + DISABLE_COOLDOWN_MS);
      storage.addModelLog(
        "MODEL_DISABLE",
        asset,
        `Disabled ${stratName}: CI lower ${ciLower.toFixed(4)} < ${CI_LOWER_THRESHOLD}`
      );
      continue;
    }

    const sample = sampleBeta(perf.alphaWins, perf.betaLosses);
    if (sample > bestSample) {
      bestSample = sample;
      bestStrategy = stratName;
    }
  }

  return bestStrategy;
}

// ─── Bet Sizing ──────────────────────────────────────────────────

function getBetSizeMultiplier(): number {
  const stored = storage.getMemory("micro_state", "betSizeMultiplier");
  return stored ? Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, parseFloat(stored))) : 1.0;
}

function setBetSizeMultiplier(val: number) {
  const clamped = Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, val));
  storage.setMemory("micro_state", "betSizeMultiplier", clamped.toString());
}

function computeBetSize(confidence: number, maxBet: number): number {
  const edge = confidence - 0.5;
  let basePct: number;
  if (edge < 0.02) basePct = 0.25;
  else if (edge < 0.05) basePct = 0.50;
  else if (edge < 0.10) basePct = 0.75;
  else basePct = 1.0;

  const multiplier = getBetSizeMultiplier();
  const size = maxBet * basePct * multiplier;

  // Check drawdown brake
  const stats = storage.getMicroStats();
  const microBankroll = parseFloat(storage.getConfig("micro_bankroll") || "200");
  const currentBankroll = microBankroll + stats.totalPnl;
  if (sessionPeakBankroll === 0) sessionPeakBankroll = currentBankroll;
  if (currentBankroll > sessionPeakBankroll) sessionPeakBankroll = currentBankroll;

  const drawdown = sessionPeakBankroll > 0 ? (sessionPeakBankroll - currentBankroll) / sessionPeakBankroll : 0;
  const drawdownCap = drawdown > 0.30 ? 0.5 : 1.0;

  const finalSize = Math.max(MIN_BET, Math.round(size * drawdownCap * 100) / 100);
  return finalSize;
}

// ─── Config Helpers ──────────────────────────────────────────────

function getConfigValue(key: string, defaultVal: string): string {
  return storage.getConfig(key) || defaultVal;
}

function getEnabledAssets(): Asset[] {
  const raw = getConfigValue("micro_assets", "btc,eth,sol,xrp");
  return raw.split(",").map(s => s.trim().toLowerCase()) as Asset[];
}

function getConfidenceThreshold(): number {
  return parseFloat(getConfigValue("confidence_threshold", "0.52"));
}

function getMaxBet(): number {
  return parseFloat(getConfigValue("micro_max_bet", "20"));
}

function isPaperTrading(): boolean {
  return getConfigValue("paper_trading", "true") === "true";
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
    case "alternating":
      return strategyAlternating(event.windowEnd);
    default:
      return { direction: "skip", confidence: 0.49, strategyName };
  }
}

// ─── Main Tick: Open Trades ──────────────────────────────────────

async function processNewWindow() {
  const windowEnd = getCurrentWindowEnd();

  // Don't process same window twice
  if (windowState.lastProcessedWindowEnd === windowEnd) return;

  const now = Math.floor(Date.now() / 1000);
  const timeIntoWindow = now - (windowEnd - 300);

  // Only trade within first ~2 minutes of window to leave time for movement
  if (timeIntoWindow > 150) return;

  windowState.lastProcessedWindowEnd = windowEnd;

  const assets = getEnabledAssets();
  const threshold = getConfidenceThreshold();
  const maxBet = getMaxBet();

  for (const asset of assets) {
    try {
      // Check asset cooldown
      const cooldownExpiry = assetCooldowns.get(asset);
      if (cooldownExpiry && Date.now() < cooldownExpiry) {
        storage.addModelLog("ASSET_COOLDOWN", asset, `Asset on cooldown until ${new Date(cooldownExpiry).toISOString()}`);
        continue;
      }

      // Check if we already have an open position for this window+asset
      const existingPositions = storage.getPositions({ source: "micro", status: "open" });
      const alreadyTraded = existingPositions.some(
        p => p.asset === asset && p.windowEnd === windowEnd
      );
      if (alreadyTraded) continue;

      // Fetch event
      const slug = `${asset}-updown-5m-${windowEnd}`;
      const event = await fetchEventBySlug(slug);
      if (!event) {
        storage.addModelLog("EVENT_NOT_FOUND", asset, `No event for slug ${slug}`);
        continue;
      }
      if (!event.acceptingOrders) {
        storage.addModelLog("NOT_ACCEPTING", asset, `Event ${slug} not accepting orders`);
        continue;
      }

      // Get midpoints
      const midpoints = await getMidpoints([event.upTokenId, event.downTokenId]);
      const upPct = midpoints[event.upTokenId] || 0.5;
      const downPct = midpoints[event.downTokenId] || 0.5;

      // Thompson Sampling: select strategy
      const selectedStrategy = selectStrategyByThompson(asset);

      if (selectedStrategy === "skip") {
        storage.addModelLog("SKIP", asset, `Thompson selected SKIP for window ${windowEnd}`);
        continue;
      }

      // Run the selected strategy
      const signal = await runStrategy(selectedStrategy, asset, event, upPct, downPct);

      if (signal.direction === "skip") {
        storage.addModelLog("STRATEGY_SKIP", asset,
          `${selectedStrategy} returned skip for window ${windowEnd}`);
        continue;
      }

      if (signal.confidence < threshold) {
        storage.addModelLog("LOW_CONFIDENCE", asset,
          `${selectedStrategy}: confidence ${signal.confidence.toFixed(4)} < threshold ${threshold}`);
        continue;
      }

      // Compute bet size
      const betSize = computeBetSize(signal.confidence, maxBet);

      // Determine entry price (paper mode: use midpoint)
      const entryPrice = signal.direction === "up" ? upPct : downPct;
      if (entryPrice <= 0 || entryPrice >= 1) {
        storage.addModelLog("BAD_PRICE", asset,
          `Entry price ${entryPrice} out of range for ${selectedStrategy}`);
        continue;
      }

      // Create position
      const position = storage.createPosition({
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
        strategyUsed: selectedStrategy,
        confidence: signal.confidence,
      });

      // Create execution record
      storage.createExecution({
        positionId: position.id,
        type: isPaperTrading() ? "paper" : "live",
        side: signal.direction,
        price: entryPrice,
        size: betSize,
        status: "filled",
      });

      // Add to pending settlement
      windowState.pendingSettlement.add(windowEnd);

      storage.addModelLog("TRADE_OPEN", asset,
        JSON.stringify({
          positionId: position.id,
          strategy: selectedStrategy,
          direction: signal.direction,
          confidence: signal.confidence.toFixed(4),
          entryPrice: entryPrice.toFixed(4),
          size: betSize,
          windowEnd,
          upPct: upPct.toFixed(4),
          downPct: downPct.toFixed(4),
        })
      );

      storage.addAuditEntry("микро_сделка",
        `${asset.toUpperCase()} ${signal.direction} $${betSize} @ ${entryPrice.toFixed(4)} через ${selectedStrategy}`
      );

    } catch (err) {
      console.error(`[MicroEngine] Error processing ${asset}:`, err);
      storage.addModelLog("ERROR", asset, `Trade open error: ${String(err)}`);
    }
  }
}

// ─── Settlement ──────────────────────────────────────────────────

async function settleClosedWindows() {
  const now = Math.floor(Date.now() / 1000);

  // Find all open micro positions whose window has ended
  const openPositions = storage.getPositions({ source: "micro", status: "open" });

  for (const pos of openPositions) {
    if (!pos.windowEnd || !pos.slug || !pos.asset) continue;

    // Wait SETTLEMENT_DELAY_SEC after window end before checking
    const settleAfter = pos.windowEnd + SETTLEMENT_DELAY_SEC;
    if (now < settleAfter) continue;

    // Force settle if more than 2 min past window end (API unresponsive)
    const forceSettle = now > pos.windowEnd + 120;

    try {
      const resolved = await fetchResolvedEvent(pos.slug);

      if (!resolved && !forceSettle) continue;
      if (resolved && !resolved.resolved && !forceSettle) continue;

      let outcome: "up" | "down" | "unknown" = "unknown";
      let pnl = 0;

      if (resolved && resolved.resolved && resolved.finalPrice !== undefined && resolved.priceToBeat !== undefined) {
        // finalPrice >= priceToBeat → "up" wins
        outcome = resolved.finalPrice >= resolved.priceToBeat ? "up" : "down";
      } else if (forceSettle) {
        // Force settle: check last trade price or assume loss
        storage.addModelLog("FORCE_SETTLE", pos.asset, `Force-settling position ${pos.id} after timeout`);
        outcome = "unknown";
      }

      const wasCorrect = outcome !== "unknown" && pos.side === outcome;

      if (wasCorrect) {
        // Won: profit = size * (1/entryPrice - 1)
        pnl = pos.size * (1 / pos.entryPrice - 1);
      } else if (outcome !== "unknown") {
        // Lost: lose entire stake
        pnl = -pos.size;
      } else {
        // Unknown: treat as push (0)
        pnl = 0;
      }

      // Round PnL
      pnl = Math.round(pnl * 100) / 100;

      // Update position
      storage.updatePosition(pos.id, {
        status: "settled",
        realizedPnl: pnl,
        closedAt: new Date().toISOString(),
      });

      // Create settlement
      storage.createSettlement({
        positionId: pos.id,
        outcome: outcome,
        realizedPnl: pnl,
        wasCorrect: wasCorrect ? 1 : 0,
      });

      // Update strategy performance
      if (pos.strategyUsed && outcome !== "unknown") {
        updateStrategyPerformance(pos.strategyUsed, pos.asset, wasCorrect);
      }

      // Update bet size multiplier
      if (outcome !== "unknown") {
        const currentMult = getBetSizeMultiplier();
        if (wasCorrect) {
          setBetSizeMultiplier(currentMult + BET_SIZE_WIN_DELTA);
        } else {
          setBetSizeMultiplier(currentMult - BET_SIZE_LOSS_DELTA);
        }
      }

      // Check asset cooldown
      checkAssetCooldown(pos.asset as Asset);

      // Snapshot performance
      snapshotPerformance();

      storage.addModelLog("TRADE_SETTLED", pos.asset,
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

      storage.addAuditEntry("микро_расчёт",
        `${pos.asset?.toUpperCase()} ${pos.side} → ${outcome}: ${wasCorrect ? "ВЫИГРЫШ" : "ПРОИГРЫШ"} $${pnl.toFixed(2)}`
      );

    } catch (err) {
      console.error(`[MicroEngine] Settlement error for position ${pos.id}:`, err);
      storage.addModelLog("ERROR", pos.asset, `Settlement error: ${String(err)}`);
    }
  }
}

// ─── Strategy Performance Update ─────────────────────────────────

function updateStrategyPerformance(strategyName: string, asset: string, won: boolean) {
  const perf = storage.getOrCreateStrategyPerf(strategyName, asset);

  // Update wins/losses
  const newWins = perf.wins + (won ? 1 : 0);
  const newLosses = perf.losses + (won ? 0 : 1);
  const newTotal = perf.totalTrades + 1;

  // Update alpha/beta
  const newAlpha = perf.alphaWins + (won ? 1 : 0);
  const newBeta = perf.betaLosses + (won ? 0 : 1);

  storage.updateStrategyPerf(perf.id, {
    totalTrades: newTotal,
    wins: newWins,
    losses: newLosses,
    alphaWins: newAlpha,
    betaLosses: newBeta,
  });

  // Apply discounting to ALL strategies for this asset
  applyDiscounting(asset);
}

function applyDiscounting(asset: string) {
  const allPerf = storage.getStrategyPerformance(asset);
  for (const perf of allPerf) {
    storage.updateStrategyPerf(perf.id, {
      alphaWins: perf.alphaWins * DISCOUNT_LAMBDA,
      betaLosses: perf.betaLosses * DISCOUNT_LAMBDA,
    });
  }
}

// ─── Cooldown & Quality Control ──────────────────────────────────

function checkAssetCooldown(asset: Asset) {
  const recent = storage.getRecentMicroTrades(asset, COOLDOWN_LOOKBACK);
  if (recent.length < COOLDOWN_LOOKBACK) return;

  const wins = recent.filter(p => (p.realizedPnl ?? 0) > 0).length;
  const wr = wins / recent.length;

  if (wr < COOLDOWN_WR_THRESHOLD) {
    const expiry = Date.now() + COOLDOWN_DURATION_MS;
    assetCooldowns.set(asset, expiry);
    storage.addModelLog("ASSET_COOLDOWN_SET", asset,
      `WR ${(wr * 100).toFixed(1)}% < ${COOLDOWN_WR_THRESHOLD * 100}% over last ${COOLDOWN_LOOKBACK} — cooldown until ${new Date(expiry).toISOString()}`
    );
  }
}

// ─── Performance Snapshot ────────────────────────────────────────

function snapshotPerformance() {
  const stats = storage.getMicroStats();
  const microBankroll = parseFloat(storage.getConfig("micro_bankroll") || "200");

  storage.addPerformanceSnapshot({
    source: "micro",
    bankroll: microBankroll + stats.totalPnl,
    totalPnl: stats.totalPnl,
    winRate: stats.winRate,
    tradeCount: stats.totalTrades,
  });
}

// ─── Calibration from History ────────────────────────────────────

export function calibrateFromHistory() {
  console.log("[MicroEngine] Calibrating from historical data...");

  const assets: Asset[] = ["btc", "eth", "sol", "xrp"];

  // Reset strategy performance from settled positions
  for (const asset of assets) {
    const settled = storage.getPositions({ source: "micro", status: "settled" })
      .filter(p => p.asset === asset);

    // Group by strategy
    const stratCounts: Record<string, { wins: number; losses: number }> = {};

    for (const pos of settled) {
      const strat = pos.strategyUsed || "unknown";
      if (!stratCounts[strat]) stratCounts[strat] = { wins: 0, losses: 0 };
      if ((pos.realizedPnl ?? 0) > 0) stratCounts[strat].wins++;
      else stratCounts[strat].losses++;
    }

    // Update strategy performance with counts
    for (const [strat, counts] of Object.entries(stratCounts)) {
      const perf = storage.getOrCreateStrategyPerf(strat, asset);
      // Apply discount to historical data proportional to age
      const alpha = 1 + counts.wins * 0.9; // Slight discount for historical
      const beta = 1 + counts.losses * 0.9;
      storage.updateStrategyPerf(perf.id, {
        totalTrades: counts.wins + counts.losses,
        wins: counts.wins,
        losses: counts.losses,
        alphaWins: alpha,
        betaLosses: beta,
      });
    }

    // Recalculate bet size multiplier from trailing wins/losses
    const recentTrades = storage.getRecentMicroTrades(asset, 10);
    const recentWins = recentTrades.filter(p => (p.realizedPnl ?? 0) > 0).length;
    const recentTotal = recentTrades.length;
    if (recentTotal >= 5) {
      const wr = recentWins / recentTotal;
      const mult = 0.5 + wr; // e.g. 60% WR → 1.1x
      setBetSizeMultiplier(Math.max(BET_SIZE_MIN, Math.min(BET_SIZE_MAX, mult)));
    }

    // Check cooldowns
    checkAssetCooldown(asset);
  }

  storage.addModelLog("CALIBRATION_AUDIT", undefined,
    JSON.stringify({
      betSizeMultiplier: getBetSizeMultiplier(),
      cooldowns: Object.fromEntries(assetCooldowns),
      disabledStrategies: Object.fromEntries(strategyDisabled),
    })
  );

  storage.addAuditEntry("калибровка", "Микро-движок откалиброван по историческим данным");
  console.log("[MicroEngine] Calibration complete.");
}

// ─── Main Tick (called every 30s by scheduler) ───────────────────

export async function runMicroTick() {
  if (!schedulerRunning) return;

  try {
    // 1. Settle any closed windows first
    await settleClosedWindows();

    // 2. Process new window (open trades)
    await processNewWindow();
  } catch (err) {
    console.error("[MicroEngine] Tick error:", err);
    storage.addModelLog("TICK_ERROR", undefined, String(err));
  }
}

// ─── Scheduler ───────────────────────────────────────────────────

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Run calibration on start
  calibrateFromHistory();

  // Tick every 30 seconds
  schedulerInterval = setInterval(runMicroTick, 30000);

  // Run first tick immediately
  runMicroTick();

  storage.addModelLog("SCHEDULER_START", undefined, "Micro scheduler started");
  storage.addAuditEntry("запуск", "Микро-планировщик запущен");
  console.log("[MicroEngine] Scheduler started — ticking every 30s");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  schedulerRunning = false;

  storage.addModelLog("SCHEDULER_STOP", undefined, "Micro scheduler stopped");
  storage.addAuditEntry("остановка", "Микро-планировщик остановлен");
  console.log("[MicroEngine] Scheduler stopped");
}

export function getSchedulerStatus() {
  const windowEnd = getCurrentWindowEnd();
  const windowStart = windowEnd - 300;
  const now = Math.floor(Date.now() / 1000);

  return {
    running: schedulerRunning,
    nextTick: schedulerRunning ? Math.ceil(now / 30) * 30 : null,
    currentWindow: {
      start: windowStart,
      end: windowEnd,
      startISO: new Date(windowStart * 1000).toISOString(),
      endISO: new Date(windowEnd * 1000).toISOString(),
      secondsRemaining: Math.max(0, windowEnd - now),
    },
    betSizeMultiplier: getBetSizeMultiplier(),
    assetCooldowns: Object.fromEntries(assetCooldowns),
    disabledStrategies: Object.fromEntries(strategyDisabled),
    sessionPeakBankroll,
  };
}
