import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// PREDICTION MARKET PLATFORM — Core Tables
// ============================================================================

// --- Pipeline Stage 1: Opportunities (Market Scanner output) ---
export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  platform: text("platform").notNull(), // polymarket | metaculus | predictit | manifold
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(), // politics | crypto | sports | tech | science | culture | other
  marketUrl: text("market_url"),
  currentPrice: real("current_price"), // implied probability 0-1
  volume24h: real("volume_24h").default(0),
  totalLiquidity: real("total_liquidity").default(0),
  expiresAt: text("expires_at"), // market resolution date
  status: text("status").default("discovered"), // discovered | researching | analyzed | approved | rejected | expired | settled
  pipelineStage: text("pipeline_stage").default("scan"), // scan | research | probability | risk | execution | monitoring | settlement | postmortem
  aiProbability: real("ai_probability"), // our ensemble estimate
  marketProbability: real("market_probability"), // market-implied
  edge: real("edge"), // aiProbability - marketProbability
  edgePercent: real("edge_percent"), // edge as percentage
  confidence: text("confidence"), // low | medium | high | very_high
  kellyFraction: real("kelly_fraction"), // optimal bet fraction
  recommendedSize: real("recommended_size"), // $ amount
  recommendedSide: text("recommended_side"), // YES | NO
  tags: text("tags"), // JSON array of tags
  metadata: text("metadata"), // JSON blob for platform-specific data
  conditionId: text("condition_id"), // Polymarket condition ID
  clobTokenIds: text("clob_token_ids"), // JSON array of YES/NO token IDs
  tickSize: text("tick_size"), // "0.01" or "0.001"
  negRisk: integer("neg_risk"), // 0 or 1
  endDate: text("end_date"), // market resolution date
  slug: text("slug"), // Polymarket slug for URL
  discoveredAt: text("discovered_at").notNull(),
  updatedAt: text("updated_at"),
});

// --- Pipeline Stage 2: Research Reports (Research Agent Swarm output) ---
export const researchReports = sqliteTable("research_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  agentType: text("agent_type").notNull(), // news | social | data | expert | contrarian
  summary: text("summary").notNull(),
  findings: text("findings").notNull(), // JSON array of finding objects
  sources: text("sources"), // JSON array of source URLs
  sentiment: text("sentiment"), // bullish | bearish | neutral
  confidenceScore: real("confidence_score"), // 0-1
  latencyMs: integer("latency_ms"),
  tokensUsed: integer("tokens_used"),
  modelUsed: text("model_used"),
  createdAt: text("created_at").notNull(),
});

// --- Pipeline Stage 3: Probability Estimates (AI Ensemble output) ---
export const probabilityEstimates = sqliteTable("probability_estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  gptProbability: real("gpt_probability"),
  claudeProbability: real("claude_probability"),
  geminiProbability: real("gemini_probability"),
  ensembleProbability: real("ensemble_probability").notNull(),
  marketPrice: real("market_price").notNull(),
  edge: real("edge").notNull(),
  modelWeights: text("model_weights"), // JSON { gpt: 0.4, claude: 0.35, gemini: 0.25 }
  reasoning: text("reasoning"),
  modelDetails: text("model_details"), // JSON array of per-model details
  confidence: text("confidence").notNull(), // low | medium | high | very_high
  createdAt: text("created_at").notNull(),
});

// --- Pipeline Stage 4: Risk Assessments ---
export const riskAssessments = sqliteTable("risk_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  kellyFraction: real("kelly_fraction").notNull(),
  halfKellySize: real("half_kelly_size").notNull(),
  maxPositionSize: real("max_position_size").notNull(),
  portfolioVaR: real("portfolio_var"), // Value at Risk after this trade
  portfolioCVaR: real("portfolio_cvar"),
  correlationRisk: text("correlation_risk"), // low | medium | high
  concentrationRisk: text("concentration_risk"), // low | medium | high
  liquidityRisk: text("liquidity_risk"), // low | medium | high
  timeDecayRisk: real("time_decay_risk"), // days to expiry factor
  overallRisk: text("overall_risk").notNull(), // low | medium | high | extreme
  approved: integer("approved").default(0), // 0=pending, 1=approved, -1=rejected
  approvedBy: text("approved_by"), // system | human
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

// --- Pipeline Stage 5: Executions ---
export const executions = sqliteTable("executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  riskAssessmentId: integer("risk_assessment_id"),
  platform: text("platform").notNull(),
  side: text("side").notNull(), // YES | NO
  orderType: text("order_type").notNull(), // market | limit
  requestedPrice: real("requested_price"),
  executedPrice: real("executed_price"),
  size: real("size").notNull(), // dollar amount
  quantity: real("quantity"), // number of contracts
  status: text("status").default("pending"), // pending | submitted | filled | partial | cancelled | failed
  paperTrade: integer("paper_trade").default(1), // 1=paper, 0=live
  externalOrderId: text("external_order_id"),
  slippage: real("slippage"), // price diff from requested
  fees: real("fees").default(0),
  errorMessage: text("error_message"),
  submittedAt: text("submitted_at").notNull(),
  filledAt: text("filled_at"),
});

// --- Pipeline Stage 6: Active Positions (derived from executions) ---
export const activePositions = sqliteTable("active_positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  executionId: integer("execution_id").notNull(),
  platform: text("platform").notNull(),
  title: text("title").notNull(),
  side: text("side").notNull(),
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price"),
  size: real("size").notNull(),
  unrealizedPnl: real("unrealized_pnl").default(0),
  unrealizedPnlPercent: real("unrealized_pnl_percent").default(0),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  status: text("status").default("open"), // open | closing | closed
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
});

