/**
 * Multi-Timeframe Trend Analysis
 * 
 * Анализирует 10 и 15 минутные свечи с CryptoCompare для определения
 * общего направления рынка. Этот тренд используется как фильтр
 * для 5-минутных сделок — не как самостоятельный сигнал.
 * 
 * Принцип: если 10-15 мин тренд идёт Down, а 5-мин модель хочет Up,
 * это рискованная сделка — уменьшаем размер. Если тренды совпадают — усиливаем.
 */

import { log } from "../index";

export interface TrendSignal {
  direction: "Up" | "Down" | "neutral";
  confidence: number;  // 0.0 - 1.0
  reasoning: string;
  priceChange10m: number;  // % change over 10 min
  priceChange15m: number;  // % change over 15 min
  momentum: number;        // combined momentum score
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Cache per asset, 30 second TTL
const trendCache: Record<string, { signal: TrendSignal; fetchedAt: number }> = {};
const CACHE_TTL = 30000;

async function fetchMinuteCandles(asset: string, limit: number = 20): Promise<CandleData[]> {
  const symMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symMap[asset] || asset.toUpperCase();
  
  try {
    const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.Data?.Data) {
      return data.Data.Data.map((c: any) => ({
        time: c.time * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volumefrom || 0,
      }));
    }
  } catch (err) {
    log(`Trend: Failed to fetch candles for ${asset}: ${err}`, "micro");
  }
  return [];
}

/**
 * Analyze 10-minute and 15-minute price trends for an asset.
 * Returns a directional signal with confidence.
 */
export async function analyzeTrend(asset: string): Promise<TrendSignal> {
  const now = Date.now();
  if (trendCache[asset] && now - trendCache[asset].fetchedAt < CACHE_TTL) {
    return trendCache[asset].signal;
  }

  const candles = await fetchMinuteCandles(asset, 20); // 20 x 1min candles
  
  if (candles.length < 15) {
    const neutral: TrendSignal = { direction: "neutral", confidence: 0, reasoning: "insufficient data", priceChange10m: 0, priceChange15m: 0, momentum: 0 };
    trendCache[asset] = { signal: neutral, fetchedAt: now };
    return neutral;
  }

  const lastPrice = candles[candles.length - 1].close;
  
  // 10-minute change: compare current price to price 10 candles ago
  const price10mAgo = candles[candles.length - 11]?.close || lastPrice;
  const change10m = (lastPrice - price10mAgo) / price10mAgo;
  
  // 15-minute change
  const price15mAgo = candles[candles.length - 16]?.close || candles[0].close;
  const change15m = (lastPrice - price15mAgo) / price15mAgo;
  
  // 5-minute short-term momentum (last 5 candles)
  const price5mAgo = candles[candles.length - 6]?.close || lastPrice;
  const change5m = (lastPrice - price5mAgo) / price5mAgo;
  
  // Volume trend: is volume increasing? (sign of momentum)
  const recentVol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const olderVol = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5;
  const volRatio = olderVol > 0 ? recentVol / olderVol : 1;
  
  // Higher-highs / lower-lows pattern (last 10 candles)
  const recent10 = candles.slice(-10);
  let higherHighs = 0, lowerLows = 0;
  for (let i = 1; i < recent10.length; i++) {
    if (recent10[i].high > recent10[i-1].high) higherHighs++;
    if (recent10[i].low < recent10[i-1].low) lowerLows++;
  }
  
  // Combine signals
  const reasons: string[] = [];
  let upScore = 0, downScore = 0;
  
  // 15m trend (strongest signal)
  if (change15m > 0.001) { upScore += 2; reasons.push(`15m↑${(change15m*100).toFixed(2)}%`); }
  else if (change15m < -0.001) { downScore += 2; reasons.push(`15m↓${(change15m*100).toFixed(2)}%`); }
  
  // 10m trend
  if (change10m > 0.001) { upScore += 1.5; reasons.push(`10m↑${(change10m*100).toFixed(2)}%`); }
  else if (change10m < -0.001) { downScore += 1.5; reasons.push(`10m↓${(change10m*100).toFixed(2)}%`); }
  
  // 5m momentum (lighter weight)
  if (change5m > 0.0005) { upScore += 1; reasons.push(`5m↑`); }
  else if (change5m < -0.0005) { downScore += 1; reasons.push(`5m↓`); }
  
  // Volume confirmation
  if (volRatio > 1.3) { 
    // Volume increasing = confirms current direction
    if (change10m > 0) upScore += 0.5;
    else downScore += 0.5;
    reasons.push(`vol×${volRatio.toFixed(1)}`);
  }
  
  // Higher-highs / lower-lows pattern
  if (higherHighs >= 6) { upScore += 1; reasons.push(`HH:${higherHighs}`); }
  if (lowerLows >= 6) { downScore += 1; reasons.push(`LL:${lowerLows}`); }
  
  const totalScore = upScore + downScore;
  let direction: "Up" | "Down" | "neutral" = "neutral";
  let confidence = 0;
  
  if (totalScore > 0) {
    if (upScore > downScore * 1.3) {
      direction = "Up";
      confidence = Math.min(0.9, upScore / (upScore + downScore));
    } else if (downScore > upScore * 1.3) {
      direction = "Down";
      confidence = Math.min(0.9, downScore / (upScore + downScore));
    }
  }
  
  // Combined momentum score: -1 to +1
  const momentum = (change10m + change15m) / 2 * 100; // in percentage points
  
  const signal: TrendSignal = {
    direction,
    confidence,
    reasoning: `TREND: ${reasons.join(' ')} mom=${momentum.toFixed(3)}%`,
    priceChange10m: change10m * 100,
    priceChange15m: change15m * 100,
    momentum,
  };
  
  trendCache[asset] = { signal, fetchedAt: now };
  return signal;
}
