import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Markets available for trading
export const markets = sqliteTable("markets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  platform: text("platform").notNull(), // "polymarket" | "binance" | "bybit"
  name: text("name").notNull(),
  category: text("category").notNull(), // "crypto" | "politics" | "sports" | "other"
  currentPrice: real("current_price").default(0),
  volume24h: real("volume_24h").default(0),
  aiProbability: real("ai_probability"), // ensemble prediction
  marketProbability: real("market_probability"), // actual market price
  edge: real("edge"), // aiProbability - marketProbability
  status: text("status").default("active"), // "active" | "resolved" | "paused"
  updatedAt: text("updated_at"),
});

// Trading positions
export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketId: integer("market_id").notNull(),
  platform: text("platform").notNull(),
  marketName: text("market_name").notNull(),
  side: text("side").notNull(), // "YES" | "NO" | "LONG" | "SHORT"
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price").default(0),
  size: real("size").notNull(),
  pnl: real("pnl").default(0),
  pnlPercent: real("pnl_percent").default(0),
  status: text("status").default("open"), // "open" | "closed" | "pending"
  strategy: text("strategy").notNull(),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
});

// Trade history
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  positionId: integer("position_id"),
  marketName: text("market_name").notNull(),
  platform: text("platform").notNull(),
  side: text("side").notNull(),
  price: real("price").notNull(),
  size: real("size").notNull(),
  pnl: real("pnl").default(0),
  strategy: text("strategy").notNull(),
  executedAt: text("executed_at").notNull(),
});

// AI model predictions log
export const predictions = sqliteTable("predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketId: integer("market_id").notNull(),
  marketName: text("market_name").notNull(),
  gptProbability: real("gpt_probability"),
  claudeProbability: real("claude_probability"),
  geminiProbability: real("gemini_probability"),
  ensembleProbability: real("ensemble_probability"),
  marketPrice: real("market_price"),
  edge: real("edge"),
  confidence: text("confidence"), // "low" | "medium" | "high"
  action: text("action"), // "buy_yes" | "buy_no" | "hold" | "sell"
  reasoning: text("reasoning"),
  createdAt: text("created_at").notNull(),
});

// Bot configuration
export const botConfig = sqliteTable("bot_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

// Performance snapshots for chart data
export const performanceSnapshots = sqliteTable("performance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  totalPnl: real("total_pnl").notNull(),
  portfolioValue: real("portfolio_value").notNull(),
  winRate: real("win_rate").notNull(),
  totalTrades: integer("total_trades").notNull(),
  timestamp: text("timestamp").notNull(),
});

// Schemas
export const insertMarketSchema = createInsertSchema(markets).omit({ id: true });
export const insertPositionSchema = createInsertSchema(positions).omit({ id: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true });
export const insertPredictionSchema = createInsertSchema(predictions).omit({ id: true });
export const insertBotConfigSchema = createInsertSchema(botConfig).omit({ id: true });
export const insertPerformanceSnapshotSchema = createInsertSchema(performanceSnapshots).omit({ id: true });

// Types
export type Market = typeof markets.$inferSelect;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Position = typeof positions.$inferSelect;
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Prediction = typeof predictions.$inferSelect;
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type InsertPerformanceSnapshot = z.infer<typeof insertPerformanceSnapshotSchema>;
