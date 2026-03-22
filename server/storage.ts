import {
  type Market, type InsertMarket, markets,
  type Position, type InsertPosition, positions,
  type Trade, type InsertTrade, trades,
  type Prediction, type InsertPrediction, predictions,
  type BotConfig, type InsertBotConfig, botConfig,
  type PerformanceSnapshot, type InsertPerformanceSnapshot, performanceSnapshots,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, sql } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Markets
  getMarkets(): Promise<Market[]>;
  getMarket(id: number): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  updateMarket(id: number, data: Partial<InsertMarket>): Promise<Market | undefined>;
  // Positions
  getPositions(status?: string): Promise<Position[]>;
  getPosition(id: number): Promise<Position | undefined>;
  createPosition(position: InsertPosition): Promise<Position>;
  updatePosition(id: number, data: Partial<InsertPosition>): Promise<Position | undefined>;
  // Trades
  getTrades(limit?: number): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  // Predictions
  getPredictions(limit?: number): Promise<Prediction[]>;
  createPrediction(prediction: InsertPrediction): Promise<Prediction>;
  // Config
  getConfig(key: string): Promise<string | undefined>;
  setConfig(key: string, value: string): Promise<void>;
  getAllConfig(): Promise<BotConfig[]>;
  // Performance
  getPerformanceSnapshots(limit?: number): Promise<PerformanceSnapshot[]>;
  createPerformanceSnapshot(snapshot: InsertPerformanceSnapshot): Promise<PerformanceSnapshot>;
  // Stats
  getDashboardStats(): Promise<{
    totalPnl: number;
    portfolioValue: number;
    winRate: number;
    totalTrades: number;
    openPositions: number;
    avgEdge: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // Markets
  async getMarkets(): Promise<Market[]> {
    return db.select().from(markets).all();
  }

  async getMarket(id: number): Promise<Market | undefined> {
    return db.select().from(markets).where(eq(markets.id, id)).get();
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    return db.insert(markets).values(market).returning().get();
  }

  async updateMarket(id: number, data: Partial<InsertMarket>): Promise<Market | undefined> {
    return db.update(markets).set(data).where(eq(markets.id, id)).returning().get();
  }

  // Positions
  async getPositions(status?: string): Promise<Position[]> {
    if (status) {
      return db.select().from(positions).where(eq(positions.status, status)).all();
    }
    return db.select().from(positions).orderBy(desc(positions.id)).all();
  }

  async getPosition(id: number): Promise<Position | undefined> {
    return db.select().from(positions).where(eq(positions.id, id)).get();
  }

  async createPosition(position: InsertPosition): Promise<Position> {
    return db.insert(positions).values(position).returning().get();
  }

  async updatePosition(id: number, data: Partial<InsertPosition>): Promise<Position | undefined> {
    return db.update(positions).set(data).where(eq(positions.id, id)).returning().get();
  }

  // Trades
  async getTrades(limit: number = 50): Promise<Trade[]> {
    return db.select().from(trades).orderBy(desc(trades.id)).limit(limit).all();
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    return db.insert(trades).values(trade).returning().get();
  }

  // Predictions
  async getPredictions(limit: number = 20): Promise<Prediction[]> {
    return db.select().from(predictions).orderBy(desc(predictions.id)).limit(limit).all();
  }

  async createPrediction(prediction: InsertPrediction): Promise<Prediction> {
    return db.insert(predictions).values(prediction).returning().get();
  }

  // Config
  async getConfig(key: string): Promise<string | undefined> {
    const row = db.select().from(botConfig).where(eq(botConfig.key, key)).get();
    return row?.value;
  }

  async setConfig(key: string, value: string): Promise<void> {
    const existing = db.select().from(botConfig).where(eq(botConfig.key, key)).get();
    if (existing) {
      db.update(botConfig).set({ value }).where(eq(botConfig.key, key)).run();
    } else {
      db.insert(botConfig).values({ key, value }).run();
    }
  }

  async getAllConfig(): Promise<BotConfig[]> {
    return db.select().from(botConfig).all();
  }

  // Performance
  async getPerformanceSnapshots(limit: number = 30): Promise<PerformanceSnapshot[]> {
    return db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.id)).limit(limit).all();
  }

  async createPerformanceSnapshot(snapshot: InsertPerformanceSnapshot): Promise<PerformanceSnapshot> {
    return db.insert(performanceSnapshots).values(snapshot).returning().get();
  }

  // Stats
  async getDashboardStats() {
    const allTrades = db.select().from(trades).all();
    const openPos = db.select().from(positions).where(eq(positions.status, "open")).all();
    const allMarkets = db.select().from(markets).where(eq(markets.status, "active")).all();

    const totalPnl = allTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const winningTrades = allTrades.filter(t => (t.pnl || 0) > 0).length;
    const winRate = allTrades.length > 0 ? (winningTrades / allTrades.length) * 100 : 0;
    const openValue = openPos.reduce((s, p) => s + (p.size * (p.currentPrice || 0)), 0);
    const avgEdge = allMarkets.length > 0
      ? allMarkets.reduce((s, m) => s + Math.abs(m.edge || 0), 0) / allMarkets.length
      : 0;

    return {
      totalPnl: Math.round(totalPnl * 100) / 100,
      portfolioValue: Math.round((1000 + totalPnl + openValue) * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      totalTrades: allTrades.length,
      openPositions: openPos.length,
      avgEdge: Math.round(avgEdge * 1000) / 1000,
    };
  }
}

export const storage = new DatabaseStorage();
