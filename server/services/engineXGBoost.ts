/**
 * ENGINE F: ML Ensemble (Random Forest) 
 * 
 * Uses ml-random-forest as a JS-native alternative to XGBoost.
 * Trained on features extracted from real-time data:
 * - Spot price momentum (1m, 3m, 5m, 10m, 15m)
 * - Orderbook imbalance (Polymarket upPrice deviation from 0.50)
 * - Volume profile (spike detection, trend)
 * - Time-of-day features (hour, minute within window)
 * - VWAP deviation
 * - Trend alignment (from trendAnalysis.ts)
 * 
 * Online learning: retrains every 50 new settled trades on accumulated data.
 * Cold start: uses simple heuristic ensemble until 30+ training samples.
 */

import { log } from "../index";
import { storage } from "../storage";
import { analyzeTrend } from "./trendAnalysis";

interface MLSignal {
  direction: "Up" | "Down";
  confidence: number;
  features: Record<string, number>;
  reasoning: string;
  blocked: boolean;
  kellyFraction: number;
  modelTrained: boolean;
}

// Training data accumulator
interface TrainingSample {
  features: number[];
  label: number; // 1 = Up resolved, 0 = Down resolved
}

const trainingData: TrainingSample[] = [];
let rfModel: any = null;
let lastTrainSize = 0;
const RETRAIN_INTERVAL = 50; // Retrain every 50 new samples
const MIN_TRAIN_SAMPLES = 30;

// Feature extraction cache
const featureCache: Record<string, { features: Record<string, number>; fetchedAt: number }> = {};

