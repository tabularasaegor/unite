/**
 * Settlement Monitor + Post-Mortem Learning — Pipeline Stages 7-8
 * - Monitors open positions for settlement/resolution
 * - Generates post-mortem analysis on settled trades
 * - Updates memory store with learned patterns
 * - Records performance snapshots
 */

import { log } from "../index";
import { storage } from "../storage";
import type { InsertPostMortem } from "@shared/schema";

// --- Settlement Check ---

export function checkSettlements(): { checked: number; settled: number } {
  const monitoringSettlements = storage.getSettlements({ status: "monitoring" });
  let settled = 0;

  for (const s of monitoringSettlements) {
    const opp = storage.getOpportunity(s.opportunityId);
    if (!opp) continue;

    // Check if market has resolved (price very close to 0 or 1)
    if (opp.currentPrice !== null && opp.currentPrice !== undefined) {
      if (opp.currentPrice > 0.95 || opp.currentPrice < 0.05) {
        const outcome = opp.currentPrice > 0.5 ? "YES" : "NO";
        const position = s.positionId ? storage.getActivePosition(s.positionId) : null;
        const wasCorrect = position ? (
          (position.side === "YES" && outcome === "YES") ||
          (position.side === "NO" && outcome === "NO")
        ) : null;

        const entryPrice = position?.entryPrice || s.marketPriceAtEntry || 0.5;
        const finalPrice = opp.currentPrice;
        const realizedPnl = position ? (
          position.side === "YES"
            ? (finalPrice - entryPrice) * position.size
            : (entryPrice - finalPrice) * position.size
        ) : 0;

        storage.updateSettlement(s.id, {
          outcome,
          finalPrice,
          realizedPnl: Math.round(realizedPnl * 100) / 100,
          realizedPnlPercent: entryPrice > 0 ? Math.round((realizedPnl / (position?.size || 1)) * 10000) / 100 : 0,
          wasCorrect: wasCorrect ? 1 : 0,
          status: "settled",
          resolvedAt: new Date().toISOString(),
        });

        // Close position if still open
        if (position && position.status === "open") {
          storage.updateActivePosition(position.id, {
            status: "closed",
            closedAt: new Date().toISOString(),
            unrealizedPnl: realizedPnl,
          });
        }

        // Update opportunity
        storage.updateOpportunity(s.opportunityId, {
          status: "settled",
          pipelineStage: "settlement",
        });

        settled++;

        // Audit
        storage.createAuditEntry({
          action: "settle",
          entityType: "settlement",
          entityId: s.id,
          actor: "agent:settlement_monitor",
          details: JSON.stringify({ outcome, wasCorrect, realizedPnl }),
          timestamp: new Date().toISOString(),
        });

        log(`Settlement: "${opp.title}" → ${outcome}, PnL: $${realizedPnl.toFixed(2)}, Correct: ${wasCorrect}`, "settlement");
      }
    }
  }

  return { checked: monitoringSettlements.length, settled };
}

// --- Post-Mortem Generation ---

