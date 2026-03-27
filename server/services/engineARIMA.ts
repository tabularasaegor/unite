/**
 * ENGINE D: ARIMA Price Prediction
 * 
 * Использует ARIMA(3,1,1) — лучшая конфигурация по бэктесту (57% WR на 100 периодах).
 * 
 * Принцип:
 * 1. Fetch 60 последних 5-мин свечей
 * 2. Обучить ARIMA(3,1,1) на ценах закрытия
 * 3. Предсказать следующую цену
 * 4. Если predicted > current → Up, иначе → Down
 * 5. Величина предсказанного движения определяет confidence
 */

import { log } from "../index";

interface ARIMASignal {
  direction: "Up" | "Down";
  confidence: number;
  predictedChange: number; // predicted % change
  reasoning: string;
  blocked: boolean;
  kellyFraction: number;
}

const candleCache: Record<string, { closes: number[]; fetchedAt: number }> = {};

async function fetch5MinCloses(asset: string): Promise<number[]> {
  const now = Date.now();
  if (candleCache[asset] && now - candleCache[asset].fetchedAt < 60000) {
    return candleCache[asset].closes;
  }
  
  const symMap: Record<string, string> = { btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP" };
  const sym = symMap[asset] || asset.toUpperCase();
  
  try {
    const res = await fetch(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USD&limit=80&aggregate=5`);
    const data = await res.json();
    if (data.Data?.Data) {
      const closes = data.Data.Data.map((c: any) => c.close as number);
      candleCache[asset] = { closes, fetchedAt: now };
      return closes;
    }
  } catch {}
  return candleCache[asset]?.closes || [];
}

export async function runARIMAPredict(asset: string, upPrice: number, liquidity: number): Promise<ARIMASignal> {
  const closes = await fetch5MinCloses(asset);
  
  if (closes.length < 40) {
    return { direction: "Up", confidence: 0.50, predictedChange: 0, reasoning: "нет данных для ARIMA", blocked: true, kellyFraction: 0 };
  }
  
  try {
    const ARIMA = require("arima");
    
    // Use last 60 closes for training
    const trainData = closes.slice(-60);
    const lastPrice = trainData[trainData.length - 1];
    
    // ARIMA(3,1,1) — best config from backtest (57% WR)
    const arima = new ARIMA({ p: 3, d: 1, q: 1, verbose: false });
    arima.train(trainData);
    const [predicted] = arima.predict(1);
    
    if (!predicted || predicted.length === 0 || isNaN(predicted[0])) {
      return { direction: "Up", confidence: 0.50, predictedChange: 0, reasoning: "ARIMA NaN", blocked: true, kellyFraction: 0 };
    }
    
    const predictedPrice = predicted[0];
    const pctChange = (predictedPrice - lastPrice) / lastPrice * 100;
    
    const direction: "Up" | "Down" = predictedPrice > lastPrice ? "Up" : "Down";
    
    // Confidence based on magnitude of predicted move
    const absPct = Math.abs(pctChange);
    let confidence = 0.52; // base ARIMA confidence (57% WR from backtest)
    if (absPct > 0.1) confidence = 0.54;
    if (absPct > 0.2) confidence = 0.56;
    
    // Ensemble with market price signal
    const marketDir = upPrice > 0.51 ? "Up" : upPrice < 0.49 ? "Down" : "neutral";
    if (marketDir === direction) {
      confidence += 0.02; // agreement bonus
    }
    
    const edge = Math.max(0, confidence - 0.50);
    const kellyFraction = edge * 0.50;
    
    const reasoning = `ARIMA(3,1,1): ${lastPrice.toFixed(2)}→${predictedPrice.toFixed(2)} (Δ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(3)}%) ${marketDir === direction ? '✓market' : ''}`;
    
    return {
      direction,
      confidence: Math.min(0.62, confidence),
      predictedChange: pctChange,
      reasoning,
      blocked: false,
      kellyFraction,
    };
  } catch (err: any) {
    log(`ARIMA error for ${asset}: ${err?.message?.substring(0, 80)}`, "micro");
    return { direction: "Up", confidence: 0.50, predictedChange: 0, reasoning: "ARIMA error", blocked: true, kellyFraction: 0 };
  }
}
