import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, sql, like, asc } from "drizzle-orm";
import {
  users, platformConfig, opportunities, researchReports,
  probabilityEstimates, riskAssessments, activePositions,
  executions, settlements, postMortems, memoryStore,
  auditLog, performanceSnapshots, modelLog, strategyPerformance,
  backtestResults,
  type User, type InsertUser, type Opportunity, type ActivePosition,
  type Execution, type Settlement, type AuditLogEntry, type ModelLogEntry,
  type StrategyPerf, type PerformanceSnapshot, type MemoryStoreEntry,
  type PlatformConfig, type BacktestResult, type InsertBacktestResult,
} from "@shared/schema";

const DB_PATH = process.env.DATA_DIR
  ? `${process.env.DATA_DIR}/data.db`
  : "data.db";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);

// ─── Schema push (first run only) ────────────────────────────────
export function ensureSchema() {
  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  ).get();
  if (!tables) {
    console.log("[DB] First run — creating schema...");
    // Use drizzle-kit push programmatically via raw SQL
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS platform_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'polymarket',
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'crypto',
        current_price REAL,
        volume_24h REAL,
        status TEXT NOT NULL DEFAULT 'active',
        pipeline_stage TEXT NOT NULL DEFAULT 'scanned',
        ai_probability REAL,
        edge REAL,
        condition_id TEXT,
        clob_token_ids TEXT,
        tick_size REAL,
        neg_risk INTEGER DEFAULT 0,
        end_date TEXT,
        slug TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS research_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER NOT NULL,
        agent_type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL,
        sources TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS probability_estimates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER NOT NULL,
        model_name TEXT NOT NULL,
        estimated_probability REAL NOT NULL,
        confidence REAL,
        reasoning TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS risk_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER NOT NULL,
        kelly_fraction REAL,
        position_size REAL,
        risk_score REAL,
        approved INTEGER DEFAULT 0,
        block_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS active_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL,
        size REAL NOT NULL,
        unrealized_pnl REAL DEFAULT 0,
        realized_pnl REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT NOT NULL DEFAULT 'pipeline',
        asset TEXT,
        window_start INTEGER,
        window_end INTEGER,
        slug TEXT,
        strategy_used TEXT,
        confidence REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER,
        position_id INTEGER,
        type TEXT NOT NULL DEFAULT 'paper',
        side TEXT NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        order_id TEXT,
        status TEXT NOT NULL DEFAULT 'filled',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        opportunity_id INTEGER,
        outcome TEXT NOT NULL,
        realized_pnl REAL NOT NULL,
        was_correct INTEGER,
        settled_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_mortems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER,
        settlement_id INTEGER,
        analysis TEXT,
        what_happened TEXT,
        what_model_predicted TEXT,
        why_wrong_or_right TEXT,
        lessons_learned TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory_store (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(category, key)
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS performance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        bankroll REAL,
        total_pnl REAL,
        win_rate REAL,
        trade_count INTEGER,
        snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS model_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        asset TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS strategy_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_name TEXT NOT NULL,
        asset TEXT NOT NULL,
        total_trades INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        alpha_wins REAL NOT NULL DEFAULT 1,
        beta_losses REAL NOT NULL DEFAULT 1,
        last_updated TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS backtest_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_name TEXT NOT NULL,
        total_trades INTEGER NOT NULL,
        wins INTEGER NOT NULL,
        losses INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        total_pnl REAL NOT NULL,
        avg_pnl REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        sharpe_ratio REAL NOT NULL,
        avg_confidence REAL NOT NULL,
        rolling_wr_50 TEXT,
        run_at TEXT NOT NULL,
        batch_id TEXT NOT NULL
      );
    `;
    sqlite.exec(schema);
    console.log("[DB] Schema created.");
  }

  // Migrate: add backtest_results table if it doesn't exist (for existing DBs)
  const btTable = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='backtest_results'"
  ).get();
  if (!btTable) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_name TEXT NOT NULL,
        total_trades INTEGER NOT NULL,
        wins INTEGER NOT NULL,
        losses INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        total_pnl REAL NOT NULL,
        avg_pnl REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        sharpe_ratio REAL NOT NULL,
        avg_confidence REAL NOT NULL,
        rolling_wr_50 TEXT,
        run_at TEXT NOT NULL,
        batch_id TEXT NOT NULL
      );
    `);
    console.log("[DB] Migration: backtest_results table created.");
  }
}