export async function generatePostMortem(opportunityId: number): Promise<InsertPostMortem | null> {
  const opp = storage.getOpportunity(opportunityId);
  if (!opp) return null;

  const settlement = storage.getSettlement(opportunityId);
  if (!settlement || settlement.status !== "settled") return null;

  const research = storage.getResearchReports(opportunityId);
  const estimates = storage.getProbabilityEstimates(opportunityId);
  const latestEstimate = estimates[0];

  log(`Generating post-mortem for "${opp.title}"`, "postmortem");

  // Calculate metrics
  const predictionAccuracy = latestEstimate
    ? Math.abs((settlement.outcome === "YES" ? 1 : 0) - latestEstimate.ensembleProbability)
    : null;

  const calibrationError = latestEstimate
    ? Math.abs(latestEstimate.ensembleProbability - (settlement.outcome === "YES" ? 1 : 0))
    : null;

  const edgeRealized = settlement.realizedPnl
    ? settlement.realizedPnl / (settlement.marketPriceAtEntry || 1)
    : null;

  // Per-model performance
  const modelPerf: Record<string, any> = {};
  if (latestEstimate) {
    const actual = settlement.outcome === "YES" ? 1 : 0;
    if (latestEstimate.gptProbability !== null) {
      modelPerf.gpt = {
        predicted: latestEstimate.gptProbability,
        error: Math.abs(latestEstimate.gptProbability - actual),
        correct: (latestEstimate.gptProbability > 0.5) === (actual === 1),
      };
    }
    if (latestEstimate.claudeProbability !== null) {
      modelPerf.claude = {
        predicted: latestEstimate.claudeProbability,
        error: Math.abs(latestEstimate.claudeProbability - actual),
        correct: (latestEstimate.claudeProbability > 0.5) === (actual === 1),
      };
    }
    if (latestEstimate.geminiProbability !== null) {
      modelPerf.gemini = {
        predicted: latestEstimate.geminiProbability,
        error: Math.abs(latestEstimate.geminiProbability - actual),
        correct: (latestEstimate.geminiProbability > 0.5) === (actual === 1),
      };
    }
  }

  // Generate AI analysis
  let aiAnalysis = "";
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const prompt = `Analyze this prediction market trade post-mortem:

MARKET: ${opp.title}
OUR PREDICTION: ${((opp.aiProbability || 0) * 100).toFixed(1)}% probability
MARKET PRICE AT ENTRY: ${((settlement.marketPriceAtEntry || 0) * 100).toFixed(1)}%
ACTUAL OUTCOME: ${settlement.outcome}
P&L: $${settlement.realizedPnl?.toFixed(2)}
WAS CORRECT: ${settlement.wasCorrect ? "Yes" : "No"}

Research agents found: ${research.map(r => r.summary).join(" | ")}

Provide a brief post-mortem: what went right, what went wrong, key lessons.
Respond in JSON: {"what_worked": ["..."], "what_failed": ["..."], "lessons": "...", "recommendations": ["..."]}`;

    const response = await client.responses.create({ model: "gpt-5", input: prompt });
    aiAnalysis = response.output_text || "";
  } catch (err) {
    aiAnalysis = `AI analysis unavailable: ${err}`;
  }

  // Parse AI analysis
  let whatWorked: string[] = [];
  let whatFailed: string[] = [];
  let lessons = "";
  let recommendations: string[] = [];

  try {
    const jsonMatch = aiAnalysis.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      whatWorked = parsed.what_worked || [];
      whatFailed = parsed.what_failed || [];
      lessons = parsed.lessons || "";
      recommendations = parsed.recommendations || [];
    }
  } catch {}

  const postMortem: InsertPostMortem = {
    opportunityId,
    settlementId: settlement.id,
    predictionAccuracy,
    calibrationError,
    edgeRealized,
    whatWorked: JSON.stringify(whatWorked),
    whatFailed: JSON.stringify(whatFailed),
    lessonsLearned: lessons,
    modelPerformance: JSON.stringify(modelPerf),
    recommendations: JSON.stringify(recommendations),
    aiAnalysis,
    createdAt: new Date().toISOString(),
  };

  const saved = storage.createPostMortem(postMortem);

  // Update opportunity
  storage.updateOpportunity(opportunityId, { pipelineStage: "postmortem" });

  // Store lessons in memory
  if (lessons) {
    storage.upsertMemory({
      category: "lesson",
      key: `${opp.category}-${settlement.outcome}`,
      value: JSON.stringify({ market: opp.title, lesson: lessons, pnl: settlement.realizedPnl }),
      confidence: predictionAccuracy ? 1 - predictionAccuracy : 0.5,
      createdAt: new Date().toISOString(),
    });
  }

  // Update model performance memory
  for (const [model, perf] of Object.entries(modelPerf)) {
    const existing = storage.getMemory("model_perf", model);
    const stats = existing.length > 0 ? JSON.parse(existing[0].value) : { total: 0, correct: 0, totalError: 0 };
    stats.total++;
    if (perf.correct) stats.correct++;
    stats.totalError += perf.error;
    stats.accuracy = stats.correct / stats.total;
    stats.avgError = stats.totalError / stats.total;

    storage.upsertMemory({
      category: "model_perf",
      key: model,
      value: JSON.stringify(stats),
      confidence: stats.accuracy,
      createdAt: new Date().toISOString(),
    });
  }

  // Audit
  storage.createAuditEntry({
    action: "postmortem",
    entityType: "opportunity",
    entityId: opportunityId,
    actor: "agent:postmortem",
    details: JSON.stringify({ predictionAccuracy, wasCorrect: settlement.wasCorrect, pnl: settlement.realizedPnl }),
    timestamp: new Date().toISOString(),
  });

  log(`Post-mortem generated for "${opp.title}": accuracy=${predictionAccuracy?.toFixed(3)}, lessons stored`, "postmortem");

  return saved;
}

// --- Performance Snapshot ---

export function recordPerformanceSnapshot(): void {
  const stats = storage.getDashboardStats();
  storage.createPerformanceSnapshot({
    totalPnl: stats.totalPnl,
    portfolioValue: stats.portfolioValue,
    winRate: stats.winRate,
    totalTrades: stats.totalTrades,
    openPositions: stats.activePositions,
    timestamp: new Date().toISOString(),
  });
}
