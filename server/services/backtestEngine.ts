/**
 * Backtest Engine — Simulates all 5 micro-engine strategies + ensemble approaches
 * on synthetic GBM+OU price data to compare model performance.
 */

import crypto from "crypto";
import { storage } from "../storage";
import type { InsertBacktestResult } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────

interface WindowData {
  index: number;
  upPct: number;          // market probability for "up" (0–1)
  downPct: number;        // 1 - upPct
  obi: number;            // order book imbalance (-1 to 1)
  priceHistory: number[]; // array of simulated prices leading up to this window
  startPrice: number;     // price at start of 5-min window
  endPrice: number;       // price at end of 5-min window
  priceWentUp: boolean;   // did price go up?
}

interface TradeResult {
  direction: "up" | "down" | "skip";
  confidence: number;
  won: boolean;
  pnl: number;
}

export interface StrategyBacktestResult {
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgConfidence: number;
  rollingWr50: number[];
}

export interface BacktestRunResult {
  results: StrategyBacktestResult[];
  bestModel: string;
  timestamp: string;
  batchId: string;
}

// ─── Random Helpers ──────────────────────────────────────────────

function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── GBM + Ornstein-Uhlenbeck Price Generation ──────────────────

function generatePriceData(numWindows: number): WindowData[] {
  const mu = 0.0001;      // drift per 5-min
  const sigma = 0.002;    // volatility per 5-min
  const theta = 0.1;      // mean reversion speed
  const meanLevel = 0;    // OU mean level (deviation from trend)

  // Generate a continuous price series first
  // Each window has ~12 sub-steps (25-second intervals) for realistic price history
  const stepsPerWindow = 12;
  const totalSteps = numWindows * stepsPerWindow;
  const dt = 1.0 / stepsPerWindow;

  let logDeviation = 0; // OU deviation component
  let logPrice = Math.log(50000); // start at ~50k (BTC-like)
  const allPrices: number[] = [Math.exp(logPrice)];

  for (let i = 1; i <= totalSteps; i++) {
    // GBM component
    const drift = (mu * dt) - 0.5 * sigma * sigma * dt;
    const diffusion = sigma * Math.sqrt(dt) * randn();

    // OU component (mean-reverting)
    const ouDrift = theta * (meanLevel - logDeviation) * dt;
    const ouDiffusion = sigma * 0.5 * Math.sqrt(dt) * randn();
    logDeviation += ouDrift + ouDiffusion;

    logPrice += drift + diffusion + ouDrift;
    allPrices.push(Math.exp(logPrice));
  }

  // Now slice into windows
  const windows: WindowData[] = [];
  for (let w = 0; w < numWindows; w++) {
    const startIdx = w * stepsPerWindow;
    const endIdx = (w + 1) * stepsPerWindow;

    const startPrice = allPrices[startIdx];
    const endPrice = allPrices[endIdx];
    const priceWentUp = endPrice > startPrice;

    // Price history: last 20 window-end prices for indicator computation
    const historyStartWindow = Math.max(0, w - 19);
    const priceHistory: number[] = [];
    for (let h = historyStartWindow; h <= w; h++) {
      priceHistory.push(allPrices[h * stepsPerWindow]);
    }

    // Generate realistic market probability (upPct)
    // Slightly correlated with actual direction but noisy
    const priceChange = (endPrice - startPrice) / startPrice;
    const noiseUp = 0.5 + priceChange * 20 + randn() * 0.08;
    const upPct = Math.max(0.15, Math.min(0.85, noiseUp));

    // Order book imbalance: loosely correlated with price direction
    const obiNoise = (priceWentUp ? 0.05 : -0.05) + randn() * 0.25;
    const obi = Math.max(-1, Math.min(1, obiNoise));

    windows.push({
      index: w,
      upPct,
      downPct: 1 - upPct,
      obi,
      priceHistory,
      startPrice,
      endPrice,
      priceWentUp,
    });
  }

  return windows;
}

// ─── Technical Indicators (same as microEngine) ──────────────────

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
  const rs = gains / period / (losses / period);
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

// ─── Strategy Implementations (pure functions for backtest) ──────

interface StrategySignal {
  direction: "up" | "down" | "skip";
  confidence: number;
}