// ─── Storage Interface ───────────────────────────────────────────
export const storage = {
  // ── Users ──
  getUserByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get();
  },
  createUser(data: InsertUser): User {
    return db.insert(users).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  },

  // ── Config ──
  getConfig(key: string): string | undefined {
    const row = db.select().from(platformConfig).where(eq(platformConfig.key, key)).get();
    return row?.value;
  },
  getAllConfig(): PlatformConfig[] {
    return db.select().from(platformConfig).all();
  },
  setConfig(key: string, value: string) {
    const existing = db.select().from(platformConfig).where(eq(platformConfig.key, key)).get();
    if (existing) {
      db.update(platformConfig)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(eq(platformConfig.key, key))
        .run();
    } else {
      db.insert(platformConfig).values({ key, value }).run();
    }
  },

  // ── Opportunities ──
  getOpportunities(filter?: { status?: string; category?: string; pipelineStage?: string }) {
    let q = db.select().from(opportunities).orderBy(desc(opportunities.createdAt));
    // Filter applied in route layer for simplicity
    return q.all();
  },
  getOpportunity(id: number) {
    return db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  },
  createOpportunity(data: any) {
    const now = new Date().toISOString();
    return db.insert(opportunities).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
  },
  updateOpportunity(id: number, data: any) {
    return db.update(opportunities).set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(opportunities.id, id)).run();
  },

  // ── Positions ──
  getPositions(filter: { source?: string; status?: string } = {}) {
    const conditions = [];
    if (filter.source) conditions.push(eq(activePositions.source, filter.source));
    if (filter.status) conditions.push(eq(activePositions.status, filter.status));
    const q = conditions.length > 0
      ? db.select().from(activePositions).where(and(...conditions))
      : db.select().from(activePositions);
    return q.orderBy(desc(activePositions.createdAt)).all();
  },
  getPosition(id: number) {
    return db.select().from(activePositions).where(eq(activePositions.id, id)).get();
  },
  createPosition(data: any): ActivePosition {
    return db.insert(activePositions).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  },
  updatePosition(id: number, data: any) {
    return db.update(activePositions).set(data).where(eq(activePositions.id, id)).run();
  },

  // ── Executions ──
  getExecutions(filter: { source?: string } = {}) {
    // Join with positions if needed — keep simple for now
    return db.select().from(executions).orderBy(desc(executions.createdAt)).all();
  },
  createExecution(data: any): Execution {
    return db.insert(executions).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  },

  // ── Settlements ──
  getSettlements() {
    return db.select().from(settlements).orderBy(desc(settlements.settledAt)).all();
  },
  createSettlement(data: any): Settlement {
    return db.insert(settlements).values({ ...data, settledAt: new Date().toISOString() }).returning().get();
  },

  // ── Post-Mortems ──
  getPostMortems() {
    return db.select().from(postMortems).orderBy(desc(postMortems.createdAt)).all();
  },
  createPostMortem(data: any) {
    return db.insert(postMortems).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  },

  // ── Audit Log ──
  getAuditLog(limit = 200) {
    return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit).all();
  },
  addAuditEntry(action: string, details?: string, userId?: number) {
    return db.insert(auditLog).values({
      action,
      details: details || null,
      userId: userId || null,
      createdAt: new Date().toISOString(),
    }).run();
  },

  // ── Model Log ──
  getModelLog(limit = 200, asset?: string) {
    if (asset) {
      return db.select().from(modelLog)
        .where(eq(modelLog.asset, asset))
        .orderBy(desc(modelLog.createdAt)).limit(limit).all();
    }
    return db.select().from(modelLog).orderBy(desc(modelLog.createdAt)).limit(limit).all();
  },
  addModelLog(event: string, asset?: string, details?: string) {
    return db.insert(modelLog).values({
      event,
      asset: asset || null,
      details: details || null,
      createdAt: new Date().toISOString(),
    }).run();
  },

  // ── Strategy Performance ──
  getStrategyPerformance(asset?: string) {
    if (asset) {
      return db.select().from(strategyPerformance)
        .where(eq(strategyPerformance.asset, asset)).all();
    }
    return db.select().from(strategyPerformance).all();
  },
  getOrCreateStrategyPerf(strategyName: string, asset: string): StrategyPerf {
    let row = db.select().from(strategyPerformance)
      .where(and(
        eq(strategyPerformance.strategyName, strategyName),
        eq(strategyPerformance.asset, asset)
      )).get();
    if (!row) {
      row = db.insert(strategyPerformance).values({
        strategyName, asset,
        totalTrades: 0, wins: 0, losses: 0,
        alphaWins: 1, betaLosses: 1,
      }).returning().get();
    }
    return row;
  },
  updateStrategyPerf(id: number, data: Partial<StrategyPerf>) {
    return db.update(strategyPerformance)
      .set({ ...data, lastUpdated: new Date().toISOString() })
      .where(eq(strategyPerformance.id, id)).run();
  },

  // ── Performance Snapshots ──
  getPerformanceSnapshots(source: string, limit = 100) {
    return db.select().from(performanceSnapshots)
      .where(eq(performanceSnapshots.source, source))
      .orderBy(desc(performanceSnapshots.snapshotAt))
      .limit(limit).all();
  },
  addPerformanceSnapshot(data: any) {
    return db.insert(performanceSnapshots).values(data).run();
  },

  // ── Memory Store ──
  getMemory(category: string, key: string): string | undefined {
    const row = db.select().from(memoryStore)
      .where(and(eq(memoryStore.category, category), eq(memoryStore.key, key))).get();
    return row?.value;
  },
  setMemory(category: string, key: string, value: string) {
    const existing = db.select().from(memoryStore)
      .where(and(eq(memoryStore.category, category), eq(memoryStore.key, key))).get();
    if (existing) {
      db.update(memoryStore)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(eq(memoryStore.id, existing.id)).run();
    } else {
      db.insert(memoryStore).values({ category, key, value }).run();
    }
  },
  getMemoryByCategory(category: string): MemoryStoreEntry[] {
    return db.select().from(memoryStore)
      .where(eq(memoryStore.category, category)).all();
  },

  // ── Micro Dashboard Stats ──
  getMicroStats() {
    const positions = db.select().from(activePositions)
      .where(eq(activePositions.source, "micro")).all();
    const closed = positions.filter(p => p.status === "closed" || p.status === "settled");
    const open = positions.filter(p => p.status === "open");
    const wins = closed.filter(p => (p.realizedPnl ?? 0) > 0).length;
    const totalPnl = closed.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    const winRate = closed.length > 0 ? wins / closed.length : 0;

    // Per-asset breakdown
    const assets = ["btc", "eth", "sol", "xrp"];
    const assetStats = assets.map(asset => {
      const assetClosed = closed.filter(p => p.asset === asset);
      const assetWins = assetClosed.filter(p => (p.realizedPnl ?? 0) > 0).length;
      const assetPnl = assetClosed.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
      return {
        asset,
        trades: assetClosed.length,
        wins: assetWins,
        winRate: assetClosed.length > 0 ? assetWins / assetClosed.length : 0,
        pnl: assetPnl,
      };
    });

    return {
      totalTrades: closed.length,
      openPositions: open.length,
      winRate,
      totalPnl,
      assetStats,
    };
  },

  // ── Micro: recent trades for an asset (for cooldown/calibration) ──
  getRecentMicroTrades(asset: string, limit = 5) {
    return db.select().from(activePositions)
      .where(and(
        eq(activePositions.source, "micro"),
        eq(activePositions.asset, asset),
        eq(activePositions.status, "settled"),
      ))
      .orderBy(desc(activePositions.closedAt))
      .limit(limit).all();
  },

  // ── Backtest Results ──
  saveBacktestResult(data: InsertBacktestResult): BacktestResult {
    return db.insert(backtestResults).values(data).returning().get();
  },
  getLatestBacktestResults(): BacktestResult[] {
    // Get the latest batchId
    const latest = db.select().from(backtestResults)
      .orderBy(desc(backtestResults.runAt))
      .limit(1).get();
    if (!latest) return [];
    return db.select().from(backtestResults)
      .where(eq(backtestResults.batchId, latest.batchId))
      .orderBy(desc(backtestResults.winRate))
      .all();
  },
  getBacktestResultsByBatch(batchId: string): BacktestResult[] {
    return db.select().from(backtestResults)
      .where(eq(backtestResults.batchId, batchId))
      .orderBy(desc(backtestResults.winRate))
      .all();
  },
};
