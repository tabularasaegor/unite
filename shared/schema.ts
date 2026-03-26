import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Platform Config (key-value) ─────────────────────────────────
export const platformConfig = sqliteTable("platform_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// ─── Opportunities (discovered markets) ──────────────────────────
export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  platform: text("platform").notNull().default("polymarket"),
  title: text("title").notNull(),
  category: text("category").notNull().default("crypto"),
  currentPrice: real("current_price"),
  volume24h: real("volume_24h"),
  status: text("status").notNull().default("active"),
  pipelineStage: text("pipeline_stage").notNull().default("scanned"),
  aiProbability: real("ai_probability"),
  edge: real("edge"),
  conditionId: text("condition_id"),
  clobTokenIds: text("clob_token_ids"),
  tickSize: real("tick_size"),
  negRisk: integer("neg_risk", { mode: "boolean" }).default(false),
  endDate: text("end_date"),
  slug: text("slug"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// ─── Research Reports ────────────────────────────────────────────
export const researchReports = sqliteTable("research_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  agentType: text("agent_type").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence"),
  sources: text("sources"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Probability Estimates ───────────────────────────────────────
export const probabilityEstimates = sqliteTable("probability_estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  modelName: text("model_name").notNull(),
  estimatedProbability: real("estimated_probability").notNull(),
  confidence: real("confidence"),
  reasoning: text("reasoning"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Risk Assessments ────────────────────────────────────────────
export const riskAssessments = sqliteTable("risk_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  kellyFraction: real("kelly_fraction"),
  positionSize: real("position_size"),
  riskScore: real("risk_score"),
  approved: integer("approved", { mode: "boolean" }).default(false),
  blockReason: text("block_reason"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Active Positions ────────────────────────────────────────────
export const activePositions = sqliteTable("active_positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id"),
  side: text("side").notNull(),
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price"),
  size: real("size").notNull(),
  unrealizedPnl: real("unrealized_pnl").default(0),
  realizedPnl: real("realized_pnl").default(0),
  status: text("status").notNull().default("open"),
  source: text("source").notNull().default("pipeline"),
  asset: text("asset"),
  windowStart: integer("window_start"),
  windowEnd: integer("window_end"),
  slug: text("slug"),
  strategyUsed: text("strategy_used"),
  confidence: real("confidence"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  closedAt: text("closed_at"),
});

// ─── Executions (orders) ─────────────────────────────────────────
export const executions = sqliteTable("executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id"),
  positionId: integer("position_id"),
  type: text("type").notNull().default("paper"),
  side: text("side").notNull(),
  price: real("price").notNull(),
  size: real("size").notNull(),
  orderId: text("order_id"),
  status: text("status").notNull().default("filled"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Settlements ─────────────────────────────────────────────────
export const settlements = sqliteTable("settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  positionId: integer("position_id").notNull(),
  opportunityId: integer("opportunity_id"),
  outcome: text("outcome").notNull(),
  realizedPnl: real("realized_pnl").notNull(),
  wasCorrect: integer("was_correct", { mode: "boolean" }),
  settledAt: text("settled_at").notNull().default("(datetime('now'))"),
});

// ─── Post-Mortems ────────────────────────────────────────────────
export const postMortems = sqliteTable("post_mortems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id"),
  settlementId: integer("settlement_id"),
  analysis: text("analysis"),
  whatHappened: text("what_happened"),
  whatModelPredicted: text("what_model_predicted"),
  whyWrongOrRight: text("why_wrong_or_right"),
  lessonsLearned: text("lessons_learned"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Memory Store (cross-session state) ──────────────────────────
export const memoryStore = sqliteTable("memory_store", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// ─── Audit Log ───────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  details: text("details"),
  userId: integer("user_id"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Performance Snapshots ───────────────────────────────────────
export const performanceSnapshots = sqliteTable("performance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  bankroll: real("bankroll"),
  totalPnl: real("total_pnl"),
  winRate: real("win_rate"),
  tradeCount: integer("trade_count"),
  snapshotAt: text("snapshot_at").notNull().default("(datetime('now'))"),
});

// ─── Model Log (strategy decisions and events) ───────────────────
export const modelLog = sqliteTable("model_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  event: text("event").notNull(),
  asset: text("asset"),
  details: text("details"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ─── Strategy Performance (per-strategy per-asset tracking) ──────
export const strategyPerformance = sqliteTable("strategy_performance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyName: text("strategy_name").notNull(),
  asset: text("asset").notNull(),
  totalTrades: integer("total_trades").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  alphaWins: real("alpha_wins").notNull().default(1),
  betaLosses: real("beta_losses").notNull().default(1),
  lastUpdated: text("last_updated").notNull().default("(datetime('now'))"),
});

// ─── Backtest Results ─────────────────────────────────────────────
export const backtestResults = sqliteTable("backtest_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategyName: text("strategy_name").notNull(),
  totalTrades: integer("total_trades").notNull(),
  wins: integer("wins").notNull(),
  losses: integer("losses").notNull(),
  winRate: real("win_rate").notNull(),
  totalPnl: real("total_pnl").notNull(),
  avgPnl: real("avg_pnl").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  sharpeRatio: real("sharpe_ratio").notNull(),
  avgConfidence: real("avg_confidence").notNull(),
  rollingWr50: text("rolling_wr_50"),
  runAt: text("run_at").notNull(),
  batchId: text("batch_id").notNull(),
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
