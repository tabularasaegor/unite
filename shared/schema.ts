import { mysqlTable, varchar, int, double, boolean, text, serial, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Platform Config (key-value) ─────────────────────────────────
export const platformConfig = mysqlTable("platform_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Opportunities (discovered markets) ──────────────────────────
export const opportunities = mysqlTable("opportunities", {
  id: serial("id").primaryKey(),
  externalId: varchar("external_id", { length: 255 }).notNull(),
  platform: varchar("platform", { length: 64 }).notNull().default("polymarket"),
  title: text("title").notNull(),
  category: varchar("category", { length: 64 }).notNull().default("crypto"),
  currentPrice: double("current_price"),
  volume24h: double("volume_24h"),
  status: varchar("status", { length: 64 }).notNull().default("active"),
  pipelineStage: varchar("pipeline_stage", { length: 64 }).notNull().default("scanned"),
  aiProbability: double("ai_probability"),
  edge: double("edge"),
  conditionId: varchar("condition_id", { length: 255 }),
  clobTokenIds: text("clob_token_ids"),
  tickSize: double("tick_size"),
  negRisk: boolean("neg_risk").default(false),
  endDate: varchar("end_date", { length: 64 }),
  slug: varchar("slug", { length: 512 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Research Reports ────────────────────────────────────────────
export const researchReports = mysqlTable("research_reports", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id").notNull(),
  agentType: varchar("agent_type", { length: 128 }).notNull(),
  content: text("content").notNull(),
  confidence: double("confidence"),
  sources: text("sources"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Probability Estimates ───────────────────────────────────────
export const probabilityEstimates = mysqlTable("probability_estimates", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id").notNull(),
  modelName: varchar("model_name", { length: 128 }).notNull(),
  estimatedProbability: double("estimated_probability").notNull(),
  confidence: double("confidence"),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Risk Assessments ────────────────────────────────────────────
export const riskAssessments = mysqlTable("risk_assessments", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id").notNull(),
  kellyFraction: double("kelly_fraction"),
  positionSize: double("position_size"),
  riskScore: double("risk_score"),
  approved: boolean("approved").default(false),
  blockReason: text("block_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Active Positions ────────────────────────────────────────────
export const activePositions = mysqlTable("active_positions", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id"),
  side: varchar("side", { length: 16 }).notNull(),
  entryPrice: double("entry_price").notNull(),
  currentPrice: double("current_price"),
  size: double("size").notNull(),
  unrealizedPnl: double("unrealized_pnl").default(0),
  realizedPnl: double("realized_pnl").default(0),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  source: varchar("source", { length: 32 }).notNull().default("pipeline"),
  asset: varchar("asset", { length: 16 }),
  windowStart: int("window_start"),
  windowEnd: int("window_end"),
  slug: varchar("slug", { length: 512 }),
  strategyUsed: varchar("strategy_used", { length: 64 }),
  confidence: double("confidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

// ─── Executions (orders) ─────────────────────────────────────────
export const executions = mysqlTable("executions", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id"),
  positionId: int("position_id"),
  type: varchar("type", { length: 32 }).notNull().default("paper"),
  side: varchar("side", { length: 16 }).notNull(),
  price: double("price").notNull(),
  size: double("size").notNull(),
  orderId: varchar("order_id", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("filled"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Settlements ─────────────────────────────────────────────────
export const settlements = mysqlTable("settlements", {
  id: serial("id").primaryKey(),
  positionId: int("position_id").notNull(),
  opportunityId: int("opportunity_id"),
  outcome: varchar("outcome", { length: 32 }).notNull(),
  realizedPnl: double("realized_pnl").notNull(),
  wasCorrect: boolean("was_correct"),
  settledAt: timestamp("settled_at").notNull().defaultNow(),
});

// ─── Post-Mortems ────────────────────────────────────────────────
export const postMortems = mysqlTable("post_mortems", {
  id: serial("id").primaryKey(),
  opportunityId: int("opportunity_id"),
  settlementId: int("settlement_id"),
  analysis: text("analysis"),
  whatHappened: text("what_happened"),
  whatModelPredicted: text("what_model_predicted"),
  whyWrongOrRight: text("why_wrong_or_right"),
  lessonsLearned: text("lessons_learned"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Memory Store (cross-session state) ──────────────────────────
export const memoryStore = mysqlTable("memory_store", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 128 }).notNull(),
  key: varchar("key_name", { length: 512 }).notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Audit Log ───────────────────────────────────────────────────
export const auditLog = mysqlTable("audit_log", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 128 }).notNull(),
  details: text("details"),
  userId: int("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Performance Snapshots ───────────────────────────────────────
export const performanceSnapshots = mysqlTable("performance_snapshots", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 32 }).notNull(),
  bankroll: double("bankroll"),
  totalPnl: double("total_pnl"),
  winRate: double("win_rate"),
  tradeCount: int("trade_count"),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
});

// ─── Model Log (strategy decisions and events) ───────────────────
export const modelLog = mysqlTable("model_log", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 128 }).notNull(),
  asset: varchar("asset", { length: 16 }),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Strategy Performance (per-strategy per-asset tracking) ──────
export const strategyPerformance = mysqlTable("strategy_performance", {
  id: serial("id").primaryKey(),
  strategyName: varchar("strategy_name", { length: 64 }).notNull(),
  asset: varchar("asset", { length: 16 }).notNull(),
  totalTrades: int("total_trades").notNull().default(0),
  wins: int("wins").notNull().default(0),
  losses: int("losses").notNull().default(0),
  alphaWins: double("alpha_wins").notNull().default(1),
  betaLosses: double("beta_losses").notNull().default(1),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

// ─── Backtest Results ─────────────────────────────────────────────
export const backtestResults = mysqlTable("backtest_results", {
  id: serial("id").primaryKey(),
  strategyName: varchar("strategy_name", { length: 64 }).notNull(),
  totalTrades: int("total_trades").notNull(),
  wins: int("wins").notNull(),
  losses: int("losses").notNull(),
  winRate: double("win_rate").notNull(),
  totalPnl: double("total_pnl").notNull(),
  avgPnl: double("avg_pnl").notNull(),
  maxDrawdown: double("max_drawdown").notNull(),
  sharpeRatio: double("sharpe_ratio").notNull(),
  avgConfidence: double("avg_confidence").notNull(),
  rollingWr50: text("rolling_wr_50"),
  runAt: varchar("run_at", { length: 64 }).notNull(),
  batchId: varchar("batch_id", { length: 64 }).notNull(),
});

// ─── Zod Schemas ─────────────────────────────────────────────────
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertConfigSchema = createInsertSchema(platformConfig).omit({ id: true, updatedAt: true });
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPositionSchema = createInsertSchema(activePositions).omit({ id: true, createdAt: true, closedAt: true });
export const insertExecutionSchema = createInsertSchema(executions).omit({ id: true, createdAt: true });
export const insertSettlementSchema = createInsertSchema(settlements).omit({ id: true, settledAt: true });
export const insertAuditSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export const insertModelLogSchema = createInsertSchema(modelLog).omit({ id: true, createdAt: true });
export const insertStrategyPerfSchema = createInsertSchema(strategyPerformance).omit({ id: true, lastUpdated: true });
export const insertBacktestResultSchema = createInsertSchema(backtestResults).omit({ id: true });

// ─── Types ───────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type PlatformConfig = typeof platformConfig.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type ActivePosition = typeof activePositions.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ModelLogEntry = typeof modelLog.$inferSelect;
export type StrategyPerf = typeof strategyPerformance.$inferSelect;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type MemoryStoreEntry = typeof memoryStore.$inferSelect;
export type BacktestResult = typeof backtestResults.$inferSelect;
export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;
