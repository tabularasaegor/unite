import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, sql, like, gte } from "drizzle-orm";
import {
  opportunities, researchReports, probabilityEstimates, riskAssessments,
  executions, activePositions, settlements, postMortems, memoryStore,
  auditLog, platformConfig, performanceSnapshots,
  type Opportunity, type InsertOpportunity,
  type ResearchReport, type InsertResearchReport,
  type ProbabilityEstimate, type InsertProbabilityEstimate,
  type RiskAssessment, type InsertRiskAssessment,
  type Execution, type InsertExecution,
  type ActivePosition, type InsertActivePosition,
  type Settlement, type InsertSettlement,
  type PostMortem, type InsertPostMortem,
  type MemoryEntry, type InsertMemoryEntry,
  type AuditLogEntry, type InsertAuditLogEntry,
  type PerformanceSnapshot, type InsertPerformanceSnapshot,
} from "@shared/schema";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

export interface IStorage {
  getOpportunities(filters?: { status?: string; platform?: string; stage?: string; limit?: number }): Opportunity[];
  getOpportunity(id: number): Opportunity | undefined;
  getOpportunityByExternalId(externalId: string): Opportunity | undefined;
  createOpportunity(data: InsertOpportunity): Opportunity;
  updateOpportunity(id: number, data: Partial<InsertOpportunity>): void;
  getResearchReports(opportunityId: number): ResearchReport[];
  createResearchReport(data: InsertResearchReport): ResearchReport;
  getProbabilityEstimates(opportunityId: number): ProbabilityEstimate[];
  getLatestEstimate(opportunityId: number): ProbabilityEstimate | undefined;
  createProbabilityEstimate(data: InsertProbabilityEstimate): ProbabilityEstimate;
  getRiskAssessment(opportunityId: number): RiskAssessment | undefined;
  createRiskAssessment(data: InsertRiskAssessment): RiskAssessment;
  updateRiskAssessment(id: number, data: Partial<InsertRiskAssessment>): void;
  getExecutions(filters?: { status?: string; opportunityId?: number }): Execution[];
  getExecution(id: number): Execution | undefined;
  createExecution(data: InsertExecution): Execution;
  updateExecution(id: number, data: Partial<InsertExecution>): void;
  getActivePositions(status?: string): ActivePosition[];
  getActivePosition(id: number): ActivePosition | undefined;
  createActivePosition(data: InsertActivePosition): ActivePosition;
  updateActivePosition(id: number, data: Partial<InsertActivePosition>): void;
  getSettlements(filters?: { status?: string }): Settlement[];
  getSettlement(opportunityId: number): Settlement | undefined;
  createSettlement(data: InsertSettlement): Settlement;
  updateSettlement(id: number, data: Partial<InsertSettlement>): void;
  getPostMortems(limit?: number): PostMortem[];
  createPostMortem(data: InsertPostMortem): PostMortem;
  getMemory(category: string, key?: string): MemoryEntry[];
  upsertMemory(data: InsertMemoryEntry): MemoryEntry;
  getAuditLog(limit?: number, entityType?: string): AuditLogEntry[];
  createAuditEntry(data: InsertAuditLogEntry): AuditLogEntry;
  getConfig(key: string): string | undefined;
  setConfig(key: string, value: string): void;
  getPerformanceSnapshots(limit?: number): PerformanceSnapshot[];
  createPerformanceSnapshot(data: InsertPerformanceSnapshot): PerformanceSnapshot;
  getDashboardStats(): {
    totalOpportunities: number;
    activePositions: number;
    totalPnl: number;
    winRate: number;
    portfolioValue: number;
    avgEdge: number;
    totalTrades: number;
    pendingApprovals: number;
  };
}

