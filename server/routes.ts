import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Dashboard stats
  app.get("/api/stats", async (_req, res) => {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  });

  // Markets
  app.get("/api/markets", async (_req, res) => {
    const markets = await storage.getMarkets();
    res.json(markets);
  });

  app.post("/api/markets", async (req, res) => {
    const market = await storage.createMarket(req.body);
    res.json(market);
  });

  app.patch("/api/markets/:id", async (req, res) => {
    const market = await storage.updateMarket(parseInt(req.params.id), req.body);
    if (!market) return res.status(404).json({ error: "Market not found" });
    res.json(market);
  });

  // Positions
  app.get("/api/positions", async (req, res) => {
    const status = req.query.status as string | undefined;
    const positions = await storage.getPositions(status);
    res.json(positions);
  });

  app.post("/api/positions", async (req, res) => {
    const position = await storage.createPosition(req.body);
    res.json(position);
  });

  app.patch("/api/positions/:id", async (req, res) => {
    const position = await storage.updatePosition(parseInt(req.params.id), req.body);
    if (!position) return res.status(404).json({ error: "Position not found" });
    res.json(position);
  });

  // Trades
  app.get("/api/trades", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const trades = await storage.getTrades(limit);
    res.json(trades);
  });

  app.post("/api/trades", async (req, res) => {
    const trade = await storage.createTrade(req.body);
    res.json(trade);
  });

  // Predictions
  app.get("/api/predictions", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const predictions = await storage.getPredictions(limit);
    res.json(predictions);
  });

  app.post("/api/predictions", async (req, res) => {
    const prediction = await storage.createPrediction(req.body);
    res.json(prediction);
  });

  // Config
  app.get("/api/config", async (_req, res) => {
    const config = await storage.getAllConfig();
    const obj: Record<string, string> = {};
    config.forEach(c => { obj[c.key] = c.value; });
    res.json(obj);
  });

  app.post("/api/config", async (req, res) => {
    const { key, value } = req.body;
    await storage.setConfig(key, value);
    res.json({ ok: true });
  });

  // Performance snapshots
  app.get("/api/performance", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
    const snapshots = await storage.getPerformanceSnapshots(limit);
    res.json(snapshots);
  });

  // Seed demo data
  app.post("/api/seed", async (_req, res) => {
    await seedDemoData();
    res.json({ ok: true });
  });

  return httpServer;
}

