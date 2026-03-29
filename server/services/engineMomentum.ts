/**
 * ENGINE D: VWAP/Momentum — Replaces ARIMA
 * 
 * Uses 1-minute candles to compute:
 * 1. VWAP deviation — price above/below VWAP = directional signal
 * 2. Rate of Change (ROC) — momentum over last 3-5 minutes
 * 3. Volume-weighted momentum — stronger moves on high volume matter more
 * 4. Micro-trend exhaustion — 5+ candles in one direction = potential reversal
 * 
 * Much more effective than ARIMA for 5-minute binary outcomes because:
 * - VWAP is the institutional benchmark for fair value
 * - Momentum captures inertia that ARIMA can't model
 * - Volume confirmation filters noise
 */

import { log } from "../index";

interface MomentumSignal {
  direction: "Up" | "Down";
  confidence: number;
  vwapDeviation: number;   // % above/below VWAP
  roc3m: number;            // 3-minute rate of change %
  reasoning: string;
  blocked: boolean;
  kellyFraction: number;
}

interface Candle1m {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const candleCache: Record<string, { candles: Candle1m[]; fetchedAt: number }> = {};

async function fetch1mCandles(asset: string): Promise<Candle1m[]> {
  const now = Date.now();
  if (candleCache[asset] && now - candleCache[asset].fetchedAt < 30000) {
    return candleCache[asset].candles;
  }

  const symMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symMap[asset] || asset.toUpperCase();

  try {
    const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=20`);
    const data = await res.json();
    if (data.Data?.Data) {
      const candles: Candle1m[] = data.Data.Data.map((c: any) => ({
        time: c.time * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volumefrom || 0,
      }));
      candleCache[asset] = { candles, fetchedAt: now };
      return candles;
    }
  } catch {}
  return candleCache[asset]?.candles || [];
}

function computeVWAP(candles: Candle1m[]): number {
  let cumPV = 0, cumVol = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumPV / cumVol : candles[candles.length - 1]?.close || 0;
}

export async function runMomentumPredict(asset: string, upPrice: number, liquidity: number): Promise<MomentumSignal> {
  const candles = await fetch1mCandles(asset);

  if (candles.length < 10) {
    return { direction: "Up", confidence: 0.50, vwapDeviation: 0, roc3m: 0, reasoning: "no data", blocked: true, kellyFraction: 0 };
  }

  const lastPrice = candles[candles.length - 1].close;
  const reasons: string[] = [];

  // 1. VWAP deviation (last 15 candles)
  const vwapCandles = candles.slice(-15);
  const vwap = computeVWAP(vwapCandles);
  const vwapDev = vwap > 0 ? (lastPrice - vwap) / vwap * 100 : 0;

  // 2. Rate of Change — 3 minute and 5 minute
  const price3mAgo = candles[candles.length - 4]?.close || lastPrice;
  const price5mAgo = candles[candles.length - 6]?.close || lastPrice;
  const roc3m = (lastPrice - price3mAgo) / price3mAgo * 100;
  const roc5m = (lastPrice - price5mAgo) / price5mAgo * 100;

  // 3. Volume-weighted momentum
  const recent5 = candles.slice(-5);
  let volWeightedMom = 0, totalVol = 0;
  for (const c of recent5) {
    const candleMom = (c.close - c.open) / c.open;
    volWeightedMom += candleMom * c.volume;
    totalVol += c.volume;
  }
  const vwMom = totalVol > 0 ? volWeightedMom / totalVol * 100 : 0;

  // 4. Micro-trend exhaustion: count consecutive same-direction candles
  let consecutiveUp = 0, consecutiveDown = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 8); i--) {
    if (candles[i].close > candles[i].open) {
      if (consecutiveDown > 0) break;
      consecutiveUp++;
    } else {
      if (consecutiveUp > 0) break;
      consecutiveDown++;
    }
  }

  // Combine signals
  let upScore = 0, downScore = 0;

  // VWAP: price above VWAP = bullish
  if (vwapDev > 0.02) { upScore += 2; reasons.push(`VWAP+${vwapDev.toFixed(3)}%`); }
  else if (vwapDev < -0.02) { downScore += 2; reasons.push(`VWAP${vwapDev.toFixed(3)}%`); }

  // ROC: momentum direction
  if (roc3m > 0.02) { upScore += 1.5; reasons.push(`ROC3m+${roc3m.toFixed(3)}%`); }
  else if (roc3m < -0.02) { downScore += 1.5; reasons.push(`ROC3m${roc3m.toFixed(3)}%`); }

  // Volume-weighted momentum
  if (vwMom > 0.01) { upScore += 1; reasons.push(`VWM↑`); }
  else if (vwMom < -0.01) { downScore += 1; reasons.push(`VWM↓`); }

  // Exhaustion: 5+ candles same direction = potential reversal
  if (consecutiveUp >= 5) { downScore += 1.5; reasons.push(`exhaust↑${consecutiveUp}`); }
  if (consecutiveDown >= 5) { upScore += 1.5; reasons.push(`exhaust↓${consecutiveDown}`); }

  // ROC 5m confirmation
  if (Math.sign(roc5m) === Math.sign(roc3m) && Math.abs(roc5m) > 0.03) {
    if (roc5m > 0) upScore += 0.5;
    else downScore += 0.5;
    reasons.push(`5m✓`);
  }

  // Direction & confidence
  const direction: "Up" | "Down" = upScore > downScore ? "Up" : "Down";
  const totalScore = upScore + downScore;
  const winScore = direction === "Up" ? upScore : downScore;
  let confidence = 0.50;

  if (totalScore > 0) {
    const ratio = winScore / totalScore;
    confidence = 0.50 + (ratio - 0.5) * 0.20; // Scale to 0.50-0.60
  }

  // Market agreement bonus
  const polyDir = upPrice > 0.52 ? "Up" : upPrice < 0.48 ? "Down" : "neutral";
  if (polyDir === direction) confidence += 0.01;

  // Blocking: only block when literally no signal
  const blocked = totalScore < 1.0;

  const edge = Math.max(0, confidence - 0.50);
  const kellyFraction = edge * 0.50;

  return {
    direction,
    confidence: Math.min(0.65, confidence),
    vwapDeviation: vwapDev,
    roc3m,
    reasoning: `VWAP/MOM: ${reasons.join(' ')} vwap=${vwapDev.toFixed(3)}% roc=${roc3m.toFixed(3)}%`,
    blocked,
    kellyFraction,
  };
}