async function extractFeatures(asset: string, upPrice: number, liquidity: number): Promise<Record<string, number>> {
  const now = Date.now();
  const cacheKey = `${asset}_${Math.floor(now / 30000)}`; // 30s cache
  if (featureCache[cacheKey]) return featureCache[cacheKey].features;

  const symMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symMap[asset] || asset.toUpperCase();

  let candles: any[] = [];
  try {
    const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=20`);
    const data = await res.json();
    if (data.Data?.Data) candles = data.Data.Data;
  } catch {}

  const closes = candles.map((c: any) => c.close as number);
  const volumes = candles.map((c: any) => (c.volumefrom || 0) as number);
  const lastPrice = closes[closes.length - 1] || 0;

  // Momentum features
  const mom1m = closes.length >= 2 ? (closes[closes.length-1] - closes[closes.length-2]) / closes[closes.length-2] : 0;
  const mom3m = closes.length >= 4 ? (closes[closes.length-1] - closes[closes.length-4]) / closes[closes.length-4] : 0;
  const mom5m = closes.length >= 6 ? (closes[closes.length-1] - closes[closes.length-6]) / closes[closes.length-6] : 0;
  const mom10m = closes.length >= 11 ? (closes[closes.length-1] - closes[closes.length-11]) / closes[closes.length-11] : 0;
  const mom15m = closes.length >= 16 ? (closes[closes.length-1] - closes[closes.length-16]) / closes[closes.length-16] : 0;

  // Orderbook imbalance
  const obi = upPrice - 0.50; // deviation from fair value

  // Volume features
  const avgVol = volumes.length > 5 ? volumes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5 : 1;
  const lastVol = volumes[volumes.length - 1] || 0;
  const volSpike = avgVol > 0 ? lastVol / avgVol : 1;
  const volTrend = volumes.length >= 6 
    ? (volumes.slice(-3).reduce((a: number,b: number) => a+b, 0) / 3) / Math.max(1, volumes.slice(-6, -3).reduce((a: number,b: number) => a+b, 0) / 3) 
    : 1;

  // VWAP deviation
  let vwap = lastPrice;
  if (candles.length >= 10) {
    let cumPV = 0, cumV = 0;
    for (const c of candles.slice(-10)) {
      const tp = (c.high + c.low + c.close) / 3;
      cumPV += tp * (c.volumefrom || 0);
      cumV += (c.volumefrom || 0);
    }
    if (cumV > 0) vwap = cumPV / cumV;
  }
  const vwapDev = lastPrice > 0 ? (lastPrice - vwap) / lastPrice : 0;

  // Time features
  const utcHour = new Date().getUTCHours();
  const minuteInWindow = Math.floor(Date.now() / 1000) % 300; // 0-299 seconds into 5-min window

  // Trend from higher timeframe
  const trend = await analyzeTrend(asset);
  const trendDir = trend.direction === "Up" ? 1 : trend.direction === "Down" ? -1 : 0;
  const trendConf = trend.confidence;

  // Consecutive candle direction
  let consUp = 0, consDown = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 8); i--) {
    if (candles[i].close > candles[i].open) { if (consDown > 0) break; consUp++; }
    else { if (consUp > 0) break; consDown++; }
  }

  const features: Record<string, number> = {
    mom1m: mom1m * 1000,    // scale to reasonable range
    mom3m: mom3m * 1000,
    mom5m: mom5m * 1000,
    mom10m: mom10m * 1000,
    mom15m: mom15m * 1000,
    obi: obi * 100,
    volSpike,
    volTrend,
    vwapDev: vwapDev * 1000,
    utcHour: utcHour / 24,     // normalize 0-1
    minuteInWindow: minuteInWindow / 300,
    trendDir,
    trendConf,
    consUp: consUp / 8,
    consDown: consDown / 8,
    liquidity: Math.log10(Math.max(1, liquidity)) / 5,
  };

  featureCache[cacheKey] = { features, fetchedAt: now };
  return features;
}

function featuresToArray(f: Record<string, number>): number[] {
  return [f.mom1m, f.mom3m, f.mom5m, f.mom10m, f.mom15m, f.obi, f.volSpike, f.volTrend, f.vwapDev, f.utcHour, f.minuteInWindow, f.trendDir, f.trendConf, f.consUp, f.consDown, f.liquidity];
}

function trainModel(): boolean {
  if (trainingData.length < MIN_TRAIN_SAMPLES) return false;

  try {
    const { RandomForestClassifier } = require("ml-random-forest");
    const X = trainingData.map(s => s.features);
    const Y = trainingData.map(s => s.label);

    rfModel = new RandomForestClassifier({
      nEstimators: 50,
      maxDepth: 5,
      seed: 42,
    });
    rfModel.train(X, Y);
    lastTrainSize = trainingData.length;
    log(`ML Engine F: Trained on ${trainingData.length} samples`, "micro");
    return true;
  } catch (err) {
    log(`ML Engine F: Training error: ${err}`, "micro");
    return false;
  }
}

/** Add a resolved trade to training data */
export function addMLTrainingSample(features: Record<string, number>, resolvedUp: boolean) {
  trainingData.push({
    features: featuresToArray(features),
    label: resolvedUp ? 1 : 0,
  });
  // Keep max 500 samples (rolling window)
  if (trainingData.length > 500) trainingData.shift();

  // Retrain if enough new samples
  if (trainingData.length >= MIN_TRAIN_SAMPLES && trainingData.length - lastTrainSize >= RETRAIN_INTERVAL) {
    trainModel();
  }
}

/** Load training data from DB on startup */
export function loadMLTrainingData() {
  try {
    const mem = storage.getMemory("ml_training", "data");
    if (mem.length > 0) {
      const saved = JSON.parse(mem[0].value);
      if (Array.isArray(saved)) {
        trainingData.length = 0;
        trainingData.push(...saved.slice(-500));
        log(`ML Engine F: Loaded ${trainingData.length} training samples from DB`, "micro");
        if (trainingData.length >= MIN_TRAIN_SAMPLES) trainModel();
      }
    }
  } catch {}
}

/** Save training data to DB */
function saveMLTrainingData() {
  try {
    storage.upsertMemory({
      category: "ml_training",
      key: "data",
      value: JSON.stringify(trainingData.slice(-500)),
      confidence: 1,
      createdAt: new Date().toISOString(),
    });
  } catch {}
}

export async function runMLPredict(asset: string, upPrice: number, liquidity: number): Promise<MLSignal> {
  const features = await extractFeatures(asset, upPrice, liquidity);
  const featureArr = featuresToArray(features);

  // If model is trained, use it
  if (rfModel && trainingData.length >= MIN_TRAIN_SAMPLES) {
    try {
      const prediction = rfModel.predict([featureArr])[0]; // 0 or 1
      // Get probability estimate from individual trees
      const proba = rfModel.predictionValues ? rfModel.predictionValues[0] : null;
      
      const direction: "Up" | "Down" = prediction === 1 ? "Up" : "Down";
      // Confidence from prediction strength
      let confidence = 0.53; // base for trained model
      
      // Simple confidence from feature alignment
      const momSignal = features.mom3m > 0 ? 1 : -1;
      const predSignal = prediction === 1 ? 1 : -1;
      if (momSignal === predSignal) confidence += 0.02;
      if (features.trendDir === predSignal) confidence += 0.02;

      const edge = Math.max(0, confidence - 0.50);
      const kellyFraction = edge * 0.55;

      // Save training data periodically
      if (trainingData.length % 20 === 0) saveMLTrainingData();

      return {
        direction,
        confidence: Math.min(0.65, confidence),
        features,
        reasoning: `RF(${trainingData.length}): ${direction} mom3m=${features.mom3m.toFixed(2)} obi=${features.obi.toFixed(1)} trend=${features.trendDir}`,
        blocked: false,
        kellyFraction,
        modelTrained: true,
      };
    } catch (err) {
      log(`ML Engine F predict error: ${err}`, "micro");
    }
  }

  // Cold start: simple heuristic ensemble
  let upScore = 0, downScore = 0;
  if (features.mom3m > 0.5) upScore += 2; else if (features.mom3m < -0.5) downScore += 2;
  if (features.obi > 1) upScore += 1; else if (features.obi < -1) downScore += 1;
  if (features.vwapDev > 0.5) upScore += 1; else if (features.vwapDev < -0.5) downScore += 1;
  if (features.trendDir > 0) upScore += 1.5; else if (features.trendDir < 0) downScore += 1.5;

  const direction: "Up" | "Down" = upScore >= downScore ? "Up" : "Down";
  const totalScore = upScore + downScore;
  let confidence = 0.51;
  if (totalScore > 2) confidence = 0.53;
  if (totalScore > 4) confidence = 0.55;

  const blocked = totalScore < 1.5;
  const edge = Math.max(0, confidence - 0.50);
  const kellyFraction = edge * 0.35; // Lower kelly for heuristic

  return {
    direction,
    confidence: Math.min(0.60, confidence),
    features,
    reasoning: `HEURISTIC(${trainingData.length}/${MIN_TRAIN_SAMPLES}): ${direction} mom=${features.mom3m.toFixed(2)} obi=${features.obi.toFixed(1)}`,
    blocked,
    kellyFraction,
    modelTrained: false,
  };
}