async function seedDemoData() {
  // Seed markets
  const marketData = [
    { externalId: "pm-btc-100k", platform: "polymarket", name: "BTC above $100k by June 2026", category: "crypto", currentPrice: 0.72, volume24h: 2450000, aiProbability: 0.78, marketProbability: 0.72, edge: 0.06, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "pm-eth-merge", platform: "polymarket", name: "ETH Pectra upgrade live by Q2 2026", category: "crypto", currentPrice: 0.85, volume24h: 1230000, aiProbability: 0.91, marketProbability: 0.85, edge: 0.06, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "pm-fed-rate", platform: "polymarket", name: "Fed cuts rates in April 2026", category: "politics", currentPrice: 0.34, volume24h: 5670000, aiProbability: 0.28, marketProbability: 0.34, edge: -0.06, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "pm-sol-200", platform: "polymarket", name: "SOL above $200 by April 2026", category: "crypto", currentPrice: 0.55, volume24h: 890000, aiProbability: 0.62, marketProbability: 0.55, edge: 0.07, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "bn-btcusdt", platform: "binance", name: "BTC/USDT Spot", category: "crypto", currentPrice: 87420, volume24h: 32000000000, aiProbability: null, marketProbability: null, edge: null, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "bn-ethusdt", platform: "binance", name: "ETH/USDT Spot", category: "crypto", currentPrice: 2045, volume24h: 14500000000, aiProbability: null, marketProbability: null, edge: null, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "pm-trump-trial", platform: "polymarket", name: "Trump trial verdict before July 2026", category: "politics", currentPrice: 0.42, volume24h: 8900000, aiProbability: 0.38, marketProbability: 0.42, edge: -0.04, status: "active", updatedAt: new Date().toISOString() },
    { externalId: "bb-solusdt", platform: "bybit", name: "SOL/USDT Perpetual", category: "crypto", currentPrice: 142.5, volume24h: 2800000000, aiProbability: null, marketProbability: null, edge: null, status: "active", updatedAt: new Date().toISOString() },
  ];

  for (const m of marketData) {
    await storage.createMarket(m);
  }

  // Seed positions
  const now = new Date();
  const posData = [
    { marketId: 1, platform: "polymarket", marketName: "BTC above $100k by June 2026", side: "YES", entryPrice: 0.68, currentPrice: 0.72, size: 150, pnl: 6.0, pnlPercent: 5.88, status: "open", strategy: "ai_ensemble", openedAt: new Date(now.getTime() - 86400000 * 2).toISOString() },
    { marketId: 4, platform: "polymarket", marketName: "SOL above $200 by April 2026", side: "YES", entryPrice: 0.48, currentPrice: 0.55, size: 80, pnl: 5.6, pnlPercent: 14.58, status: "open", strategy: "ai_ensemble", openedAt: new Date(now.getTime() - 86400000).toISOString() },
    { marketId: 3, platform: "polymarket", marketName: "Fed cuts rates in April 2026", side: "NO", entryPrice: 0.62, currentPrice: 0.66, size: 100, pnl: 4.0, pnlPercent: 6.45, status: "open", strategy: "ai_ensemble", openedAt: new Date(now.getTime() - 43200000).toISOString() },
    { marketId: 2, platform: "polymarket", marketName: "ETH Pectra upgrade live by Q2 2026", side: "YES", entryPrice: 0.80, currentPrice: 0.85, size: 120, pnl: 6.0, pnlPercent: 6.25, status: "closed", strategy: "ai_ensemble", openedAt: new Date(now.getTime() - 86400000 * 5).toISOString(), closedAt: new Date(now.getTime() - 86400000).toISOString() },
  ];

  for (const p of posData) {
    await storage.createPosition(p);
  }

  // Seed trades
  const tradeData = [
    { positionId: 1, marketName: "BTC above $100k by June 2026", platform: "polymarket", side: "BUY_YES", price: 0.68, size: 150, pnl: 0, strategy: "ai_ensemble", executedAt: new Date(now.getTime() - 86400000 * 2).toISOString() },
    { positionId: 2, marketName: "SOL above $200 by April 2026", platform: "polymarket", side: "BUY_YES", price: 0.48, size: 80, pnl: 0, strategy: "ai_ensemble", executedAt: new Date(now.getTime() - 86400000).toISOString() },
    { positionId: 3, marketName: "Fed cuts rates in April 2026", platform: "polymarket", side: "BUY_NO", price: 0.62, size: 100, pnl: 0, strategy: "ai_ensemble", executedAt: new Date(now.getTime() - 43200000).toISOString() },
    { positionId: 4, marketName: "ETH Pectra upgrade live by Q2 2026", platform: "polymarket", side: "BUY_YES", price: 0.80, size: 120, pnl: 0, strategy: "ai_ensemble", executedAt: new Date(now.getTime() - 86400000 * 5).toISOString() },
    { positionId: 4, marketName: "ETH Pectra upgrade live by Q2 2026", platform: "polymarket", side: "SELL_YES", price: 0.85, size: 120, pnl: 6.0, strategy: "ai_ensemble", executedAt: new Date(now.getTime() - 86400000).toISOString() },
  ];

  for (const t of tradeData) {
    await storage.createTrade(t);
  }

  // Seed predictions
  const predData = [
    { marketId: 1, marketName: "BTC above $100k by June 2026", gptProbability: 0.76, claudeProbability: 0.81, geminiProbability: 0.74, ensembleProbability: 0.78, marketPrice: 0.72, edge: 0.06, confidence: "high", action: "buy_yes", reasoning: "Strong on-chain metrics, ETF inflows increasing, halving effect still playing out. All three models agree on bullish outlook above market price.", createdAt: new Date(now.getTime() - 3600000).toISOString() },
    { marketId: 4, marketName: "SOL above $200 by April 2026", gptProbability: 0.58, claudeProbability: 0.65, geminiProbability: 0.60, ensembleProbability: 0.62, marketPrice: 0.55, edge: 0.07, confidence: "medium", action: "buy_yes", reasoning: "Solana ecosystem growth strong but timeline is tight. Claude most bullish due to DeFi TVL analysis. GPT more cautious on macro headwinds.", createdAt: new Date(now.getTime() - 7200000).toISOString() },
    { marketId: 3, marketName: "Fed cuts rates in April 2026", gptProbability: 0.25, claudeProbability: 0.30, geminiProbability: 0.28, ensembleProbability: 0.28, marketPrice: 0.34, edge: -0.06, confidence: "medium", action: "buy_no", reasoning: "Inflation data still sticky. Market overpricing cut probability. Ensemble suggests selling YES / buying NO for edge.", createdAt: new Date(now.getTime() - 10800000).toISOString() },
  ];

  for (const p of predData) {
    await storage.createPrediction(p);
  }

  // Seed performance snapshots
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - 86400000 * i);
    const basePnl = (30 - i) * 2.5 + Math.sin(i * 0.5) * 15;
    await storage.createPerformanceSnapshot({
      totalPnl: Math.round(basePnl * 100) / 100,
      portfolioValue: Math.round((1000 + basePnl) * 100) / 100,
      winRate: 60 + Math.random() * 15,
      totalTrades: Math.floor(i * 1.5) + 5,
      timestamp: d.toISOString(),
    });
  }

  // Seed config
  const configData = [
    { key: "bot_status", value: "running" },
    { key: "max_position_size", value: "200" },
    { key: "daily_loss_limit", value: "50" },
    { key: "max_exposure", value: "500" },
    { key: "min_edge_threshold", value: "0.05" },
    { key: "strategy", value: "ai_ensemble" },
    { key: "gpt_weight", value: "0.40" },
    { key: "claude_weight", value: "0.35" },
    { key: "gemini_weight", value: "0.25" },
    { key: "platforms", value: "polymarket,binance,bybit" },
    { key: "paper_trading", value: "true" },
  ];

  for (const c of configData) {
    await storage.setConfig(c.key, c.value);
  }
}
