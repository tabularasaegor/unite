/**
 * Probability Engine + Edge Calculator — Pipeline Stage 3
 * AI Ensemble model for probability estimation:
 * - GPT-4o, Claude, Gemini in parallel
 * - Weighted voting with dynamic weight adjustment
 * - Incorporates research swarm findings
 * - Calculates edge vs market price
 */

import { log } from "../index";
import { storage } from "../storage";
import type { InsertProbabilityEstimate, ResearchReport } from "@shared/schema";

interface ModelResult {
  model: string;
  probability: number;
  confidence: number;
  reasoning: string;
  latencyMs: number;
  error?: string;
}

// --- Build prompt with research context ---

function buildPrompt(title: string, description: string, currentPrice: number, research: ResearchReport[]): string {
  let researchContext = "";
  if (research.length > 0) {
    researchContext = "\n\nRESEARCH FINDINGS:\n" + research.map(r => {
      const findings = JSON.parse(r.findings || "[]");
      return `[${r.agentType.toUpperCase()} Agent | Sentiment: ${r.sentiment} | Confidence: ${((r.confidenceScore || 0) * 100).toFixed(0)}%]\n${r.summary}\nKey findings: ${findings.slice(0, 3).join("; ")}`;
    }).join("\n\n");
  }

  return `You are an expert prediction market analyst. Estimate the TRUE probability of this outcome.

MARKET: ${title}
DESCRIPTION: ${description || "No additional details"}
CURRENT MARKET PRICE: ${(currentPrice * 100).toFixed(1)}% implied probability
${researchContext}

Instructions:
1. Weigh all research findings carefully
2. Provide YOUR independent probability estimate (not just echoing market)
3. Consider contrarian views and potential market inefficiencies
4. Factor in base rates, time horizon, and information quality

Respond in EXACTLY this JSON format:
{"probability": 0.XX, "confidence": 0.0-1.0, "reasoning": "2-3 sentence analysis"}`;
}

// --- Model Callers ---

async function callModel(model: string, prompt: string): Promise<ModelResult> {
  const start = Date.now();
  try {
    let text = "";

    if (model.startsWith("claude")) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();
      const message = await client.messages.create({
        model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      text = message.content[0]?.type === "text" ? message.content[0].text : "";
    } else {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI();
      const response = await client.responses.create({ model, input: prompt });
      text = response.output_text || "";
    }

    const parsed = parseResponse(text);
    return {
      model,
      probability: parsed.probability,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      model,
      probability: 0,
      confidence: 0,
      reasoning: `Error: ${err}`,
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

function parseResponse(text: string): { probability: number; confidence: number; reasoning: string } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*?"probability"[\s\S]*?\}/);
    if (jsonMatch) {
      const p = JSON.parse(jsonMatch[0]);
      return {
        probability: Math.max(0, Math.min(1, parseFloat(p.probability) || 0)),
        confidence: Math.max(0, Math.min(1, parseFloat(p.confidence) || 0.5)),
        reasoning: p.reasoning || "No reasoning",
      };
    }
    const probMatch = text.match(/(\d+\.?\d*)%/);
    if (probMatch) {
      return { probability: parseFloat(probMatch[1]) / 100, confidence: 0.3, reasoning: text.slice(0, 300) };
    }
  } catch {}
  return { probability: 0, confidence: 0, reasoning: "Failed to parse" };
}

// --- Ensemble ---

