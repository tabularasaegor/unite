/**
 * Pipeline Engine — Long-horizon prediction market scanner and trader.
 *
 * Simpler than the micro engine: scans Polymarket for opportunities,
 * filters by config (days, sectors, volume), and manages position lifecycle.
 */

import { storage } from "../storage";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// ─── Types ───────────────────────────────────────────────────────

interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  active: boolean;
  closed: boolean;
  volume: number;
  volume24hr: number;
  competitive: number;
  endDate: string;
  startDate: string;
  markets: GammaMarket[];
  tags?: { slug: string; label: string }[];
}

interface GammaMarket {
  id: string;
  conditionId: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  orderPriceMinTickSize: number;
  negRisk: boolean;
  volume: number;
  volume24hr: number;
}

// ─── Config Helpers ──────────────────────────────────────────────

async function getConfigInt(key: string, def: number): Promise<number> {
  const val = await storage.getConfig(key);
  return val ? parseInt(val, 10) : def;
}

async function getConfigStr(key: string, def: string): Promise<string> {
  const val = await storage.getConfig(key);
  return val || def;
}

// ─── Category Detection ──────────────────────────────────────────

function detectCategory(event: GammaEvent): string {
  const title = (event.title || "").toLowerCase();
  const tagSlugs = (event.tags || []).map(t => t.slug?.toLowerCase() || "");

  if (tagSlugs.some(t => t.includes("sport")) || /nba|nfl|mlb|nhl|soccer|football|match|game|win/i.test(title)) {
    return "sports";
  }
  if (tagSlugs.some(t => t.includes("crypto") || t.includes("bitcoin") || t.includes("ethereum")) ||
    /bitcoin|btc|eth|crypto|token|blockchain|defi/i.test(title)) {
    return "crypto";
  }
  if (tagSlugs.some(t => t.includes("politic")) || /president|election|trump|biden|congress|senate|vote/i.test(title)) {
    return "politics";
  }
  if (tagSlugs.some(t => t.includes("tech")) || /ai |apple|google|meta|openai|spacex|tesla/i.test(title)) {
    return "tech";
  }
  return "other";
}

// ─── Market Scanner ──────────────────────────────────────────────

/**
 * Scan Polymarket for active, non-restricted markets matching filters.
 * Fetches from Gamma API with pagination.
 */
export async function scanMarkets(): Promise<{
  scanned: number;
  added: number;
  skipped: number;
  errors: string[];
}> {
  const maxPerRun = await getConfigInt("pipeline_max_per_run", 30);
  const minDays = await getConfigInt("pipeline_min_days", 0);
  const maxDays = await getConfigInt("pipeline_max_days", 30);
  const sectors = (await getConfigStr("pipeline_sectors", "sports,crypto,politics,tech,other"))
    .split(",")
    .map(s => s.trim().toLowerCase());

  const now = new Date();
  const minEnd = new Date(now.getTime() + minDays * 86400000);
  const maxEnd = new Date(now.getTime() + maxDays * 86400000);

  const result = { scanned: 0, added: 0, skipped: 0, errors: [] as string[] };

  try {
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore && result.scanned < maxPerRun * 3) {
      const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;

      const resp = await fetch(url);
      if (!resp.ok) {
        result.errors.push(`Gamma API error: ${resp.status}`);
        break;
      }

      const events: GammaEvent[] = await resp.json() as GammaEvent[];
      if (events.length === 0) {
        hasMore = false;
        break;
      }

      for (const event of events) {
        result.scanned++;

        // Check date range
        if (event.endDate) {
          const endDate = new Date(event.endDate);
          if (endDate < minEnd || endDate > maxEnd) {
            result.skipped++;
            continue;
          }
        }

        // Check sector
        const category = detectCategory(event);
        if (!sectors.includes(category)) {
          result.skipped++;
          continue;
        }

        // Check if already tracked
        const existing = (await storage.getOpportunities())
          .find(o => o.externalId === event.id);
        if (existing) {
          result.skipped++;
          continue;
        }

        // Check volume threshold (at least $1000 24h)
        const vol24 = event.volume24hr || 0;
        if (vol24 < 1000) {
          result.skipped++;
          continue;
        }

        if (result.added >= maxPerRun) {
          hasMore = false;
          break;
        }

        // Extract market data
        const market = event.markets?.[0];
        if (!market) {
          result.skipped++;
          continue;
        }

        let prices: number[] = [];
        try {
          prices = JSON.parse(market.outcomePrices || "[]");
        } catch { /* */ }

        await storage.createOpportunity({
          externalId: event.id,
          platform: "polymarket",
          title: event.title,
          category,
          currentPrice: prices[0] || null,
          volume24h: vol24,
          status: "active",
          pipelineStage: "scanned",
          conditionId: market.conditionId || null,
          clobTokenIds: market.clobTokenIds || null,
          tickSize: market.orderPriceMinTickSize || null,
          negRisk: market.negRisk || false,
          endDate: event.endDate || null,
          slug: event.slug || null,
        });

        result.added++;
      }

      offset += limit;
    }
  } catch (err) {
    result.errors.push(`Scan error: ${String(err)}`);
  }

  await storage.addAuditEntry("сканирование",
    `Просканировано ${result.scanned}, добавлено ${result.added}, пропущено ${result.skipped}`);
  await storage.addModelLog("PIPELINE_SCAN", undefined,
    JSON.stringify(result));

  return result;
}