// --- Pipeline Stage 7: Settlements ---
export const settlements = sqliteTable("settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  positionId: integer("position_id"),
  outcome: text("outcome"), // YES | NO | null (if not yet resolved)
  ourPrediction: real("our_prediction"), // our ensemble probability at time of trade
  marketPriceAtEntry: real("market_price_at_entry"),
  finalPrice: real("final_price"),
  realizedPnl: real("realized_pnl"),
  realizedPnlPercent: real("realized_pnl_percent"),
  wasCorrect: integer("was_correct"), // 1=yes, 0=no, null=pending
  status: text("status").default("monitoring"), // monitoring | resolving | settled
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull(),
});

// --- Pipeline Stage 8: Post-Mortems ---
export const postMortems = sqliteTable("post_mortems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  opportunityId: integer("opportunity_id").notNull(),
  settlementId: integer("settlement_id"),
  predictionAccuracy: real("prediction_accuracy"), // |actual - predicted|
  calibrationError: real("calibration_error"),
  edgeRealized: real("edge_realized"), // actual edge vs expected
  whatWorked: text("what_worked"), // JSON array
  whatFailed: text("what_failed"), // JSON array
  lessonsLearned: text("lessons_learned"),
  modelPerformance: text("model_performance"), // JSON { gpt: { correct: true, error: 0.05 }, ... }
  recommendations: text("recommendations"), // JSON array of improvement suggestions
  aiAnalysis: text("ai_analysis"), // LLM-generated post-mortem
  createdAt: text("created_at").notNull(),
});

// --- Memory Store (cross-session learning) ---
export const memoryStore = sqliteTable("memory_store", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(), // pattern | bias | model_perf | market_regime | lesson
  key: text("key").notNull(),
  value: text("value").notNull(), // JSON
  confidence: real("confidence").default(0.5),
  usageCount: integer("usage_count").default(0),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

// --- Audit Log (all system actions) ---
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(), // scan | research | predict | assess_risk | approve | execute | settle | postmortem
  entityType: text("entity_type").notNull(), // opportunity | execution | position | settlement
  entityId: integer("entity_id"),
  actor: text("actor").notNull(), // system | human | agent:<name>
  details: text("details"), // JSON
  timestamp: text("timestamp").notNull(),
});

// --- Platform Configuration ---
export const platformConfig = sqliteTable("platform_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

// --- Performance Snapshots (time-series for charts) ---
export const performanceSnapshots = sqliteTable("performance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  totalPnl: real("total_pnl").notNull(),
  portfolioValue: real("portfolio_value").notNull(),
  winRate: real("win_rate").notNull(),
  totalTrades: integer("total_trades").notNull(),
  openPositions: integer("open_positions").default(0),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  timestamp: text("timestamp").notNull(),
});

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

// Prediction Market Platform
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true });
export const insertResearchReportSchema = createInsertSchema(researchReports).omit({ id: true });
export const insertProbabilityEstimateSchema = createInsertSchema(probabilityEstimates).omit({ id: true });
export const insertRiskAssessmentSchema = createInsertSchema(riskAssessments).omit({ id: true });
export const insertExecutionSchema = createInsertSchema(executions).omit({ id: true });
export const insertActivePositionSchema = createInsertSchema(activePositions).omit({ id: true });
export const insertSettlementSchema = createInsertSchema(settlements).omit({ id: true });
export const insertPostMortemSchema = createInsertSchema(postMortems).omit({ id: true });
export const insertMemoryStoreSchema = createInsertSchema(memoryStore).omit({ id: true });
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true });
export const insertPlatformConfigSchema = createInsertSchema(platformConfig).omit({ id: true });
export const insertPerformanceSnapshotSchema = createInsertSchema(performanceSnapshots).omit({ id: true });

export type Opportunity = typeof opportunities.$inferSelect;
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type ResearchReport = typeof researchReports.$inferSelect;
export type InsertResearchReport = z.infer<typeof insertResearchReportSchema>;
export type ProbabilityEstimate = typeof probabilityEstimates.$inferSelect;
export type InsertProbabilityEstimate = z.infer<typeof insertProbabilityEstimateSchema>;
export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = z.infer<typeof insertRiskAssessmentSchema>;
export type Execution = typeof executions.$inferSelect;
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type ActivePosition = typeof activePositions.$inferSelect;
export type InsertActivePosition = z.infer<typeof insertActivePositionSchema>;
export type Settlement = typeof settlements.$inferSelect;
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;
export type PostMortem = typeof postMortems.$inferSelect;
export type InsertPostMortem = z.infer<typeof insertPostMortemSchema>;
export type MemoryEntry = typeof memoryStore.$inferSelect;
export type InsertMemoryEntry = z.infer<typeof insertMemoryStoreSchema>;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = z.infer<typeof insertAuditLogSchema>;
export type PlatformConfigEntry = typeof platformConfig.$inferSelect;
export type InsertPlatformConfigEntry = z.infer<typeof insertPlatformConfigSchema>;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type InsertPerformanceSnapshot = z.infer<typeof insertPerformanceSnapshotSchema>;

// Pipeline stage type
export type PipelineStage = "scan" | "research" | "probability" | "risk" | "execution" | "monitoring" | "settlement" | "postmortem";
