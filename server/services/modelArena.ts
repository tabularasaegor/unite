/**
 * MODEL ARENA — Соревновательная система моделей
 * 
 * 5 моделей конкурируют за право торговать:
 * 1. TA_MOMENTUM — RSI + EMA crossover + Bollinger Bands
 * 2. TA_MEAN_REVERSION — Bollinger %B + RSI oversold/overbought
 * 3. ORDERBOOK_IMBALANCE — Market price deviation = order flow signal
 * 4. BAYESIAN_BASE — Base rate 56% + market signal + calibration
 * 5. REGIME_DETECTOR — Trend vs Range via ADX + volatility
 * 
 * Каждая модель:
 * - Получает одинаковые входные данные
 * - Выдает direction (Up/Down) + confidence (0-1)
 * - Имеет ELO-подобный рейтинг, обновляемый после каждого settlement
 * - Получает долю от bankroll пропорционально рейтингу
 * 
 * Weighted Majority Algorithm (Numin/Numerai approach):
 * - Итоговое решение = weighted vote всех моделей
 * - Веса = softmax(ratings)
 * - При хороших результатах — рейтинг растёт, модель получает больше влияния
 * - При плохих — рейтинг падает, влияние уменьшается
 */

import { log } from "../index";
import { storage } from "../storage";

// Injected from cryptoMicroScheduler to avoid circular dependency
let _getRollingBaseRate: () => number = () => 0.50;
export function setBaseRateProvider(fn: () => number) { _getRollingBaseRate = fn; }

// ============================================================
// PRICE DATA FETCHING
// ============================================================
interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const priceCache: Record<string, { candles: Candle[]; fetchedAt: number }> = {};

