/**
 * Risk Engine — Pipeline Stage 4
 * - Kelly Criterion position sizing (third-Kelly for safety)
 * - Portfolio VaR/CVaR analysis
 * - Concentration risk checks (max 30% per category)
 * - Drawdown limits (20% halt)
 * - Max position caps: 10% bankroll, $100 (configurable)
 * - Category lesson check from post-mortem memory
 * - Human-in-the-loop approval gating
 */

import { log } from "../index";
import { storage, db } from "../storage";
import { riskAssessments, type InsertRiskAssessment } from "@shared/schema";
import { eq } from "drizzle-orm";

// --- Kelly Criterion ---

function kellyFraction(aiProbability: number, marketPrice: number): number {
  // For a YES bet at price p with AI probability π:
  //   f* = (π - p) / (1 - p)
  // For a NO bet at price p (meaning we think probability is LOWER):
  //   f* = (p - π) / p
  // We always compute based on the side that has positive edge.

  const edge = aiProbability - marketPrice;

  if (edge > 0) {
    // YES bet: f* = (π - p) / (1 - p)
    return Math.max(0, (aiProbability - marketPrice) / (1 - marketPrice));
  } else if (edge < 0) {
    // NO bet: f* = (p - π) / p
    return Math.max(0, (marketPrice - aiProbability) / marketPrice);
  }

  return 0;
}

// --- VaR Calculation (simplified Monte Carlo) ---

function calculateVaR(positions: { size: number; probability: number }[], confidenceLevel = 0.95): number {
  const simulations = 1000;
  const outcomes: number[] = [];

  for (let i = 0; i < simulations; i++) {
    let portfolioPnl = 0;
    for (const pos of positions) {
      const won = Math.random() < pos.probability;
      portfolioPnl += won ? pos.size * 0.8 : -pos.size;
    }
    outcomes.push(portfolioPnl);
  }

  outcomes.sort((a, b) => a - b);
  const varIndex = Math.floor(outcomes.length * (1 - confidenceLevel));
  return Math.abs(outcomes[varIndex] || 0);
}

function calculateCVaR(positions: { size: number; probability: number }[], confidenceLevel = 0.95): number {
  const simulations = 1000;
  const outcomes: number[] = [];

  for (let i = 0; i < simulations; i++) {
    let portfolioPnl = 0;
    for (const pos of positions) {
      const won = Math.random() < pos.probability;
      portfolioPnl += won ? pos.size * 0.8 : -pos.size;
    }
    outcomes.push(portfolioPnl);
  }

  outcomes.sort((a, b) => a - b);
  const varIndex = Math.floor(outcomes.length * (1 - confidenceLevel));
  const tailLosses = outcomes.slice(0, varIndex);
  return tailLosses.length > 0 ? Math.abs(tailLosses.reduce((s, v) => s + v, 0) / tailLosses.length) : 0;
}

// --- Drawdown Check ---

function checkDrawdown(bankroll: number, maxDrawdownPct: number): { drawdown: number; drawdownPct: number; exceeded: boolean } {
  // Sum all realized losses from settled positions
  const settledPositions = storage.getSettlements({ status: "settled" });
  const totalRealizedPnl = settledPositions.reduce((s, t) => s + (t.realizedPnl || 0), 0);
  const drawdown = totalRealizedPnl < 0 ? Math.abs(totalRealizedPnl) : 0;
  const drawdownPct = drawdown / bankroll;

  return {
    drawdown: Math.round(drawdown * 100) / 100,
    drawdownPct: Math.round(drawdownPct * 10000) / 10000,
    exceeded: drawdownPct > maxDrawdownPct,
  };
}

// --- Concentration Check ---

function checkConcentration(bankroll: number): { maxCategoryPct: number; topCategory: string; isHigh: boolean } {
  const openPositions = storage.getActivePositions("open");
  const categoryExposure: Record<string, number> = {};

  for (const pos of openPositions) {
    const posOpp = storage.getOpportunity(pos.opportunityId);
    if (posOpp) {
      const cat = posOpp.category || "other";
      categoryExposure[cat] = (categoryExposure[cat] || 0) + pos.size;
    }
  }

  let topCategory = "none";
  let maxExposure = 0;
  for (const [cat, exposure] of Object.entries(categoryExposure)) {
    if (exposure > maxExposure) {
      maxExposure = exposure;
      topCategory = cat;
    }
  }

  const maxCategoryPct = bankroll > 0 ? maxExposure / bankroll : 0;

  return {
    maxCategoryPct: Math.round(maxCategoryPct * 10000) / 10000,
    topCategory,
    isHigh: maxCategoryPct > 0.3,
  };
}