class SqliteStorage implements IStorage {
  getOpportunities(filters?: { status?: string; platform?: string; stage?: string; limit?: number }): Opportunity[] {
    let query = db.select().from(opportunities).orderBy(desc(opportunities.discoveredAt));
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(opportunities.status, filters.status));
    if (filters?.platform) conditions.push(eq(opportunities.platform, filters.platform));
    if (filters?.stage) conditions.push(eq(opportunities.pipelineStage, filters.stage));
    if (conditions.length > 0) query = query.where(and(...conditions)) as any;
    if (filters?.limit) query = query.limit(filters.limit) as any;
    return query.all();
  }

  getOpportunity(id: number): Opportunity | undefined {
    return db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  }

  getOpportunityByExternalId(externalId: string): Opportunity | undefined {
    return db.select().from(opportunities).where(eq(opportunities.externalId, externalId)).get();
  }

  createOpportunity(data: InsertOpportunity): Opportunity {
    return db.insert(opportunities).values(data).returning().get();
  }

  updateOpportunity(id: number, data: Partial<InsertOpportunity>): void {
    db.update(opportunities).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(opportunities.id, id)).run();
  }

  getResearchReports(opportunityId: number): ResearchReport[] {
    return db.select().from(researchReports).where(eq(researchReports.opportunityId, opportunityId)).orderBy(desc(researchReports.createdAt)).all();
  }

  createResearchReport(data: InsertResearchReport): ResearchReport {
    return db.insert(researchReports).values(data).returning().get();
  }

  getProbabilityEstimates(opportunityId: number): ProbabilityEstimate[] {
    return db.select().from(probabilityEstimates).where(eq(probabilityEstimates.opportunityId, opportunityId)).orderBy(desc(probabilityEstimates.createdAt)).all();
  }

  getLatestEstimate(opportunityId: number): ProbabilityEstimate | undefined {
    return db.select().from(probabilityEstimates).where(eq(probabilityEstimates.opportunityId, opportunityId)).orderBy(desc(probabilityEstimates.createdAt)).limit(1).get();
  }

  createProbabilityEstimate(data: InsertProbabilityEstimate): ProbabilityEstimate {
    return db.insert(probabilityEstimates).values(data).returning().get();
  }

  getRiskAssessment(opportunityId: number): RiskAssessment | undefined {
    return db.select().from(riskAssessments).where(eq(riskAssessments.opportunityId, opportunityId)).orderBy(desc(riskAssessments.createdAt)).limit(1).get();
  }

  createRiskAssessment(data: InsertRiskAssessment): RiskAssessment {
    return db.insert(riskAssessments).values(data).returning().get();
  }

  updateRiskAssessment(id: number, data: Partial<InsertRiskAssessment>): void {
    db.update(riskAssessments).set(data).where(eq(riskAssessments.id, id)).run();
  }

  getExecutions(filters?: { status?: string; opportunityId?: number }): Execution[] {
    let query = db.select().from(executions).orderBy(desc(executions.submittedAt));
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(executions.status, filters.status));
    if (filters?.opportunityId) conditions.push(eq(executions.opportunityId, filters.opportunityId));
    if (conditions.length > 0) query = query.where(and(...conditions)) as any;
    return query.all();
  }

  getExecution(id: number): Execution | undefined {
    return db.select().from(executions).where(eq(executions.id, id)).get();
  }

  createExecution(data: InsertExecution): Execution {
    return db.insert(executions).values(data).returning().get();
  }

  updateExecution(id: number, data: Partial<InsertExecution>): void {
    db.update(executions).set(data).where(eq(executions.id, id)).run();
  }

  getActivePositions(status?: string): ActivePosition[] {
    if (status) {
      return db.select().from(activePositions).where(eq(activePositions.status, status)).orderBy(desc(activePositions.openedAt)).all();
    }
    return db.select().from(activePositions).orderBy(desc(activePositions.openedAt)).all();
  }

  getActivePosition(id: number): ActivePosition | undefined {
    return db.select().from(activePositions).where(eq(activePositions.id, id)).get();
  }

  createActivePosition(data: InsertActivePosition): ActivePosition {
    return db.insert(activePositions).values(data).returning().get();
  }

  updateActivePosition(id: number, data: Partial<InsertActivePosition>): void {
    db.update(activePositions).set(data).where(eq(activePositions.id, id)).run();
  }

  getSettlements(filters?: { status?: string }): Settlement[] {
    if (filters?.status) {
      return db.select().from(settlements).where(eq(settlements.status, filters.status)).orderBy(desc(settlements.createdAt)).all();
    }
    return db.select().from(settlements).orderBy(desc(settlements.createdAt)).all();
  }

  getSettlement(opportunityId: number): Settlement | undefined {
    return db.select().from(settlements).where(eq(settlements.opportunityId, opportunityId)).orderBy(desc(settlements.createdAt)).limit(1).get();
  }

  createSettlement(data: InsertSettlement): Settlement {
    return db.insert(settlements).values(data).returning().get();
  }

  updateSettlement(id: number, data: Partial<InsertSettlement>): void {
    db.update(settlements).set(data).where(eq(settlements.id, id)).run();
  }

  getPostMortems(limit = 50): PostMortem[] {
    return db.select().from(postMortems).orderBy(desc(postMortems.createdAt)).limit(limit).all();
  }

  createPostMortem(data: InsertPostMortem): PostMortem {
    return db.insert(postMortems).values(data).returning().get();
  }

  getMemory(category: string, key?: string): MemoryEntry[] {
    if (key) {
      return db.select().from(memoryStore).where(and(eq(memoryStore.category, category), eq(memoryStore.key, key))).all();
    }
    return db.select().from(memoryStore).where(eq(memoryStore.category, category)).all();
  }

  upsertMemory(data: InsertMemoryEntry): MemoryEntry {
    const existing = db.select().from(memoryStore).where(and(eq(memoryStore.category, data.category), eq(memoryStore.key, data.key))).get();
    if (existing) {
      db.update(memoryStore).set({
        value: data.value,
        confidence: data.confidence,
        usageCount: (existing.usageCount || 0) + 1,
        lastUsedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(memoryStore.id, existing.id)).run();
      return db.select().from(memoryStore).where(eq(memoryStore.id, existing.id)).get()!;
    }
    return db.insert(memoryStore).values(data).returning().get();
  }

  getAuditLog(limit = 100, entityType?: string): AuditLogEntry[] {
    if (entityType) {
      return db.select().from(auditLog).where(eq(auditLog.entityType, entityType)).orderBy(desc(auditLog.timestamp)).limit(limit).all();
    }
    return db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).limit(limit).all();
  }

  createAuditEntry(data: InsertAuditLogEntry): AuditLogEntry {
    return db.insert(auditLog).values(data).returning().get();
  }

  getConfig(key: string): string | undefined {
    const row = db.select().from(platformConfig).where(eq(platformConfig.key, key)).get();
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    const existing = db.select().from(platformConfig).where(eq(platformConfig.key, key)).get();
    if (existing) {
      db.update(platformConfig).set({ value }).where(eq(platformConfig.key, key)).run();
    } else {
      db.insert(platformConfig).values({ key, value }).run();
    }
  }

  getPerformanceSnapshots(limit = 100): PerformanceSnapshot[] {
    return db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.timestamp)).limit(limit).all();
  }

  createPerformanceSnapshot(data: InsertPerformanceSnapshot): PerformanceSnapshot {
    return db.insert(performanceSnapshots).values(data).returning().get();
  }

  getDashboardStats() {
    const allOps = db.select().from(opportunities).all();
    const openPos = db.select().from(activePositions).where(eq(activePositions.status, "open")).all();
    const allSettlements = db.select().from(settlements).where(eq(settlements.status, "settled")).all();
    const pendingRisks = db.select().from(riskAssessments).where(eq(riskAssessments.approved, 0)).all();

    const totalPnl = allSettlements.reduce((s, t) => s + (t.realizedPnl || 0), 0) + openPos.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const wins = allSettlements.filter(s => s.wasCorrect === 1).length;
    const totalSettled = allSettlements.length;
    const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;
    const avgEdge = allOps.filter(o => o.edge != null).reduce((s, o) => s + Math.abs(o.edge || 0), 0) / Math.max(1, allOps.filter(o => o.edge != null).length);

    return {
      totalOpportunities: allOps.length,
      activePositions: openPos.length,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      portfolioValue: openPos.reduce((s, p) => s + p.size, 0) + totalPnl,
      avgEdge: Math.round(avgEdge * 1000) / 1000,
      totalTrades: allSettlements.length + openPos.length,
      pendingApprovals: pendingRisks.length,
    };
  }
}

export const storage = new SqliteStorage();