async function fetchCandles(asset: string, limit: number = 60): Promise<Candle[]> {
  const cacheKey = asset;
  const now = Date.now();
  if (priceCache[cacheKey] && now - priceCache[cacheKey].fetchedAt < 60000) {
    return priceCache[cacheKey].candles;
  }

  const symbolMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symbolMap[asset] || asset.toUpperCase();
  
  try {
    const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=${limit}&aggregate=5`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.Data?.Data) {
      const candles: Candle[] = data.Data.Data.map((c: any) => ({
        time: c.time * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volumefrom || 0,
      }));
      priceCache[cacheKey] = { candles, fetchedAt: now };
      return candles;
    }
  } catch (err) {
    log(`Arena: Failed to fetch candles for ${asset}: ${err}`, "micro");
  }
  return priceCache[cacheKey]?.candles || [];
}

// ============================================================
// TECHNICAL INDICATORS
// ============================================================
function calcRSI(closes: number[], period: number = 14): number | null {
  const TI = require("technicalindicators");
  const result = TI.RSI.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

function calcEMA(closes: number[], period: number): number | null {
  const TI = require("technicalindicators");
  const result = TI.EMA.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

function calcBollingerBands(closes: number[], period: number = 20): { upper: number; middle: number; lower: number; pb: number } | null {
  const TI = require("technicalindicators");
  const result = TI.BollingerBands.calculate({ period, values: closes, stdDev: 2 });
  return result.length > 0 ? result[result.length - 1] : null;
}

function calcATR(candles: Candle[], period: number = 14): number | null {
  const TI = require("technicalindicators");
  const result = TI.ATR.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
  return result.length > 0 ? result[result.length - 1] : null;
}

function calcADX(candles: Candle[], period: number = 14): number | null {
  const TI = require("technicalindicators");
  const result = TI.ADX.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
  return result.length > 0 ? result[result.length - 1]?.adx : null;
}

// ============================================================
// MODEL PREDICTIONS
// ============================================================
export interface ModelPrediction {
  modelName: string;
  direction: "Up" | "Down";
  confidence: number; // 0.50-0.95
  reasoning: string;
}

// --- Model 1: TA MOMENTUM ---
// Uses RSI + EMA crossover: EMA5 > EMA20 = bullish momentum
function modelTAMomentum(candles: Candle[], upPrice: number): ModelPrediction {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const ema5 = calcEMA(closes, 5);
  const ema20 = calcEMA(closes, 20);
  
  let bullishSignals = 0;
  let bearishSignals = 0;
  const reasons: string[] = [];

  if (rsi !== null) {
    if (rsi > 55) { bullishSignals++; reasons.push(`RSI=${rsi.toFixed(0)}>55`); }
    else if (rsi < 45) { bearishSignals++; reasons.push(`RSI=${rsi.toFixed(0)}<45`); }
    else reasons.push(`RSI=${rsi.toFixed(0)}~neutral`);
  }

  if (ema5 !== null && ema20 !== null) {
    if (ema5 > ema20) { bullishSignals++; reasons.push(`EMA5>EMA20`); }
    else { bearishSignals++; reasons.push(`EMA5<EMA20`); }
  }

  // Price trend: last 3 candles
  if (closes.length >= 4) {
    const recent = closes.slice(-4);
    const trending = recent[3] > recent[0];
    if (trending) { bullishSignals++; reasons.push(`trend↑`); }
    else { bearishSignals++; reasons.push(`trend↓`); }
  }

  const direction: "Up" | "Down" = bullishSignals > bearishSignals ? "Up" : "Down";
  const strength = Math.abs(bullishSignals - bearishSignals) / 3;
  const confidence = 0.50 + strength * 0.20;

  return {
    modelName: "TA_MOMENTUM",
    direction,
    confidence: Math.min(0.80, confidence),
    reasoning: reasons.join(" "),
  };
}

// --- Model 2: TA MEAN REVERSION ---
// Bollinger %B: price near lower band = buy, near upper = sell
function modelTAMeanReversion(candles: Candle[], upPrice: number): ModelPrediction {
  const closes = candles.map(c => c.close);
  const bb = calcBollingerBands(closes, 20);
  const rsi = calcRSI(closes, 14);
  
  let direction: "Up" | "Down" = "Up";
  let confidence = 0.52;
  const reasons: string[] = [];

  if (bb) {
    const lastClose = closes[closes.length - 1];
    if (bb.pb < 0.20) {
      // Price near lower band → expect reversion Up
      direction = "Up";
      confidence = 0.55 + (0.20 - bb.pb) * 0.5;
      reasons.push(`BB%B=${bb.pb.toFixed(2)}<0.2→revert↑`);
    } else if (bb.pb > 0.80) {
      // Price near upper band → expect reversion Down
      direction = "Down";
      confidence = 0.55 + (bb.pb - 0.80) * 0.5;
      reasons.push(`BB%B=${bb.pb.toFixed(2)}>0.8→revert↓`);
    } else {
      reasons.push(`BB%B=${bb.pb.toFixed(2)}~mid`);
    }
  }

  if (rsi !== null) {
    if (rsi < 30) { direction = "Up"; confidence = Math.max(confidence, 0.60); reasons.push(`RSI=${rsi.toFixed(0)}<30→oversold`); }
    else if (rsi > 70) { direction = "Down"; confidence = Math.max(confidence, 0.60); reasons.push(`RSI=${rsi.toFixed(0)}>70→overbought`); }
  }

  return {
    modelName: "TA_MEAN_REVERSION",
    direction,
    confidence: Math.min(0.80, confidence),
    reasoning: reasons.join(" "),
  };
}

// --- Model 3: ORDERBOOK IMBALANCE ---
// Market price deviation from 50% = order flow imbalance signal
// Historical: price > 0.50 → Up resolves 62%
function modelOrderbookImbalance(candles: Candle[], upPrice: number): ModelPrediction {
  const deviation = upPrice - 0.5;
  const baseRate = _getRollingBaseRate();
  const reasons: string[] = [];
  let direction: "Up" | "Down";
  let confidence: number;

  if (Math.abs(deviation) < 0.02) {
    // Neutral zone — use rolling base rate
    direction = baseRate >= 0.50 ? "Up" : "Down";
    confidence = Math.max(0.51, baseRate);
    reasons.push(`нейтральный→base=${(baseRate*100).toFixed(0)}%`);
  } else if (deviation > 0) {
    // Market says Up — FOLLOW
    direction = "Up";
    confidence = 0.52 + Math.min(deviation * 2, 0.15);
    reasons.push(`стакан:↑${(upPrice*100).toFixed(0)}%`);
  } else {
    // Market says Down — FOLLOW (not contrarian!)
    direction = "Down";
    confidence = 0.52 + Math.min(Math.abs(deviation) * 2, 0.15);
    reasons.push(`стакан:↓${((1-upPrice)*100).toFixed(0)}%`);
  }

  return {
    modelName: "ORDERBOOK_IMBALANCE",
    direction,
    confidence: Math.min(0.75, confidence),
    reasoning: reasons.join(" "),
  };
}

// --- Model 4: BAYESIAN BASE ---
// Pure Bayesian update from base rate + market signal + asset calibration
function modelBayesianBase(candles: Candle[], upPrice: number, assetCalibration: { upWR: number; totalTrades: number }): ModelPrediction {
  const BASE_RATE = _getRollingBaseRate();
  let prob = BASE_RATE;
  let weight = 1.0;
  const reasons: string[] = [`base=${(BASE_RATE*100).toFixed(0)}%`];

  // Market signal — follow market direction
  if (upPrice > 0.51) {
    const mktConf = Math.min(0.65, 0.50 + Math.abs(upPrice - 0.5) * 2);
    prob = (prob * weight + mktConf * 2.0) / (weight + 2.0);
    weight += 2.0;
    reasons.push(`market↑${(upPrice*100).toFixed(0)}%`);
  } else if (upPrice < 0.49) {
    const mktConf = Math.max(0.35, 0.50 - Math.abs(upPrice - 0.5) * 2);
    prob = (prob * weight + mktConf * 2.0) / (weight + 2.0);
    weight += 2.0;
    reasons.push(`market↓${((1-upPrice)*100).toFixed(0)}%`);
  }

  // Asset calibration
  if (assetCalibration.totalTrades >= 10) {
    const smoothed = (assetCalibration.upWR * Math.min(assetCalibration.totalTrades, 30) + BASE_RATE * 20) / (Math.min(assetCalibration.totalTrades, 30) + 20);
    prob = (prob * weight + smoothed * 1.0) / (weight + 1.0);
    weight += 1.0;
    reasons.push(`cal=${(smoothed*100).toFixed(0)}%`);
  }

  prob = Math.max(0.35, Math.min(0.65, prob));
  
  const edgeUp = prob - upPrice;
  const edgeDown = (1 - prob) - (1 - upPrice);
  
  const direction: "Up" | "Down" = edgeUp >= edgeDown ? "Up" : "Down";
  const edge = direction === "Up" ? edgeUp : edgeDown;
  const confidence = 0.50 + Math.max(0, edge);

  return {
    modelName: "BAYESIAN_BASE",
    direction,
    confidence: Math.min(0.70, confidence),
    reasoning: `P(Up)=${(prob*100).toFixed(1)}% edge=${(edge*100).toFixed(1)}% ${reasons.join(" ")}`,
  };
}

// --- Model 5: REGIME DETECTOR ---
// ADX > 25 = trending → follow momentum. ADX < 20 = ranging → mean revert
function modelRegimeDetector(candles: Candle[], upPrice: number): ModelPrediction {
  const closes = candles.map(c => c.close);
  const adx = calcADX(candles, 14);
  const atr = calcATR(candles, 14);
  const reasons: string[] = [];
  
  let direction: "Up" | "Down" = "Up";
  let confidence = 0.52;

  const isTrending = adx !== null && adx > 25;
  const isRanging = adx !== null && adx < 20;
  
  if (adx !== null) reasons.push(`ADX=${adx.toFixed(0)}`);
  if (atr !== null) {
    const avgClose = closes.reduce((a,b)=>a+b) / closes.length;
    const volPct = (atr / avgClose) * 100;
    reasons.push(`vol=${volPct.toFixed(2)}%`);
  }

  if (isTrending) {
    // Trending → follow recent direction
    const ema5 = calcEMA(closes, 5);
    const ema20 = calcEMA(closes, 20);
    if (ema5 !== null && ema20 !== null) {
      direction = ema5 > ema20 ? "Up" : "Down";
      confidence = 0.58;
      reasons.push(`trend→${direction}`);
    }
  } else if (isRanging) {
    // Ranging → mean revert
    const bb = calcBollingerBands(closes, 20);
    if (bb) {
      direction = bb.pb < 0.40 ? "Up" : bb.pb > 0.60 ? "Down" : "Up";
      confidence = 0.55;
      reasons.push(`range→revert_${direction}`);
    }
  } else {
    // Mixed → use base rate
    direction = "Up";
    confidence = 0.53;
    reasons.push(`mixed→base_rate`);
  }

  return {
    modelName: "REGIME_DETECTOR",
    direction,
    confidence: Math.min(0.70, confidence),
    reasoning: reasons.join(" "),
  };
}

// ============================================================
// MODEL RATINGS & WEIGHTED MAJORITY
// ============================================================
interface ModelRating {
  name: string;
  rating: number;      // ELO-like score, starts at 1000
  trades: number;
  wins: number;
  pnl: number;
  recentResults: boolean[]; // last 20
}

const modelRatings: Record<string, ModelRating> = {};
const MODEL_NAMES = ["TA_MOMENTUM", "TA_MEAN_REVERSION", "ORDERBOOK_IMBALANCE", "BAYESIAN_BASE", "REGIME_DETECTOR"];

function getModelRating(name: string): ModelRating {
  if (!modelRatings[name]) {
    modelRatings[name] = { name, rating: 1000, trades: 0, wins: 0, pnl: 0, recentResults: [] };
  }
  return modelRatings[name];
}

function updateModelRating(name: string, won: boolean, pnl: number) {
  const mr = getModelRating(name);
  mr.trades++;
  if (won) mr.wins++;
  mr.pnl += pnl;
  mr.recentResults.push(won);
  if (mr.recentResults.length > 20) mr.recentResults.shift();
  
  // ELO-like update: +25 for win, -25 for loss
  // Bonus/penalty based on streak
  const K = 25;
  mr.rating += won ? K : -K;
  
  // Floor at 500, cap at 2000
  mr.rating = Math.max(500, Math.min(2000, mr.rating));
}

function softmaxWeights(): Record<string, number> {
  const ratings: Record<string, number> = {};
  let total = 0;
  for (const name of MODEL_NAMES) {
    const mr = getModelRating(name);
    const exp = Math.exp((mr.rating - 1000) / 200); // temperature = 200
    ratings[name] = exp;
    total += exp;
  }
  for (const name of MODEL_NAMES) {
    ratings[name] /= total;
  }
  return ratings;
}

// ============================================================
// ENSEMBLE DECISION
// ============================================================
export interface ArenaDecision {
  direction: "Up" | "Down";
  confidence: number;
  edge: number;
  kellyFraction: number;
  reasoning: string;
  models: ModelPrediction[];
  weights: Record<string, number>;
  blocked: boolean;
  blockReason: string;
}

export async function runModelArena(
  asset: string,
  upPrice: number,
  liquidity: number,
  assetCalibration: { upWR: number; totalTrades: number }
): Promise<ArenaDecision> {
  const candles = await fetchCandles(asset, 60);
  
  // Run all 5 models
  const predictions: ModelPrediction[] = [];
  
  if (candles.length >= 20) {
    predictions.push(modelTAMomentum(candles, upPrice));
    predictions.push(modelTAMeanReversion(candles, upPrice));
    predictions.push(modelRegimeDetector(candles, upPrice));
  }
  predictions.push(modelOrderbookImbalance(candles, upPrice));
  predictions.push(modelBayesianBase(candles, upPrice, assetCalibration));

  // Get current weights
  const weights = softmaxWeights();
  
  // Weighted vote
  let upScore = 0;
  let downScore = 0;
  
  for (const pred of predictions) {
    const w = weights[pred.modelName] || (1 / MODEL_NAMES.length);
    const vote = pred.confidence * w;
    if (pred.direction === "Up") upScore += vote;
    else downScore += vote;
  }
  
  const direction: "Up" | "Down" = upScore >= downScore ? "Up" : "Down";
  const totalScore = upScore + downScore;
  const winScore = direction === "Up" ? upScore : downScore;
  const confidence = totalScore > 0 ? winScore / totalScore : 0.50;
  
  // Edge calculation
  const impliedProb = direction === "Up" ? upPrice : (1 - upPrice);
  const trueProb = confidence;
  const edge = trueProb - impliedProb;
  
  // Kelly sizing
  const price = direction === "Up" ? upPrice : (1 - upPrice);
  const odds = 1 / price;
  const kellyFull = edge > 0 ? edge / (odds - 1) : 0;
  const kellyFraction = kellyFull * 0.30; // Conservative Kelly
  
  // Trade blocking
  let blocked = false;
  let blockReason = "";
  const deviation = Math.abs(upPrice - 0.5);
  
  if (deviation > 0.15) { blocked = true; blockReason = `девиация ${(deviation*100).toFixed(0)}%`; }
  else if (liquidity < 500) { blocked = true; blockReason = `ликвидность $${liquidity.toFixed(0)}`; }
  // No edge/disagreement blocking — always trade, size adjusts risk

  // Build reasoning
  const modelVotes = predictions.map(p => {
    const w = weights[p.modelName] || 0;
    return `${p.modelName.replace('TA_','').substring(0,6)}:${p.direction}(${(p.confidence*100).toFixed(0)}%,w=${(w*100).toFixed(0)}%)`;
  }).join(" ");
  
  const reasoning = [
    `${direction} edge=${(edge*100).toFixed(1)}% kelly=${(kellyFraction*100).toFixed(1)}%`,
    `models: ${modelVotes}`,
    blocked ? `БЛОК:${blockReason}` : "",
  ].filter(Boolean).join(" | ");

  return {
    direction, confidence, edge, kellyFraction, reasoning,
    models: predictions, weights, blocked, blockReason,
  };
}

// ============================================================
// POST-SETTLEMENT UPDATE
// ============================================================
export function updateArenaResults(modelPredictions: ModelPrediction[], resolvedUp: boolean, pnl: number) {
  for (const pred of modelPredictions) {
    const correct = (pred.direction === "Up" && resolvedUp) || (pred.direction === "Down" && !resolvedUp);
    updateModelRating(pred.modelName, correct, correct ? Math.abs(pnl) : -Math.abs(pnl));
  }
  
  // Persist ratings
  try {
    storage.upsertMemory({
      category: "model_arena",
      key: "ratings",
      value: JSON.stringify(modelRatings),
      confidence: 1,
      createdAt: new Date().toISOString(),
    });
  } catch {}
}

// ============================================================
// LOAD RATINGS FROM DB
// ============================================================
export function loadArenaRatings() {
  try {
    const mem = storage.getMemory("model_arena", "ratings");
    if (mem.length > 0) {
      const saved = JSON.parse(mem[0].value);
      for (const [name, data] of Object.entries(saved)) {
        modelRatings[name] = data as ModelRating;
      }
      log(`Arena: Loaded ratings for ${Object.keys(modelRatings).length} models`, "micro");
    }
  } catch {}
}

// ============================================================
// PUBLIC API
// ============================================================
export function getArenaStatus() {
  const weights = softmaxWeights();
  return MODEL_NAMES.map(name => {
    const mr = getModelRating(name);
    const recentWR = mr.recentResults.length > 0 
      ? Math.round(mr.recentResults.filter(w => w).length / mr.recentResults.length * 100)
      : 0;
    return {
      name,
      rating: mr.rating,
      weight: Math.round((weights[name] || 0) * 100),
      trades: mr.trades,
      wins: mr.wins,
      winRate: mr.trades > 0 ? Math.round(mr.wins / mr.trades * 100) : 0,
      recentWR,
      pnl: Math.round(mr.pnl * 100) / 100,
    };
  }).sort((a, b) => b.rating - a.rating);
}