// ─── Research ────────────────────────────────────────────────────

/**
 * Run research on an opportunity: fetch fresh market data, compute basic metrics,
 * generate a research report and probability estimate, then advance to risk assessment.
 */
export async function runResearch(opportunityId: number): Promise<{ success: boolean; message: string }> {
  const opp = await storage.getOpportunity(opportunityId);
  if (!opp) {
    return { success: false, message: "Возможность не найдена" };
  }

  await storage.updateOpportunity(opportunityId, { pipelineStage: "researching" });

  try {
    // 1. Fetch fresh market data from Gamma
    let freshPrice: number | null = opp.currentPrice;
    let freshVolume = opp.volume24h || 0;
    let outcomes: string[] = [];
    let prices: number[] = [];
    if (opp.externalId) {
      try {
        const resp = await fetch(`${GAMMA_BASE}/events/${opp.externalId}`);
        if (resp.ok) {
          const ev = await resp.json() as GammaEvent;
          freshVolume = ev.volume24hr || freshVolume;
          if (ev.markets?.[0]) {
            try { outcomes = JSON.parse(ev.markets[0].outcomePrices || "[]"); } catch {}
            try { prices = JSON.parse(ev.markets[0].outcomePrices || "[]").map(Number); } catch {}
            freshPrice = prices[0] ?? freshPrice;
          }
        }
      } catch { /* use cached data */ }
    }

    // 2. Generate research report
    const impliedProb = freshPrice ?? 0.5;
    const spreadInfo = prices.length >= 2
      ? `Yes: ${(prices[0]*100).toFixed(1)}%, No: ${(prices[1]*100).toFixed(1)}%`
      : "N/A";

    const reportBody = [
      `## Исследование: ${opp.title}`,
      ``,
      `**Категория:** ${opp.category}`,
      `**Платформа:** ${opp.platform}`,
      `**Объём 24ч:** $${freshVolume.toLocaleString()}`,
      `**Текущая цена (implied prob):** ${(impliedProb * 100).toFixed(1)}%`,
      `**Расклад:** ${spreadInfo}`,
      `**Дата завершения:** ${opp.endDate || "N/A"}`,
      ``,
      `### Анализ`,
      impliedProb > 0.85
        ? `Рынок сильно склоняется к "Yes" (${(impliedProb*100).toFixed(0)}%). Ограниченный upside для Yes-позиции.`
        : impliedProb < 0.15
        ? `Рынок сильно склоняется к "No" (Yes всего ${(impliedProb*100).toFixed(0)}%). Ограниченный upside для No.`
        : `Рынок в зоне неопределённости (${(impliedProb*100).toFixed(0)}%). Потенциально интересно для торговли.`,
      ``,
      freshVolume < 5000
        ? `⚠️ Низкий объём ($${freshVolume}) — ликвидность может быть недостаточной.`
        : `✅ Достаточный объём ($${freshVolume.toLocaleString()}) для торговли.`,
    ].join("\n");

    // Save research report
    await storage.createResearchReport({
      opportunityId,
      content: reportBody,
      agentModel: "pipeline-analyzer",
    });

    // 3. Generate probability estimate
    const volumeAdjust = freshVolume > 50000 ? 0.02 : freshVolume > 10000 ? 0.01 : 0;
    const estimatedProb = Math.max(0.05, Math.min(0.95,
      impliedProb + (impliedProb > 0.5 ? volumeAdjust : -volumeAdjust)));

    await storage.createProbabilityEstimate({
      opportunityId,
      yesProb: estimatedProb,
      noProb: 1 - estimatedProb,
      method: "market-implied + volume-adjustment",
    });

    // 4. Advance stage
    await storage.updateOpportunity(opportunityId, {
      pipelineStage: "estimated",
      currentPrice: freshPrice,
      volume24h: freshVolume,
    });

    // 5. Automatic risk assessment
    await runRiskAssessment(opportunityId, estimatedProb, freshPrice ?? 0.5, freshVolume);

    await storage.addAuditEntry("исследование",
      `Исследование + оценка рисков завершены для #${opportunityId}: ${opp.title}`);

    return { success: true, message: `Исследование завершено, оценка вероятности: ${(estimatedProb * 100).toFixed(1)}%` };
  } catch (err) {
    console.error(`[Pipeline] Research error for #${opportunityId}:`, err);
    await storage.updateOpportunity(opportunityId, { pipelineStage: "scanned" });
    return { success: false, message: `Ошибка исследования: ${String(err)}` };
  }
}