function strategyContrarian(w: WindowData): StrategySignal {
  const deviation = Math.abs(w.upPct - 0.5);
  if (deviation <= 0.03) {
    return { direction: "skip", confidence: 0.49 };
  }
  const direction: "up" | "down" = w.upPct > 0.5 ? "down" : "up";
  const confidence = Math.min(0.5 + deviation * 0.3, 0.70);
  return { direction, confidence };
}

function strategyMomentum(w: WindowData): StrategySignal {
  const prices = w.priceHistory;
  if (prices.length < 16) {
    return { direction: "skip", confidence: 0.49 };
  }

  const rsi5 = computeRSI(prices, 5);
  const ema5 = computeEMA(prices, 5);
  const ema15 = computeEMA(prices, 15);
  const emaCrossUp =
    ema5.length > 0 &&
    ema15.length > 0 &&
    ema5[ema5.length - 1] > ema15[ema15.length - 1];

  let direction: "up" | "down" | "skip" = "skip";
  let confidence = 0.49;

  if (rsi5 > 55 && emaCrossUp) {
    direction = "up";
    confidence = 0.5 + (rsi5 - 50) * 0.005;
  } else if (rsi5 < 45 && !emaCrossUp) {
    direction = "down";
    confidence = 0.5 + (50 - rsi5) * 0.005;
  } else if (rsi5 > 55) {
    direction = "up";
    confidence = 0.5 + (rsi5 - 50) * 0.003;
  } else if (rsi5 < 45) {
    direction = "down";
    confidence = 0.5 + (50 - rsi5) * 0.003;
  }

  return { direction, confidence: Math.min(confidence, 0.70) };
}

function strategyMeanReversion(w: WindowData): StrategySignal {
  const prices = w.priceHistory;
  if (prices.length < 15) {
    return { direction: "skip", confidence: 0.49 };
  }

  const rsi14 = computeRSI(prices, 14);

  let direction: "up" | "down" | "skip" = "skip";
  let confidence = 0.49;

  if (rsi14 < 30) {
    direction = "up";
    confidence = 0.5 + (30 - rsi14) * 0.01;
  } else if (rsi14 > 70) {
    direction = "down";
    confidence = 0.5 + (rsi14 - 70) * 0.01;
  }

  return { direction, confidence: Math.min(confidence, 0.70) };
}

function strategyOrderBookImbalance(w: WindowData): StrategySignal {
  const obi = w.obi;
  let direction: "up" | "down" | "skip" = "skip";
  let confidence = 0.49;

  if (obi > 0.15) {
    direction = "up";
    confidence = 0.5 + Math.abs(obi) * 0.2;
  } else if (obi < -0.15) {
    direction = "down";
    confidence = 0.5 + Math.abs(obi) * 0.2;
  }

  return { direction, confidence: Math.min(confidence, 0.70) };
}

function strategyAlternating(w: WindowData): StrategySignal {
  const parity = w.index % 2;
  return {
    direction: parity === 0 ? "up" : "down",
    confidence: 0.50,
  };
}

// ─── Trade Outcome Evaluation ────────────────────────────────────

function evaluateTrade(
  signal: StrategySignal,
  w: WindowData,
  betSize: number = 10
): TradeResult {
  if (signal.direction === "skip") {
    return { direction: "skip", confidence: signal.confidence, won: false, pnl: 0 };
  }

  const predictedUp = signal.direction === "up";
  const won = predictedUp === w.priceWentUp;

  // Polymarket return formula: entryPrice is the market probability for our direction
  const entryPrice = predictedUp ? w.upPct : w.downPct;
  // Clamp entryPrice to avoid division by zero or extreme returns
  const clampedEntry = Math.max(0.1, Math.min(0.9, entryPrice));

  let pnl: number;
  if (won) {
    pnl = betSize * ((1 - clampedEntry) / clampedEntry);
  } else {
    pnl = -betSize;
  }

  return {
    direction: signal.direction,
    confidence: signal.confidence,
    won,
    pnl: Math.round(pnl * 100) / 100,
  };
}

// ─── Compute Summary Stats ───────────────────────────────────────

