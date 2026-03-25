/**
 * Research Agent Swarm — Pipeline Stage 2
 * Multiple specialized AI agents research each opportunity:
 * - News Agent: finds latest relevant news
 * - Data Agent: analyzes historical data and base rates
 * - Expert Agent: provides domain expert perspective
 * - Contrarian Agent: challenges consensus view
 * Each agent uses LLM to synthesize research into structured findings.
 */

import { log } from "../index";
import { storage } from "../storage";
import type { InsertResearchReport } from "@shared/schema";

// --- Agent Types ---

type AgentType = "news" | "data" | "expert" | "contrarian";

interface AgentConfig {
  type: AgentType;
  model: string;
  systemPrompt: string;
}

const AGENTS: AgentConfig[] = [
  {
    type: "news",
    model: "gpt-5",
    systemPrompt: `You are a news analysis agent for prediction markets. Given a market question, synthesize the latest relevant news and events that could affect the outcome. Focus on:
- Recent developments (last 7 days)
- Key stakeholders and their positions
- Timeline of relevant events
- Any breaking news that shifts probabilities

Respond in JSON: {"summary": "...", "findings": ["finding1", "finding2", ...], "sentiment": "bullish|bearish|neutral", "confidence": 0.0-1.0}`,
  },
  {
    type: "data",
    model: "gpt-5",
    systemPrompt: `You are a data analysis agent for prediction markets. Given a market question, analyze historical base rates, statistical patterns, and quantitative evidence. Focus on:
- Historical base rates for similar events
- Statistical trends and patterns
- Quantitative indicators
- Data-driven probability estimation

Respond in JSON: {"summary": "...", "findings": ["finding1", "finding2", ...], "sentiment": "bullish|bearish|neutral", "confidence": 0.0-1.0}`,
  },
  {
    type: "expert",
    model: "claude-haiku-4-5-20250514",
    systemPrompt: `You are a domain expert agent for prediction markets. Given a market question, provide deep domain expertise and analysis. Focus on:
- Domain-specific knowledge and context
- Expert consensus and dissenting views
- Structural factors and mechanisms
- Insider perspective and institutional knowledge

Respond in JSON: {"summary": "...", "findings": ["finding1", "finding2", ...], "sentiment": "bullish|bearish|neutral", "confidence": 0.0-1.0}`,
  },
  {
    type: "contrarian",
    model: "gpt-5",
    systemPrompt: `You are a contrarian analysis agent for prediction markets. Your job is to challenge the consensus view and identify hidden risks or opportunities. Focus on:
- What could the market be getting wrong?
- Hidden risks the crowd is ignoring
- Black swan scenarios
- Information asymmetries and cognitive biases

Respond in JSON: {"summary": "...", "findings": ["finding1", "finding2", ...], "sentiment": "bullish|bearish|neutral", "confidence": 0.0-1.0}`,
  },
];

// --- Run a single agent ---

async function runAgent(agent: AgentConfig, marketTitle: string, description: string, currentPrice: number, pastLessonsContext = ""): Promise<InsertResearchReport & { success: boolean }> {
  const start = Date.now();

  const prompt = `Analyze this prediction market:
QUESTION: ${marketTitle}
DETAILS: ${description || "No additional details"}
CURRENT MARKET PRICE (implied probability): ${(currentPrice * 100).toFixed(1)}%
${pastLessonsContext}
Provide your analysis.`;

  try {
    let text = "";

    if (agent.model.startsWith("claude")) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();
      const message = await client.messages.create({
        model: agent.model,
        max_tokens: 1024,
        system: agent.systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
      text = message.content[0]?.type === "text" ? message.content[0].text : "";
    } else {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI();
      const response = await client.responses.create({
        model: agent.model,
        instructions: agent.systemPrompt,
        input: prompt,
      });
      text = response.output_text || "";
    }

    // Parse response
    const parsed = parseAgentResponse(text);
    const latencyMs = Date.now() - start;

    return {
      success: true,
      opportunityId: 0, // set by caller
      agentType: agent.type,
      summary: parsed.summary,
      findings: JSON.stringify(parsed.findings),
      sources: JSON.stringify([]),
      sentiment: parsed.sentiment,
      confidenceScore: parsed.confidence,
      latencyMs,
      tokensUsed: text.length / 4, // rough estimate
      modelUsed: agent.model,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    log(`Agent ${agent.type} error: ${err}`, "research");
    return {
      success: false,
      opportunityId: 0,
      agentType: agent.type,
      summary: `Agent error: ${err}`,
      findings: JSON.stringify([]),
      sentiment: "neutral",
      confidenceScore: 0,
      latencyMs: Date.now() - start,
      modelUsed: agent.model,
      createdAt: new Date().toISOString(),
    };
  }
}

function parseAgentResponse(text: string): { summary: string; findings: string[]; sentiment: string; confidence: number } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || "No summary",
        findings: Array.isArray(parsed.findings) ? parsed.findings : [parsed.findings || "No findings"],
        sentiment: ["bullish", "bearish", "neutral"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
        confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
      };
    }
  } catch {}

  return { summary: text.slice(0, 500), findings: [text.slice(0, 300)], sentiment: "neutral", confidence: 0.3 };
}

// --- Main Research Function ---

export async function researchOpportunity(opportunityId: number): Promise<{ reports: number; avgConfidence: number }> {
  const opp = storage.getOpportunity(opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);

  log(`Starting research swarm for "${opp.title}"`, "research");

  // Fetch lessons from past trades to inform research
  const lessons = storage.getMemory("lesson");
  let pastLessonsContext = "";
  if (lessons.length > 0) {
    pastLessonsContext = "\n\nLESSONS FROM PAST TRADES (use these to avoid repeating mistakes):\n" +
      lessons.slice(0, 10).map(l => {
        try {
          const val = JSON.parse(l.value);
          return `- ${val.market}: ${val.lesson} (PnL: $${val.pnl})`;
        } catch { return ""; }
      }).filter(Boolean).join("\n");
  }

  // Update pipeline stage
  storage.updateOpportunity(opportunityId, { pipelineStage: "research", status: "researching" });

  // Run all agents in parallel
  const results = await Promise.all(
    AGENTS.map(agent => runAgent(agent, opp.title, opp.description || "", opp.currentPrice || 0.5, pastLessonsContext))
  );

  // Save reports
  let successCount = 0;
  let totalConfidence = 0;

  for (const result of results) {
    if (result.success) {
      successCount++;
      totalConfidence += result.confidenceScore || 0;
    }
    const { success, ...reportData } = result;
    storage.createResearchReport({ ...reportData, opportunityId });
  }

  const avgConfidence = successCount > 0 ? totalConfidence / successCount : 0;

  // Audit log
  storage.createAuditEntry({
    action: "research",
    entityType: "opportunity",
    entityId: opportunityId,
    actor: "agent:research_swarm",
    details: JSON.stringify({ agents: AGENTS.length, successful: successCount, avgConfidence }),
    timestamp: new Date().toISOString(),
  });

  log(`Research complete for "${opp.title}": ${successCount}/${AGENTS.length} agents, avg confidence ${(avgConfidence * 100).toFixed(0)}%`, "research");

  return { reports: successCount, avgConfidence };
}

export async function researchBatch(opportunityIds: number[]): Promise<void> {
  for (const id of opportunityIds) {
    try {
      await researchOpportunity(id);
      await new Promise(r => setTimeout(r, 1000)); // Brief pause between research tasks
    } catch (err) {
      log(`Research failed for opportunity ${id}: ${err}`, "research");
    }
  }
}