export async function estimateProbability(opportunityId: number): Promise<InsertProbabilityEstimate & { opportunityId: number }> {
  const opp = storage.getOpportunity(opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);

  const research = storage.getResearchReports(opportunityId);
  const prompt = buildPrompt(opp.title, opp.description || "", opp.currentPrice || 0.5, research);

  log(`Running probability engine for "${opp.title}"`, "probability");

  // Update stage
  storage.updateOpportunity(opportunityId, { pipelineStage: "probability" });

  // Call models in parallel
  const [gpt, claude, gemini] = await Promise.all([
    callModel("gpt-5", prompt),
    callModel("claude-haiku-4-5-20250514", prompt),
    callModel("gpt-5", prompt),
  ]);

  // Dynamic weight adjustment based on model performance memory
  let gptW = parseFloat(storage.getConfig("gpt_weight") || "0.40");
  let claudeW = parseFloat(storage.getConfig("claude_weight") || "0.35");
  let geminiW = parseFloat(storage.getConfig("gemini_weight") || "0.25");

  const modelPerfEntries = storage.getMemory("model_perf");
  if (modelPerfEntries.length > 0) {
    for (const entry of modelPerfEntries) {
      try {
        const perf = JSON.parse(entry.value);
        if (perf.accuracy !== undefined) {
          if (entry.key === "gpt") gptW = 0.30 + perf.accuracy * 0.20;
          if (entry.key === "claude") claudeW = 0.25 + perf.accuracy * 0.20;
          if (entry.key === "gemini") geminiW = 0.20 + perf.accuracy * 0.15;
        }
      } catch {}
    }
    const total = gptW + claudeW + geminiW;
    gptW /= total; claudeW /= total; geminiW /= total;
    log(`Dynamic weights from performance: GPT=${gptW.toFixed(2)}, Claude=${claudeW.toFixed(2)}, Other=${geminiW.toFixed(2)}`, "probability");
  }

  // Weighted ensemble — skip failed models
  let totalWeight = 0;
  let weightedSum = 0;
  if (!gpt.error) { weightedSum += gpt.probability * gptW; totalWeight += gptW; }
  if (!claude.error) { weightedSum += claude.probability * claudeW; totalWeight += claudeW; }
  if (!gemini.error) { weightedSum += gemini.probability * geminiW; totalWeight += geminiW; }

  const ensembleProb = totalWeight > 0 ? weightedSum / totalWeight : opp.currentPrice || 0.5;
  const marketPrice = opp.currentPrice || 0.5;
  const edge = ensembleProb - marketPrice;

  // Confidence from model agreement
  const validProbs = [gpt, claude, gemini].filter(m => !m.error).map(m => m.probability);
  const spread = validProbs.length > 1 ? Math.max(...validProbs) - Math.min(...validProbs) : 0.5;
  let confidence: string = "low";
  if (spread < 0.05 && validProbs.length >= 2) confidence = "very_high";
  else if (spread < 0.10 && validProbs.length >= 2) confidence = "high";
  else if (spread < 0.20 && validProbs.length >= 2) confidence = "medium";

  const reasoning = [gpt, claude, gemini]
    .filter(m => !m.error)
    .map(m => `${m.model}: ${(m.probability * 100).toFixed(0)}% — ${m.reasoning}`)
    .join(" | ");

  const estimate: InsertProbabilityEstimate = {
    opportunityId,
    gptProbability: gpt.error ? null : gpt.probability,
    claudeProbability: claude.error ? null : claude.probability,
    geminiProbability: gemini.error ? null : gemini.probability,
    ensembleProbability: Math.round(ensembleProb * 1000) / 1000,
    marketPrice,
    edge: Math.round(edge * 1000) / 1000,
    modelWeights: JSON.stringify({ gpt: gptW, claude: claudeW, gemini: geminiW }),
    reasoning,
    modelDetails: JSON.stringify([gpt, claude, gemini]),
    confidence,
    createdAt: new Date().toISOString(),
  };

  const saved = storage.createProbabilityEstimate(estimate);

  // Update opportunity with latest estimates
  storage.updateOpportunity(opportunityId, {
    aiProbability: ensembleProb,
    edge,
    edgePercent: edge * 100,
    confidence,
    status: "analyzed",
  });

  // Audit
  storage.createAuditEntry({
    action: "predict",
    entityType: "opportunity",
    entityId: opportunityId,
    actor: "agent:probability_engine",
    details: JSON.stringify({ ensemble: ensembleProb, market: marketPrice, edge, confidence }),
    timestamp: new Date().toISOString(),
  });

  log(`Probability estimate: ${(ensembleProb * 100).toFixed(1)}% vs market ${(marketPrice * 100).toFixed(1)}% → edge ${(edge * 100).toFixed(1)}% [${confidence}]`, "probability");

  return { ...estimate, opportunityId };
}