function computeStats(
  strategyName: string,
  trades: TradeResult[]
): StrategyBacktestResult {
  // Filter out skips
  const activeTrades = trades.filter((t) => t.direction !== "skip");

  if (activeTrades.length === 0) {
    return {
      strategyName,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      avgConfidence: 0,
      rollingWr50: [],
    };
  }

  const wins = activeTrades.filter((t) => t.won).length;
  const losses = activeTrades.length - wins;
  const winRate = wins / activeTrades.length;
  const totalPnl = activeTrades.reduce((sum, t) => sum + t.pnl, 0);
  const avgPnl = totalPnl / activeTrades.length;
  const avgConfidence =
    activeTrades.reduce((sum, t) => sum + t.confidence, 0) / activeTrades.length;

  // Max drawdown
  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  for (const t of activeTrades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (annualized, assuming 5-min windows = 288 per day)
  const pnls = activeTrades.map((t) => t.pnl);
  const meanPnl = avgPnl;
  const variance =
    pnls.reduce((sum, p) => sum + (p - meanPnl) ** 2, 0) / pnls.length;
  const stdPnl = Math.sqrt(variance);
  const sharpeRatio = stdPnl > 0 ? (meanPnl / stdPnl) * Math.sqrt(288) : 0;

  // Rolling 50-window win rate
  const rollingWr50: number[] = [];
  for (let i = 49; i < activeTrades.length; i++) {
    const window = activeTrades.slice(i - 49, i + 1);
    const windowWins = window.filter((t) => t.won).length;
    rollingWr50.push(Math.round((windowWins / 50) * 10000) / 10000);
  }

  return {
    strategyName,
    totalTrades: activeTrades.length,
    wins,
    losses,
    winRate: Math.round(winRate * 10000) / 10000,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnl: Math.round(avgPnl * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    avgConfidence: Math.round(avgConfidence * 10000) / 10000,
    rollingWr50,
  };
}

// ─── Ensemble Strategies ─────────────────────────────────────────

type StrategyFn = (w: WindowData) => StrategySignal;

const individualStrategies: { name: string; fn: StrategyFn }[] = [
  { name: "contrarian", fn: strategyContrarian },
  { name: "momentum", fn: strategyMomentum },
  { name: "meanReversion", fn: strategyMeanReversion },
  { name: "orderBookImbalance", fn: strategyOrderBookImbalance },
  { name: "alternating", fn: strategyAlternating },
];

function ensembleMajorityVote(w: WindowData): StrategySignal {
  let upVotes = 0;
  let downVotes = 0;
  let totalConf = 0;
  let count = 0;

  for (const s of individualStrategies) {
    const sig = s.fn(w);
    if (sig.direction === "up") {
      upVotes++;
      totalConf += sig.confidence;
      count++;
    } else if (sig.direction === "down") {
      downVotes++;
      totalConf += sig.confidence;
      count++;
    }
  }

  if (upVotes === 0 && downVotes === 0) {
    return { direction: "skip", confidence: 0.49 };
  }

  const direction: "up" | "down" = upVotes >= downVotes ? "up" : "down";
  const avgConf = count > 0 ? totalConf / count : 0.50;
  return { direction, confidence: Math.min(avgConf, 0.70) };
}

function ensembleConfidenceWeighted(w: WindowData): StrategySignal {
  let upWeight = 0;
  let downWeight = 0;

  for (const s of individualStrategies) {
    const sig = s.fn(w);
    if (sig.direction === "up") {
      upWeight += sig.confidence;
    } else if (sig.direction === "down") {
      downWeight += sig.confidence;
    }
  }

  if (upWeight === 0 && downWeight === 0) {
    return { direction: "skip", confidence: 0.49 };
  }

  const total = upWeight + downWeight;
  const direction: "up" | "down" = upWeight >= downWeight ? "up" : "down";
  const confidence = Math.max(upWeight, downWeight) / total;
  return { direction, confidence: Math.min(confidence, 0.70) };
}

// Top-2 Thompson needs rolling performance, so it's window-aware
function createTop2ThompsonStrategy(): (w: WindowData, windowIdx: number) => StrategySignal {
  // Track per-strategy alpha/beta
  const alphas: Record<string, number> = {};
  const betas: Record<string, number> = {};
  for (const s of individualStrategies) {
    alphas[s.name] = 1;
    betas[s.name] = 1;
  }

  return (w: WindowData, _windowIdx: number): StrategySignal => {
    // Sample from each strategy's Beta distribution, pick top 2
    const samples = individualStrategies.map((s) => ({
      name: s.name,
      fn: s.fn,
      sample: sampleBetaSimple(alphas[s.name], betas[s.name]),
    }));
    samples.sort((a, b) => b.sample - a.sample);
    const top2 = samples.slice(0, 2);

    // Run top 2, pick highest confidence
    let bestSignal: StrategySignal = { direction: "skip", confidence: 0.49 };
    for (const t of top2) {
      const sig = t.fn(w);
      if (sig.direction !== "skip" && sig.confidence > bestSignal.confidence) {
        bestSignal = sig;
      }
    }

    return bestSignal;
  };
}

function createTop2ThompsonUpdater(): (strategyResults: Record<string, boolean>) => void {
  const alphas: Record<string, number> = {};
  const betas: Record<string, number> = {};
  for (const s of individualStrategies) {
    alphas[s.name] = 1;
    betas[s.name] = 1;
  }

  return (strategyResults: Record<string, boolean>) => {
    for (const [name, won] of Object.entries(strategyResults)) {
      if (won) alphas[name] = (alphas[name] || 1) + 1;
      else betas[name] = (betas[name] || 1) + 1;
      // Discount
      alphas[name] *= 0.995;
      betas[name] *= 0.995;
    }
  };
}

function sampleBetaSimple(alpha: number, beta: number): number {
  const x = sampleGammaSimple(alpha);
  const y = sampleGammaSimple(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function sampleGammaSimple(shape: number): number {
  if (shape < 1) {
    return sampleGammaSimple(shape + 1) * Math.pow(Math.random(), 1 / shape);
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

function createDynamicThresholdStrategy(): (w: WindowData, windowIdx: number) => StrategySignal {
  // Track rolling 50-window win rate per strategy
  const histories: Record<string, boolean[]> = {};
  for (const s of individualStrategies) {
    histories[s.name] = [];
  }

  return (w: WindowData, _windowIdx: number): StrategySignal => {
    let bestSignal: StrategySignal = { direction: "skip", confidence: 0.49 };
    let bestAdjustedConf = 0;

    for (const s of individualStrategies) {
      const sig = s.fn(w);
      if (sig.direction === "skip") continue;

      // Compute rolling WR for this strategy
      const hist = histories[s.name];
      const recentWr =
        hist.length >= 20
          ? hist.slice(-50).filter(Boolean).length / Math.min(hist.length, 50)
          : 0.5;

      // Adjust confidence by rolling WR
      const adjustedConf = sig.confidence * (0.5 + recentWr);
      if (adjustedConf > bestAdjustedConf && sig.direction !== "skip") {
        bestAdjustedConf = adjustedConf;
        bestSignal = { direction: sig.direction, confidence: Math.min(sig.confidence, 0.70) };
      }
    }

    return bestSignal;
  };
}

function createDynamicThresholdUpdater(): (w: WindowData) => void {
  const histories: Record<string, boolean[]> = {};
  for (const s of individualStrategies) {
    histories[s.name] = [];
  }

  return (w: WindowData) => {
    for (const s of individualStrategies) {
      const sig = s.fn(w);
      if (sig.direction === "skip") continue;
      const won = sig.direction === "up" ? w.priceWentUp : !w.priceWentUp;
      histories[s.name].push(won);
    }
  };
}

// ─── Main Backtest Runner ────────────────────────────────────────

export function runBacktest(numWindows: number = 2000): BacktestRunResult {
  console.log(`[Backtest] Starting with ${numWindows} windows...`);
  const startTime = Date.now();

  // Generate price data
  const windows = generatePriceData(numWindows);

  const allResults: StrategyBacktestResult[] = [];

  // 1. Test individual strategies
  for (const strat of individualStrategies) {
    const trades: TradeResult[] = windows.map((w) =>
      evaluateTrade(strat.fn(w), w)
    );
    allResults.push(computeStats(strat.name, trades));
  }

  // 2. Ensemble: Majority Vote
  {
    const trades: TradeResult[] = windows.map((w) =>
      evaluateTrade(ensembleMajorityVote(w), w)
    );
    allResults.push(computeStats("majorityVote", trades));
  }

  // 3. Ensemble: Confidence-Weighted Vote
  {
    const trades: TradeResult[] = windows.map((w) =>
      evaluateTrade(ensembleConfidenceWeighted(w), w)
    );
    allResults.push(computeStats("confidenceWeighted", trades));
  }

  // 4. Ensemble: Top-2 Thompson
  {
    const top2Fn = createTop2ThompsonStrategy();
    // We need to track per-strategy outcomes and update Thompson params
    const alphas: Record<string, number> = {};
    const betas_: Record<string, number> = {};
    for (const s of individualStrategies) {
      alphas[s.name] = 1;
      betas_[s.name] = 1;
    }

    const trades: TradeResult[] = [];
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];

      // Sample and pick top 2
      const samples = individualStrategies.map((s) => ({
        name: s.name,
        fn: s.fn,
        sample: sampleBetaSimple(alphas[s.name], betas_[s.name]),
      }));
      samples.sort((a, b) => b.sample - a.sample);
      const top2 = samples.slice(0, 2);

      // Run top 2, pick highest confidence
      let bestSignal: StrategySignal = { direction: "skip", confidence: 0.49 };
      let bestStratName = "";
      for (const t of top2) {
        const sig = t.fn(w);
        if (sig.direction !== "skip" && sig.confidence > bestSignal.confidence) {
          bestSignal = sig;
          bestStratName = t.name;
        }
      }

      const trade = evaluateTrade(bestSignal, w);
      trades.push(trade);

      // Update Thompson parameters for all individual strategies
      for (const s of individualStrategies) {
        const sig = s.fn(w);
        if (sig.direction === "skip") continue;
        const won = sig.direction === "up" ? w.priceWentUp : !w.priceWentUp;
        if (won) alphas[s.name] += 1;
        else betas_[s.name] += 1;
        // Discount
        alphas[s.name] *= 0.995;
        betas_[s.name] *= 0.995;
      }
    }

    allResults.push(computeStats("top2Thompson", trades));
  }

  // 5. Ensemble: Dynamic Threshold
  {
    const histories: Record<string, boolean[]> = {};
    for (const s of individualStrategies) {
      histories[s.name] = [];
    }

    const trades: TradeResult[] = [];
    for (const w of windows) {
      let bestSignal: StrategySignal = { direction: "skip", confidence: 0.49 };
      let bestAdjustedConf = 0;

      for (const s of individualStrategies) {
        const sig = s.fn(w);
        if (sig.direction === "skip") continue;

        const hist = histories[s.name];
        const recentWr =
          hist.length >= 20
            ? hist.slice(-50).filter(Boolean).length / Math.min(hist.length, 50)
            : 0.5;

        const adjustedConf = sig.confidence * (0.5 + recentWr);
        if (adjustedConf > bestAdjustedConf) {
          bestAdjustedConf = adjustedConf;
          bestSignal = {
            direction: sig.direction,
            confidence: Math.min(sig.confidence, 0.70),
          };
        }
      }

      const trade = evaluateTrade(bestSignal, w);
      trades.push(trade);

      // Update histories
      for (const s of individualStrategies) {
        const sig = s.fn(w);
        if (sig.direction === "skip") continue;
        const won = sig.direction === "up" ? w.priceWentUp : !w.priceWentUp;
        histories[s.name].push(won);
      }
    }

    allResults.push(computeStats("dynamicThreshold", trades));
  }

  // Sort by win rate descending
  allResults.sort((a, b) => b.winRate - a.winRate);

  const bestModel = allResults.length > 0 ? allResults[0].strategyName : "none";
  const timestamp = new Date().toISOString();
  const batchId = crypto.randomBytes(8).toString("hex");

  // Save to database
  for (const result of allResults) {
    storage.saveBacktestResult({
      strategyName: result.strategyName,
      totalTrades: result.totalTrades,
      wins: result.wins,
      losses: result.losses,
      winRate: result.winRate,
      totalPnl: result.totalPnl,
      avgPnl: result.avgPnl,
      maxDrawdown: result.maxDrawdown,
      sharpeRatio: result.sharpeRatio,
      avgConfidence: result.avgConfidence,
      rollingWr50: JSON.stringify(result.rollingWr50),
      runAt: timestamp,
      batchId,
    });
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[Backtest] Complete in ${elapsed}ms. Best model: ${bestModel} (WR: ${allResults[0]?.winRate ?? 0})`
  );

  storage.addAuditEntry(
    "бэктест",
    `Завершён бэктест ${numWindows} окон. Лучшая модель: ${bestModel} (WR: ${((allResults[0]?.winRate ?? 0) * 100).toFixed(1)}%)`
  );

  return { results: allResults, bestModel, timestamp, batchId };
}
