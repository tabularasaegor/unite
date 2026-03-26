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

function getConfigInt(key: string, def: number): number {
  const val = storage.getConfig(key);
  return val ? parseInt(val, 10) : def;
}

function getConfigStr(key: string, def: string): string {
  return storage.getConfig(key) || def;
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
  const maxPerRun = getConfigInt("pipeline_max_per_run", 30);
  const minDays = getConfigInt("pipeline_min_days", 0);
  const maxDays = getConfigInt("pipeline_max_days", 30);
  const sectors = getConfigStr("pipeline_sectors", "sports,crypto,politics,tech,other")
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

        // Skip restricted (5-min) events
        if ((event as any).restricted) continue;

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
        const existing = storage.getOpportunities()
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

        storage.createOpportunity({
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

  storage.addAuditEntry("сканирование",
    `Просканировано ${result.scanned}, добавлено ${result.added}, пропущено ${result.skipped}`);
  storage.addModelLog("PIPELINE_SCAN", undefined,
    JSON.stringify(result));

  return result;
}

// ─── Research (placeholder) ──────────────────────────────────────

/**
 * Run AI research on an opportunity. Placeholder — updates pipeline stage.
 */
export async function runResearch(opportunityId: number): Promise<{ success: boolean; message: string }> {
  const opp = storage.getOpportunity(opportunityId);
  if (!opp) {
    return { success: false, message: "Opportunity not found" };
  }

  // Update stage
  storage.updateOpportunity(opportunityId, { pipelineStage: "researching" });

  // Placeholder: in production this would call AI agents
  storage.updateOpportunity(opportunityId, {
    pipelineStage: "researched",
  });

  storage.addAuditEntry("исследование",
    `Исследование завершено для #${opportunityId}: ${opp.title}`);

  return { success: true, message: "Research completed (placeholder)" };
}

// ─── Pipeline Dashboard Stats ────────────────────────────────────

export function getPipelineDashboard() {
  const allOpps = storage.getOpportunities();
  const positions = storage.getPositions({ source: "pipeline" });
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