// --- Main Risk Assessment ---

export async function assessRisk(opportunityId: number): Promise<InsertRiskAssessment & { id?: number }> {
  const opp = storage.getOpportunity(opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);

  const estimate = storage.getLatestEstimate(opportunityId);
  if (!estimate) throw new Error(`No probability estimate for opportunity ${opportunityId}`);

  log(`Assessing risk for "${opp.title}"`, "risk");

  // Check past lessons for this category
  const categoryLessons = storage.getMemory("lesson");
  let categoryLossCount = 0;
  let categoryTotalTrades = 0;
  for (const l of categoryLessons) {
    try {
      const val = JSON.parse(l.value);
      if (l.key.includes(opp.category || "")) {
        categoryTotalTrades++;
        if (val.pnl < 0) categoryLossCount++;
      }
    } catch {}
  }
  let categoryRiskPenalty = 0;
  if (categoryTotalTrades >= 3 && categoryLossCount / categoryTotalTrades > 0.6) {
    categoryRiskPenalty = 1;
    log(`Category "${opp.category}" has ${categoryLossCount}/${categoryTotalTrades} losses — risk penalty applied`, "risk");
  }

  storage.updateOpportunity(opportunityId, { pipelineStage: "risk" });

  // Config
  const bankroll = parseFloat(storage.getConfig("bankroll") || "5000");
  const maxPositionPct = parseFloat(storage.getConfig("max_position_pct") || "0.10");
  const maxDrawdownPct = parseFloat(storage.getConfig("max_drawdown") || "0.20");
  const maxTradeSize = parseFloat(storage.getConfig("max_trade_size") || "100");

  // Drawdown check — reject if exceeded
  const drawdownCheck = checkDrawdown(bankroll, maxDrawdownPct);
  if (drawdownCheck.exceeded) {
    log(`DRAWDOWN EXCEEDED: ${(drawdownCheck.drawdownPct * 100).toFixed(1)}% > ${(maxDrawdownPct * 100).toFixed(0)}% — rejecting`, "risk");

    const rejectedAssessment: InsertRiskAssessment = {
      opportunityId,
      kellyFraction: 0,
      halfKellySize: 0,
      maxPositionSize: 0,
      portfolioVaR: 0,
      portfolioCVaR: 0,
      correlationRisk: "high",
      concentrationRisk: "high",
      liquidityRisk: "high",
      timeDecayRisk: 1,
      overallRisk: "extreme",
      approved: -1,
      approvedBy: "system:drawdown_limit",
      notes: `Drawdown ${(drawdownCheck.drawdownPct * 100).toFixed(1)}% exceeds max ${(maxDrawdownPct * 100).toFixed(0)}%`,
      createdAt: new Date().toISOString(),
    };

    const saved = storage.createRiskAssessment(rejectedAssessment);
    storage.updateOpportunity(opportunityId, { status: "rejected" });
    return saved;
  }

  // Kelly sizing — use 1/3 Kelly for more conservative sizing
  const kelly = kellyFraction(estimate.ensembleProbability, estimate.marketPrice);
  const thirdKelly = kelly * 0.3;
  const kellySizeRaw = bankroll * thirdKelly;
  const maxSizePct = bankroll * maxPositionPct;
  const recommendedSize = Math.min(kellySizeRaw, maxSizePct, maxTradeSize);

  // Portfolio analysis
  const openPositions = storage.getActivePositions("open");
  const currentExposure = openPositions.reduce((s, p) => s + p.size, 0);
  const positionsForVaR = openPositions.map(p => ({
    size: p.size,
    probability: 0.5,
  }));
  positionsForVaR.push({ size: recommendedSize, probability: estimate.ensembleProbability });

  const portfolioVaR = calculateVaR(positionsForVaR);
  const portfolioCVaR = calculateCVaR(positionsForVaR);

  // Concentration risk
  const concentrationCheck = checkConcentration(bankroll);
  const concentrationRisk = concentrationCheck.isHigh ? "high" : concentrationCheck.maxCategoryPct > 0.15 ? "medium" : "low";

  // Correlation risk
  const samePlatformCount = openPositions.filter(p => p.platform === opp.platform).length;
  const correlationRisk = samePlatformCount > 5 ? "high" : samePlatformCount > 2 ? "medium" : "low";

  // Liquidity risk
  const liquidityRisk = (opp.volume24h || 0) < 1000 ? "high" : (opp.volume24h || 0) < 10000 ? "medium" : "low";

  // Time decay — use endDate field
  const endDateStr = opp.endDate || opp.expiresAt;
  const daysToExpiry = endDateStr
    ? Math.max(0, (new Date(endDateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 365;
  const timeDecayRisk = daysToExpiry < 7 ? 0.9 : daysToExpiry < 30 ? 0.5 : 0.1;

  // Overall risk scoring
  const riskScores = { low: 1, medium: 2, high: 3, extreme: 4 };
  const avgRiskScore = (
    (riskScores[concentrationRisk as keyof typeof riskScores] || 1) +
    (riskScores[correlationRisk as keyof typeof riskScores] || 1) +
    (riskScores[liquidityRisk as keyof typeof riskScores] || 1) +
    (timeDecayRisk > 0.7 ? 3 : timeDecayRisk > 0.3 ? 2 : 1)
  ) / 4;

  const adjustedRiskScore = avgRiskScore + categoryRiskPenalty;
  const overallRisk = adjustedRiskScore > 2.5 ? "high" : adjustedRiskScore > 1.5 ? "medium" : "low";

  // Auto-approve logic: size < threshold AND risk != extreme
  const autoApproveThreshold = parseFloat(storage.getConfig("auto_approve_threshold") || "100");
  const requireHumanApproval = storage.getConfig("require_human_approval") !== "false";
  const autoApprove = !requireHumanApproval || (recommendedSize <= autoApproveThreshold && overallRisk !== "high");

  const assessment: InsertRiskAssessment = {
    opportunityId,
    kellyFraction: Math.round(kelly * 10000) / 10000,
    halfKellySize: Math.round(kellySizeRaw * 100) / 100, // actually thirdKelly now
    maxPositionSize: Math.round(Math.min(maxSizePct, maxTradeSize) * 100) / 100,
    portfolioVaR: Math.round(portfolioVaR * 100) / 100,
    portfolioCVaR: Math.round(portfolioCVaR * 100) / 100,
    correlationRisk,
    concentrationRisk,
    liquidityRisk,
    timeDecayRisk: Math.round(timeDecayRisk * 100) / 100,
    overallRisk,
    approved: autoApprove ? 1 : 0,
    approvedBy: autoApprove ? "system" : null,
    createdAt: new Date().toISOString(),
  };

  const saved = storage.createRiskAssessment(assessment);

  // Update opportunity with sizing info
  const side = estimate.edge > 0 ? "YES" : "NO";
  storage.updateOpportunity(opportunityId, {
    kellyFraction: kelly,
    recommendedSize: Math.round(recommendedSize * 100) / 100,
    recommendedSide: side,
    status: autoApprove ? "approved" : "analyzed",
  });

  // Audit
  storage.createAuditEntry({
    action: "assess_risk",
    entityType: "opportunity",
    entityId: opportunityId,
    actor: "agent:risk_engine",
    details: JSON.stringify({
      kelly, thirdKelly, recommendedSize, overallRisk,
      autoApproved: autoApprove, portfolioVaR,
      drawdown: drawdownCheck.drawdownPct,
      concentration: concentrationCheck.maxCategoryPct,
      topCategory: concentrationCheck.topCategory,
    }),
    timestamp: new Date().toISOString(),
  });

  log(`Risk: Kelly=${(kelly * 100).toFixed(1)}%, thirdKelly=$${kellySizeRaw.toFixed(0)}, size=$${recommendedSize.toFixed(0)}, risk=${overallRisk}, approved=${autoApprove}`, "risk");

  return saved;
}

export function approveRiskAssessment(assessmentId: number): void {
  storage.updateRiskAssessment(assessmentId, { approved: 1, approvedBy: "human" });

  const assessment = db_getRiskAssessment(assessmentId);
  if (assessment) {
    storage.updateOpportunity(assessment.opportunityId, { status: "approved" });
    storage.createAuditEntry({
      action: "approve",
      entityType: "opportunity",
      entityId: assessment.opportunityId,
      actor: "human",
      details: JSON.stringify({ assessmentId }),
      timestamp: new Date().toISOString(),
    });
  }
}

export function rejectRiskAssessment(assessmentId: number, reason: string): void {
  storage.updateRiskAssessment(assessmentId, { approved: -1, notes: reason });

  const assessment = db_getRiskAssessment(assessmentId);
  if (assessment) {
    storage.updateOpportunity(assessment.opportunityId, { status: "rejected" });
    storage.createAuditEntry({
      action: "reject",
      entityType: "opportunity",
      entityId: assessment.opportunityId,
      actor: "human",
      details: JSON.stringify({ assessmentId, rejected: true, reason }),
      timestamp: new Date().toISOString(),
    });
  }
}

function db_getRiskAssessment(id: number) {
  return db.select().from(riskAssessments).where(eq(riskAssessments.id, id)).get();
}