// ─── Risk Assessment ────────────────────────────────────────────

async function runRiskAssessment(
  opportunityId: number,
  estimatedProb: number,
  marketPrice: number,
  volume24h: number
) {
  // Kelly Criterion: f* = (bp - q) / b
  const edge = estimatedProb - marketPrice;
  const b = marketPrice > 0 && marketPrice < 1 ? (1 / marketPrice - 1) : 1;
  const kellyFraction = edge > 0 ? (b * estimatedProb - (1 - estimatedProb)) / b : 0;
  const halfKelly = Math.max(0, kellyFraction * 0.5);

  // Risk level
  let riskLevel: string;
  if (Math.abs(edge) < 0.03) riskLevel = "low";
  else if (Math.abs(edge) < 0.10) riskLevel = "medium";
  else riskLevel = "high";

  const liquidityRisk = volume24h < 5000 ? "high" : volume24h < 20000 ? "medium" : "low";

  await storage.createRiskAssessment({
    opportunityId,
    riskLevel,
    kellyFraction: Math.round(halfKelly * 10000) / 10000,
    edge: Math.round(edge * 10000) / 10000,
    notes: `Edge: ${(edge * 100).toFixed(2)}%, Half-Kelly: ${(halfKelly * 100).toFixed(2)}%, Ликвидность: ${liquidityRisk}, Объём: $${volume24h.toLocaleString()}`,
  });

  await storage.updateOpportunity(opportunityId, { pipelineStage: "risk_assessed" });
}

// ─── Batch Process Pipeline ─────────────────────────────────────

/**
 * Process all scanned opportunities through research + risk assessment.
 */
export async function processPipeline(): Promise<{
  processed: number;
  errors: number;
}> {
  const allOpps = await storage.getOpportunities();
  const scanned = allOpps.filter(o => o.pipelineStage === "scanned");

  let processed = 0;
  let errors = 0;

  for (const opp of scanned) {
    try {
      const result = await runResearch(opp.id);
      if (result.success) {
        processed++;
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`[Pipeline] Error processing #${opp.id}:`, err);
      errors++;
    }
  }

  await storage.addModelLog("PIPELINE_PROCESS", undefined,
    JSON.stringify({ processed, errors, total: scanned.length }));

  return { processed, errors };
}

// ─── Pipeline Dashboard Stats ────────────────────────────────────

export async function getPipelineDashboard() {
  const allOpps = await storage.getOpportunities();
  const positions = await storage.getPositions({ source: "pipeline" });
  const openPositions = positions.filter(p => p.status === "open");
  const closedPositions = positions.filter(p => p.status === "settled" || p.status === "closed");

  const totalPnl = closedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const wins = closedPositions.filter(p => (p.realizedPnl ?? 0) > 0).length;
  const winRate = closedPositions.length > 0 ? wins / closedPositions.length : 0;

  // Stage counts
  const stages: Record<string, number> = {};
  for (const opp of allOpps) {
    stages[opp.pipelineStage] = (stages[opp.pipelineStage] || 0) + 1;
  }

  return {
    totalOpportunities: allOpps.length,
    stageBreakdown: stages,
    openPositions: openPositions.length,
    closedPositions: closedPositions.length,
    totalPnl: Math.round(totalPnl * 100) / 100,
    winRate,
    wins,
    losses: closedPositions.length - wins,
  };
}
