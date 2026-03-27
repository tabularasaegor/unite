/**
 * ENGINE C: Latency Arbitrage
 * 
 * Принцип: Polymarket 5-мин рынки обновляют цены с задержкой ~30-60с
 * относительно спотовых цен на CEX. Если спотовая цена актива
 * значительно двигается в последние 2-3 минуты текущего 5-мин окна,
 * Polymarket ещё не отражает это в ценах → edge.
 * 
 * Сигналы:
 * 1. Fetch 1-минутные свечи с CryptoCompare
 * 2. Измерить движение за последние 2 минуты
 * 3. Если движение > порога → сигнал в направлении движения
 * 4. Чем сильнее движение, тем больше confidence
 */

import { log } from "../index";

interface LatencySignal {
  direction: "Up" | "Down";
  confidence: number;
  priceChange: number; // % change
  reasoning: string;
  blocked: boolean;
  kellyFraction: number;
}

const priceCache: Record<string, { candles: number[][]; fetchedAt: number }> = {};

async function fetch1MinCandles(asset: string): Promise<number[][]> {
  const now = Date.now();
  if (priceCache[asset] && now - priceCache[asset].fetchedAt < 30000) {
    return priceCache[asset].candles;
  }
  
  const symMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symMap[asset] || asset.toUpperCase();
  
  try {
    const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=10`);
    const data = await res.json();
    if (data.Data?.Data) {
      const candles = data.Data.Data.map((c: any) => [c.time, c.open, c.high, c.low, c.close, c.volumefrom || 0]);
      priceCache[asset] = { candles, fetchedAt: now };
      return candles;
    }
  } catch {}
  return priceCache[asset]?.candles || [];
}

export async function runLatencyArbitrage(asset: string, upPrice: number, liquidity: number): Promise<LatencySignal> {
  const candles = await fetch1MinCandles(asset);
  
  if (candles.length < 5) {
    return { direction: "Up", confidence: 0.50, priceChange: 0, reasoning: "нет данных", blocked: true, kellyFraction: 0 };
  }
  
  // Last 3 candles (3 minutes of spot data)
  const recent3 = candles.slice(-3);
  const openPrice = recent3[0][1]; // open of 3 min ago
  const closePrice = recent3[2][4]; // close of last candle
  const priceChange = (closePrice - openPrice) / openPrice;
  
  // Last 1 candle momentum
  const last1 = candles[candles.length - 1];
  const lastChange = (last1[4] - last1[1]) / last1[1];
  
  // Volume spike detection
  const avgVol = candles.slice(-5).reduce((s, c) => s + c[5], 0) / 5;
  const lastVol = last1[5];
  const volSpike = avgVol > 0 ? lastVol / avgVol : 1;
  
  const reasons: string[] = [];
  
  // Direction from spot price movement
  const direction: "Up" | "Down" = priceChange > 0 ? "Up" : "Down";
  let confidence = 0.50;
  
  // Stronger movement → higher confidence
  const absPctChange = Math.abs(priceChange) * 100;
  
  if (absPctChange > 0.10) {
    confidence = 0.54;
    reasons.push(`spot Δ=${(priceChange*100).toFixed(3)}%`);
  }
  if (absPctChange > 0.05) {
    confidence = Math.max(confidence, 0.52);
    reasons.push(`trend=${direction}`);
  }
  
  // Volume spike amplifies signal
  if (volSpike > 1.5) {
    confidence += 0.02;
    reasons.push(`vol×${volSpike.toFixed(1)}`);
  }
  
  // Disagreement with Polymarket odds = latency opportunity
  const polyDirection = upPrice > 0.51 ? "Up" : upPrice < 0.49 ? "Down" : "neutral";
  if (polyDirection !== "neutral" && polyDirection !== direction) {
    confidence += 0.03; // Polymarket hasn't caught up
    reasons.push(`latency:spot≠poly`);
  }
  
  // Block if no real movement
  const blocked = absPctChange < 0.02;
  
  // Kelly
  const edge = Math.max(0, confidence - 0.50);
  const kellyFraction = edge > 0 ? edge * 0.50 : 0; // Simple edge-based

  return {
    direction,
    confidence: Math.min(0.65, confidence),
    priceChange: priceChange * 100,
    reasoning: `LATENCY: ${reasons.join(' ')} Δ=${(priceChange*100).toFixed(3)}%`,
    blocked,
    kellyFraction,
  };
}
