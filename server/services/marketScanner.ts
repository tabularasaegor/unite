/**
 * Market Scanner Agent — Pipeline Stage 1
 * Discovers prediction market opportunities from Polymarket via Gamma API.
 * Paginated scan (500+ markets), prioritizes short-term events.
 * Stores conditionId, clobTokenIds, tickSize, negRisk, endDate, slug.
 */

import { log } from "../index";
import { storage } from "../storage";
import type { InsertOpportunity } from "@shared/schema";
import { fetchMarkets as fetchGammaMarkets, fetchActiveEvents, type GammaMarket, type GammaEvent } from "./polymarket";

function classifyCategory(question: string, gammaCategory: string): string {
  const q = question.toLowerCase();

  // Explicit crypto matches FIRST (specific project/token names that can't be anything else)
  const explicitCrypto = ['bitcoin','btc','ethereum','solana','xrp','megaeth','edgex','metamask','usd.ai','starknet','zksync','eigenlayer','uniswap','opensea','usdc','usdt','tether','pump.fun','abstract launch','ink fdv','coinbase','binance'];
  if (explicitCrypto.some(w => q.includes(w))) return "crypto";

  // Sports — most specific, prevents false positives (e.g. "Kraken" NHL team)
  const sportsWords = ['nba ','nfl ','nhl ','mlb ','uefa','fifa','premier league','la liga','serie a','bundesliga','ligue 1','championship','playoffs','finals','world cup','relegat','qualify','tournament','grand prix','formula 1','f1 ','tennis','boxing','ufc ','mma ','goal scorer','super bowl','stanley cup','masters tournament','ncaa','ryder cup','grand slam'];
  if (sportsWords.some(w => q.includes(w))) return "sports";

  // Tech
  const techWords = ['ai ','artificial intelligence','gpt-','gpt ','openai','google ','apple ','microsoft','tesla ','spacex','turing test','robot','quantum comput','chip ','semiconductor','gta vi','gta 6'];
  if (techWords.some(w => q.includes(w))) return "tech";

  // Politics
  const politicsWords = ['president','election','congress','senate','governor','prime minister','parliament','democrat','republican','gop ','trump ','biden','legislation','supreme court','scotus','impeach','cabinet','ceasefire','nato ','invasion','sanctions'];
  if (politicsWords.some(w => q.includes(w))) return "politics";

  // Crypto — checked after sports/politics to avoid false positives
  const cryptoWords = ['bitcoin','btc','ethereum','eth ','crypto','defi','solana','airdrop','fdv','stablecoin','memecoin','doge','xrp','binance','coinbase','blockchain','satoshi','smart contract','megaeth','edgex','metamask','usd.ai','standx','starknet','zksync','eigenlayer','bitcoin etf','ethereum etf','bitcoin reserve','unban bitcoin','token launch','launch a token','market cap','usdc','usdt','tether','uniswap','layer 2','rollup','on-chain','onchain','web3','nft','halving','opensea','ink fdv','kraken ipo','150k','200k','100k','50k','crypto hack','bitcoin hit','btc hit','eth hit','ethereum hit','solana hit','xrp hit','bitcoin reach','ethereum reach','fdv above','market cap hit','market cap above','bitcoin core','treasury blockchain','capital gains tax on crypto','token by','coinbase ipo'];
  if (cryptoWords.some(w => q.includes(w))) return "crypto";

  if (gammaCategory && gammaCategory !== "other" && gammaCategory !== "?") return gammaCategory;
  return "other";
}

