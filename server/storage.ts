import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
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

// ─── Database Connection ──────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required. Set it to your MySQL connection string.");
}

const pool = mysql.createPool({
  uri: DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: DATABASE_URL.includes("tidb") || DATABASE_URL.includes("aiven") || DATABASE_URL.includes("clever")
    ? { rejectUnauthorized: true }
    : undefined,
});

export const db = drizzle(pool);

// ─── Schema push (auto-create tables) ───────────────────────────
export async function ensureSchema() {
  const conn = await pool.getConnection();
  try {
    // Check if users table exists
    const [rows] = await conn.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    if ((rows as any[]).length > 0) {
      console.log("[DB] Tables already exist — skipping schema creation.");
      // Check for backtest_results table (migration)
      const [btRows] = await conn.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_results'"
      );
      if ((btRows as any[]).length === 0) {
        await conn.query(`
          CREATE TABLE backtest_results (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            strategy_name VARCHAR(64) NOT NULL,
            total_trades INT NOT NULL,
            wins INT NOT NULL,
            losses INT NOT NULL,
            win_rate DOUBLE NOT NULL,
            total_pnl DOUBLE NOT NULL,
            avg_pnl DOUBLE NOT NULL,
            max_drawdown DOUBLE NOT NULL,
            sharpe_ratio DOUBLE NOT NULL,
            avg_confidence DOUBLE NOT NULL,
            rolling_wr_50 TEXT,
            run_at VARCHAR(64) NOT NULL,
            batch_id VARCHAR(64) NOT NULL
          )
        `);
        console.log("[DB] Migration: backtest_results table created.");
      }
      return;
    }

    console.log("[DB] First run — creating schema...");
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS platform_config (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(255) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        external_id VARCHAR(255) NOT NULL,
        platform VARCHAR(64) NOT NULL DEFAULT 'polymarket',
        title TEXT NOT NULL,
        category VARCHAR(64) NOT NULL DEFAULT 'crypto',
        current_price DOUBLE,
        volume_24h DOUBLE,
        status VARCHAR(64) NOT NULL DEFAULT 'active',
        pipeline_stage VARCHAR(64) NOT NULL DEFAULT 'scanned',
        ai_probability DOUBLE,
        edge DOUBLE,
        condition_id VARCHAR(255),
        clob_token_ids TEXT,
        tick_size DOUBLE,
        neg_risk BOOLEAN DEFAULT FALSE,
        end_date VARCHAR(64),
        slug VARCHAR(512),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS research_reports (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT NOT NULL,
        agent_type VARCHAR(128) NOT NULL,
        content TEXT NOT NULL,
        confidence DOUBLE,
        sources TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS probability_estimates (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT NOT NULL,
        model_name VARCHAR(128) NOT NULL,
        estimated_probability DOUBLE NOT NULL,
        confidence DOUBLE,
        reasoning TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS risk_assessments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT NOT NULL,
        kelly_fraction DOUBLE,
        position_size DOUBLE,
        risk_score DOUBLE,
        approved BOOLEAN DEFAULT FALSE,
        block_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS active_positions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT,
        side VARCHAR(16) NOT NULL,
        entry_price DOUBLE NOT NULL,
        current_price DOUBLE,
        size DOUBLE NOT NULL,
        unrealized_pnl DOUBLE DEFAULT 0,
        realized_pnl DOUBLE DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        source VARCHAR(32) NOT NULL DEFAULT 'pipeline',
        asset VARCHAR(16),
        window_start INT,
        window_end INT,
        slug VARCHAR(512),
        strategy_used VARCHAR(64),
        confidence DOUBLE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL
      );
      CREATE TABLE IF NOT EXISTS executions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT,
        position_id INT,
        type VARCHAR(32) NOT NULL DEFAULT 'paper',
        side VARCHAR(16) NOT NULL,
        price DOUBLE NOT NULL,
        size DOUBLE NOT NULL,
        order_id VARCHAR(255),
        status VARCHAR(32) NOT NULL DEFAULT 'filled',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settlements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        position_id INT NOT NULL,
        opportunity_id INT,
        outcome VARCHAR(32) NOT NULL,
        realized_pnl DOUBLE NOT NULL,
        was_correct BOOLEAN,
        settled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS post_mortems (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        opportunity_id INT,
        settlement_id INT,
        analysis TEXT,
        what_happened TEXT,
        what_model_predicted TEXT,
        why_wrong_or_right TEXT,
        lessons_learned TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memory_store (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(128) NOT NULL,
        key_name VARCHAR(512) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cat_key (category, key_name)
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(128) NOT NULL,
        details TEXT,
        user_id INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS performance_snapshots (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source VARCHAR(32) NOT NULL,
        bankroll DOUBLE,
        total_pnl DOUBLE,
        win_rate DOUBLE,
        trade_count INT,
        snapshot_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS model_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event VARCHAR(128) NOT NULL,
        asset VARCHAR(16),
        details TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS strategy_performance (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        strategy_name VARCHAR(64) NOT NULL,
        asset VARCHAR(16) NOT NULL,
        total_trades INT NOT NULL DEFAULT 0,
        wins INT NOT NULL DEFAULT 0,
        losses INT NOT NULL DEFAULT 0,
        alpha_wins DOUBLE NOT NULL DEFAULT 1,
        beta_losses DOUBLE NOT NULL DEFAULT 1,
        last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS backtest_results (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        strategy_name VARCHAR(64) NOT NULL,
        total_trades INT NOT NULL,
        wins INT NOT NULL,
        losses INT NOT NULL,
        win_rate DOUBLE NOT NULL,
        total_pnl DOUBLE NOT NULL,
        avg_pnl DOUBLE NOT NULL,
        max_drawdown DOUBLE NOT NULL,
        sharpe_ratio DOUBLE NOT NULL,
        avg_confidence DOUBLE NOT NULL,
        rolling_wr_50 TEXT,
        run_at VARCHAR(64) NOT NULL,
        batch_id VARCHAR(64) NOT NULL
      );
    `;

    // Execute each statement separately (mysql2 doesn't support multi-statement by default)
    const statements = schema.split(";").map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    console.log("[DB] Schema created.");
  } finally {
    conn.release();
  }
}

// ─── Helper: get first row from drizzle select ──────────────────
// Drizzle mysql2 returns arrays. We need helpers to get single rows.

// ─── Storage Interface ───────────────────────────────────────────
export const storage = {
  // ── Users ──
  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0];
  },
  async createUser(data: InsertUser): Promise<User> {
    const now = new Date();
    await db.insert(users).values({ ...data, createdAt: now });
    const rows = await db.select().from(users).where(eq(users.username, data.username));
    return rows[0]!;
  },

  // ── Config ──
  async getConfig(key: string): Promise<string | undefined> {
    const rows = await db.select().from(platformConfig).where(eq(platformConfig.key, key));
    return rows[0]?.value;
  },
  async getAllConfig(): Promise<PlatformConfig[]> {
    return await db.select().from(platformConfig);
  },
  async setConfig(key: string, value: string) {
    const rows = await db.select().from(platformConfig).where(eq(platformConfig.key, key));
    if (rows[0]) {
      await db.update(platformConfig)
        .set({ value, updatedAt: new Date() })
        .where(eq(platformConfig.key, key));
    } else {
      await db.insert(platformConfig).values({ key, value });
    }
  },

  // ── Opportunities ──
  async getOpportunities(filter?: { status?: string; category?: string; pipelineStage?: string }) {
    const rows = await db.select().from(opportunities).orderBy(desc(opportunities.createdAt));
    return rows;
  },
  async getOpportunity(id: number) {
    const rows = await db.select().from(opportunities).where(eq(opportunities.id, id));
    return rows[0];
  },
  async createOpportunity(data: any) {
    const now = new Date();
    const result = await db.insert(opportunities).values({ ...data, createdAt: now, updatedAt: now });
    const insertId = (result as any)[0]?.insertId;
    if (insertId) {
      const rows = await db.select().from(opportunities).where(eq(opportunities.id, insertId));
      return rows[0];
    }
    return data;
  },
  async updateOpportunity(id: number, data: any) {
    await db.update(opportunities).set({ ...data, updatedAt: new Date() })
      .where(eq(opportunities.id, id));
  },

  // ── Positions ──
  async getPositions(filter: { source?: string; status?: string } = {}) {
    const conditions = [];
    if (filter.source) conditions.push(eq(activePositions.source, filter.source));
    if (filter.status) conditions.push(eq(activePositions.status, filter.status));
    const q = conditions.length > 0
      ? db.select().from(activePositions).where(and(...conditions))
      : db.select().from(activePositions);
    return await q.orderBy(desc(activePositions.createdAt));
  },
  async getPosition(id: number) {
    const rows = await db.select().from(activePositions).where(eq(activePositions.id, id));
    return rows[0];
  },
  async createPosition(data: any): Promise<ActivePosition> {
    const now = new Date();
    const result = await db.insert(activePositions).values({ ...data, createdAt: now });
    const insertId = (result as any)[0]?.insertId;
    const rows = await db.select().from(activePositions).where(eq(activePositions.id, insertId));
    return rows[0]!;
  },
  async updatePosition(id: number, data: any) {
    await db.update(activePositions).set(data).where(eq(activePositions.id, id));
  },

  // ── Executions ──
  async getExecutions(filter: { source?: string } = {}) {
    return await db.select().from(executions).orderBy(desc(executions.createdAt));
  },
  async createExecution(data: any): Promise<Execution> {
    const now = new Date();
    const result = await db.insert(executions).values({ ...data, createdAt: now });
    const insertId = (result as any)[0]?.insertId;
    const rows = await db.select().from(executions).where(eq(executions.id, insertId));
    return rows[0]!;
  },

  // ── Settlements ──
  async getSettlements() {
    return await db.select().from(settlements).orderBy(desc(settlements.settledAt));
  },
  async createSettlement(data: any): Promise<Settlement> {
    const now = new Date();
    const result = await db.insert(settlements).values({ ...data, settledAt: now });
    const insertId = (result as any)[0]?.insertId;
    const rows = await db.select().from(settlements).where(eq(settlements.id, insertId));
    return rows[0]!;
  },

  // ── Post-Mortems ──
  async getPostMortems() {
    return await db.select().from(postMortems).orderBy(desc(postMortems.createdAt));
  },
  async createPostMortem(data: any) {
    const now = new Date();
    const result = await db.insert(postMortems).values({ ...data, createdAt: now });
    const insertId = (result as any)[0]?.insertId;
    const rows = await db.select().from(postMortems).where(eq(postMortems.id, insertId));
    return rows[0];
  },

  // ── Audit Log ──
  async getAuditLog(limit = 200) {
    return await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  },
  async addAuditEntry(action: string, details?: string, userId?: number) {
    await db.insert(auditLog).values({
      action,
      details: details || null,
      userId: userId || null,
      createdAt: new Date(),
    });
  },

  // ── Model Log ──
  async getModelLog(limit = 200, asset?: string) {
    if (asset) {
      return await db.select().from(modelLog)
        .where(eq(modelLog.asset, asset))
        .orderBy(desc(modelLog.createdAt)).limit(limit);
    }
    return await db.select().from(modelLog).orderBy(desc(modelLog.createdAt)).limit(limit);
  },
  async addModelLog(event: string, asset?: string, details?: string) {
    await db.insert(modelLog).values({
      event,
      asset: asset || null,
      details: details || null,
      createdAt: new Date(),
    });
  },

  // ── Strategy Performance ──
  async getStrategyPerformance(asset?: string) {
    if (asset) {
      return await db.select().from(strategyPerformance)
        .where(eq(strategyPerformance.asset, asset));
    }
    return await db.select().from(strategyPerformance);
  },
  async getOrCreateStrategyPerf(strategyName: string, asset: string): Promise<StrategyPerf> {
    let rows = await db.select().from(strategyPerformance)
      .where(and(
        eq(strategyPerformance.strategyName, strategyName),
        eq(strategyPerformance.asset, asset)
      ));
    if (rows[0]) return rows[0];

    await db.insert(strategyPerformance).values({
      strategyName, asset,
      totalTrades: 0, wins: 0, losses: 0,
      alphaWins: 1, betaLosses: 1,
    });
    rows = await db.select().from(strategyPerformance)
      .where(and(
        eq(strategyPerformance.strategyName, strategyName),
        eq(strategyPerformance.asset, asset)
      ));
    return rows[0]!;
  },
  async updateStrategyPerf(id: number, data: Partial<StrategyPerf>) {
    await db.update(strategyPerformance)
      .set({ ...data, lastUpdated: new Date() })
      .where(eq(strategyPerformance.id, id));
  },

  // ── Performance Snapshots ──
  async getPerformanceSnapshots(source: string, limit = 100) {
    return await db.select().from(performanceSnapshots)
      .where(eq(performanceSnapshots.source, source))
      .orderBy(desc(performanceSnapshots.snapshotAt))
      .limit(limit);
  },
  async addPerformanceSnapshot(data: any) {
    await db.insert(performanceSnapshots).values(data);
  },

  // ── Memory Store ──
  async getMemory(category: string, key: string): Promise<string | undefined> {
    const rows = await db.select().from(memoryStore)
      .where(and(eq(memoryStore.category, category), eq(memoryStore.key, key)));
    return rows[0]?.value;
  },
  async setMemory(category: string, key: string, value: string) {
    const rows = await db.select().from(memoryStore)
      .where(and(eq(memoryStore.category, category), eq(memoryStore.key, key)));
    if (rows[0]) {
      await db.update(memoryStore)
        .set({ value, updatedAt: new Date() })
        .where(eq(memoryStore.id, rows[0].id));
    } else {
      await db.insert(memoryStore).values({ category, key, value });
    }
  },
  async getMemoryByCategory(category: string): Promise<MemoryStoreEntry[]> {
    return await db.select().from(memoryStore)
      .where(eq(memoryStore.category, category));
  },

  // ── Micro Dashboard Stats ──
  async getMicroStats() {
    const positions = await db.select().from(activePositions)
      .where(eq(activePositions.source, "micro"));
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
  async getRecentMicroTrades(asset: string, limit = 5) {
    return await db.select().from(activePositions)
      .where(and(
        eq(activePositions.source, "micro"),
        eq(activePositions.asset, asset),
        eq(activePositions.status, "settled"),
      ))
      .orderBy(desc(activePositions.closedAt))
      .limit(limit);
  },

  // ── Backtest Results ──
  async saveBacktestResult(data: InsertBacktestResult): Promise<BacktestResult> {
    const result = await db.insert(backtestResults).values(data);
    const insertId = (result as any)[0]?.insertId;
    const rows = await db.select().from(backtestResults).where(eq(backtestResults.id, insertId));
    return rows[0]!;
  },
  async getLatestBacktestResults(): Promise<BacktestResult[]> {
    const latest = await db.select().from(backtestResults)
      .orderBy(desc(backtestResults.runAt))
      .limit(1);
    if (!latest[0]) return [];
    return await db.select().from(backtestResults)
      .where(eq(backtestResults.batchId, latest[0].batchId))
      .orderBy(desc(backtestResults.winRate));
  },
  async getBacktestResultsByBatch(batchId: string): Promise<BacktestResult[]> {
    return await db.select().from(backtestResults)
      .where(eq(backtestResults.batchId, batchId))
      .orderBy(desc(backtestResults.winRate));
  },

  // ── Delete memory entry (for logout) ──
  async deleteMemory(category: string, key: string) {
    await db.delete(memoryStore).where(
      and(eq(memoryStore.category, category), eq(memoryStore.key, key))
    );
  },
};