function parseGammaMarketFull(m: GammaMarket) {
  let prices: string[] = [];
  let tokenIds: string[] = [];
  try { prices = JSON.parse(m.outcomePrices || "[]"); } catch {}
  try { tokenIds = JSON.parse(m.clobTokenIds || "[]"); } catch {}

  const yesPrice = prices.length > 0 ? parseFloat(prices[0]) : 0;

  return {
    externalId: `poly-${m.id}`,
    name: m.question || "Unknown",
    category: classifyCategory(m.question || "", m.category || ""),
    currentPrice: yesPrice,
    volume24h: m.volume24hr || 0,
    liquidityNum: m.liquidityNum || 0,
    description: m.description || "",
    conditionId: m.conditionId || String(m.id),
    clobTokenIds: JSON.stringify(tokenIds),
    tickSize: String(m.orderPriceMinTickSize || "0.01"),
    negRisk: m.negRisk ? 1 : 0,
    endDate: m.endDate || null,
    slug: m.slug || null,
    active: m.active && !m.closed,
    closed: m.closed,
  };
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  try {
    const end = new Date(dateStr);
    const now = new Date();
    return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

async function scanPolymarket(): Promise<number> {
  log("Scanning Polymarket via Gamma API (paginated)...", "scanner");
  let discovered = 0;
  let updated = 0;

  try {
    // Paginated fetch: 200 per page, up to 600 markets
    const allMarkets: GammaMarket[] = [];
    for (let offset = 0; offset < 600; offset += 200) {
      const batch = await fetchGammaMarkets(200, offset);
      if (batch.length === 0) break;
      allMarkets.push(...batch);
    }
    log(`Fetched ${allMarkets.length} markets from Gamma API`, "scanner");

    for (const gm of allMarkets) {
      const parsed = parseGammaMarketFull(gm);
      if (!parsed.active || parsed.currentPrice === 0) continue;
      // Relaxed filters: price 0.03-0.97, volume > $100
      if (parsed.currentPrice < 0.03 || parsed.currentPrice > 0.97) continue;
      if (parsed.volume24h < 100) continue;

      // Skip markets that have already expired
      const days = daysUntil(parsed.endDate);
      if (days !== null && days < 0) continue;

      // Apply min/max days filters from config
      const minDays = parseInt(storage.getConfig("pipeline_min_days") || "1");
      const maxDays = parseInt(storage.getConfig("pipeline_max_days") || "90");
      if (days !== null) {
        if (days < minDays || days > maxDays) continue;
      }

      // Apply sector filter
      const enabledSectors = (storage.getConfig("pipeline_sectors") || "sports,crypto,politics,tech,other").split(",").map(s => s.trim().toLowerCase());
      if (!enabledSectors.includes(parsed.category.toLowerCase())) continue;

      const existing = storage.getOpportunityByExternalId(parsed.externalId);

      if (existing) {
        storage.updateOpportunity(existing.id, {
          currentPrice: parsed.currentPrice,
          volume24h: parsed.volume24h,
          totalLiquidity: parsed.liquidityNum,
          marketProbability: parsed.currentPrice,
          conditionId: parsed.conditionId,
          clobTokenIds: parsed.clobTokenIds,
          tickSize: parsed.tickSize,
          negRisk: parsed.negRisk,
          endDate: parsed.endDate,
          slug: parsed.slug,
        });
        updated++;
      } else {
        storage.createOpportunity({
          externalId: parsed.externalId,
          platform: "polymarket",
          title: parsed.name,
          description: parsed.description,
          category: parsed.category,
          marketUrl: parsed.slug ? `https://polymarket.com/event/${parsed.slug}` : `https://polymarket.com`,
          currentPrice: parsed.currentPrice,
          volume24h: parsed.volume24h,
          totalLiquidity: parsed.liquidityNum,
          marketProbability: parsed.currentPrice,
          conditionId: parsed.conditionId,
          clobTokenIds: parsed.clobTokenIds,
          tickSize: parsed.tickSize,
          negRisk: parsed.negRisk,
          endDate: parsed.endDate,
          slug: parsed.slug,
          status: "discovered",
          pipelineStage: "scan",
          discoveredAt: new Date().toISOString(),
        });
        discovered++;
      }
    }

    log(`Polymarket scan complete: ${discovered} new, ${updated} updated`, "scanner");
  } catch (err) {
    log(`Polymarket scan error: ${err}`, "scanner");
  }

  return discovered;
}

// --- Events-based scanner ---

async function scanPolymarketEvents(): Promise<number> {
  log("Scanning Polymarket Events endpoint...", "scanner");
  let discovered = 0;

  try {
    const allEvents: GammaEvent[] = [];
    for (let offset = 0; offset < 600; offset += 200) {
      const batch = await fetchActiveEvents(200, offset);
      if (batch.length === 0) break;
      allEvents.push(...batch);
    }
    log(`Fetched ${allEvents.length} events from Gamma Events API`, "scanner");

    const enabledSectors = (storage.getConfig("pipeline_sectors") || "sports,crypto,politics,tech,other").split(",").map(s => s.trim().toLowerCase());
    const minDays = parseInt(storage.getConfig("pipeline_min_days") || "1");
    const maxDays = parseInt(storage.getConfig("pipeline_max_days") || "90");

    for (const event of allEvents) {
      if (!event.markets || event.markets.length === 0) continue;

      for (const gm of event.markets) {
        const parsed = parseGammaMarketFull(gm);
        if (!parsed.active || parsed.currentPrice === 0) continue;
        if (parsed.currentPrice < 0.03 || parsed.currentPrice > 0.97) continue;
        if (parsed.volume24h < 50) continue; // Lower threshold for events

        // Use market endDate, fall back to event endDate
        const marketEndDate = parsed.endDate || (event as any).endDate || null;
        const days = daysUntil(marketEndDate);
        if (days !== null && days < 0) continue;

        // Apply date filter only if we have a date. No-date markets are included.
        if (days !== null && (days < minDays || days > maxDays)) continue;

        // Apply sector filter
        if (!enabledSectors.includes(parsed.category.toLowerCase())) continue;

        const existing = storage.getOpportunityByExternalId(parsed.externalId);
        if (existing) continue;

        storage.createOpportunity({
          externalId: parsed.externalId,
          platform: "polymarket",
          title: parsed.name,
          description: parsed.description,
          category: parsed.category,
          marketUrl: parsed.slug ? `https://polymarket.com/event/${parsed.slug}` : `https://polymarket.com`,
          currentPrice: parsed.currentPrice,
          volume24h: parsed.volume24h,
          totalLiquidity: parsed.liquidityNum,
          marketProbability: parsed.currentPrice,
          conditionId: parsed.conditionId,
          clobTokenIds: parsed.clobTokenIds,
          tickSize: parsed.tickSize,
          negRisk: parsed.negRisk,
          endDate: marketEndDate,
          slug: parsed.slug,
          status: "discovered",
          pipelineStage: "scan",
          discoveredAt: new Date().toISOString(),
        });
        discovered++;
      }
    }

    log(`Events scan complete: ${discovered} new markets from events`, "scanner");
  } catch (err) {
    log(`Events scan error: ${err}`, "scanner");
  }

  return discovered;
}

// --- Main Scanner ---

export interface ScanResult {
  totalDiscovered: number;
  totalUpdated?: number;
  byPlatform: Record<string, number>;
  errors: string[];
  timestamp: string;
}

let isScanning = false;
let lastScanResult: ScanResult | null = null;

export async function runMarketScan(): Promise<ScanResult> {
  if (isScanning) {
    return { totalDiscovered: 0, byPlatform: {}, errors: ["Scan already in progress"], timestamp: new Date().toISOString() };
  }

  isScanning = true;
  const errors: string[] = [];
  const byPlatform: Record<string, number> = {};

  try {
    const polyCount = await scanPolymarket().catch(err => { errors.push(`Polymarket: ${err}`); return 0; });
    byPlatform.polymarket = polyCount;

    const eventsCount = await scanPolymarketEvents().catch(err => { errors.push(`Polymarket Events: ${err}`); return 0; });
    byPlatform.polymarket_events = eventsCount;

    const totalDiscovered = polyCount + eventsCount;
    log(`Market scan complete: ${totalDiscovered} new opportunities`, "scanner");

    storage.createAuditEntry({
      action: "scan",
      entityType: "opportunity",
      actor: "agent:scanner",
      details: JSON.stringify({ totalDiscovered, byPlatform, errors }),
      timestamp: new Date().toISOString(),
    });

    lastScanResult = { totalDiscovered, byPlatform, errors, timestamp: new Date().toISOString() };
  } finally {
    isScanning = false;
  }

  return lastScanResult;
}

export function getLastScanResult(): ScanResult | null {
  return lastScanResult;
}

export function isScanRunning(): boolean {
  return isScanning;
}
