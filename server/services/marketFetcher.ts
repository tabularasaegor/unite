/**
 * Universal market fetcher for 5m, 15m, 1h Polymarket crypto markets.
 */

const GAMMA_API = "https://gamma-api.polymarket.com";
const ALL_ASSETS = ["btc", "eth", "sol", "xrp"];
const ASSET_NAMES: Record<string, string> = { btc: "bitcoin", eth: "ethereum", sol: "solana", xrp: "xrp" };
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

export interface MarketData {
  asset: string;
  timeframe: string; // "5m" | "15m" | "1h"
  slug: string;
  title: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  upPrice: number;
  downPrice: number;
  volume24h: number;
  liquidity: number;
  endDate: string;
  tickSize: string;
  negRisk: boolean;
  windowStart: number;
  windowEnd: number;
}

function buildSlug(asset: string, timeframe: string): { slug: string; windowStart: number; windowEnd: number } {
  const now = Math.floor(Date.now() / 1000);
  
  if (timeframe === "5m") {
    const ws = now - (now % 300);
    return { slug: `${asset}-updown-5m-${ws}`, windowStart: ws, windowEnd: ws + 300 };
  }
  
  if (timeframe === "15m") {
    const ws = now - (now % 900);
    return { slug: `${asset}-updown-15m-${ws}`, windowStart: ws, windowEnd: ws + 900 };
  }
  
  if (timeframe === "1h") {
    // Format: {assetName}-up-or-down-{month}-{day}-{year}-{hour}{ampm}-et
    const etOffset = -4 * 3600; // ET = UTC-4
    const etTime = now + etOffset;
    const etDate = new Date(etTime * 1000);
    const month = MONTHS[etDate.getUTCMonth()];
    const day = etDate.getUTCDate();
    const year = etDate.getUTCFullYear();
    const hour24 = etDate.getUTCHours();
    const ampm = hour24 >= 12 ? "pm" : "am";
    const h12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
    const name = ASSET_NAMES[asset] || asset;
    const slug = `${name}-up-or-down-${month}-${day}-${year}-${h12}${ampm}-et`;
    const ws = now - (now % 3600);
    return { slug, windowStart: ws, windowEnd: ws + 3600 };
  }
  
  return { slug: "", windowStart: 0, windowEnd: 0 };
}

export async function fetchMarket(asset: string, timeframe: string): Promise<MarketData | null> {
  const { slug, windowStart, windowEnd } = buildSlug(asset, timeframe);
  if (!slug) return null;
  
  try {
    const url = `${GAMMA_API}/events?slug=${slug}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const events = await res.json();
    if (!events || events.length === 0) return null;
    
    const market = events[0].markets?.[0];
    if (!market || market.closed) return null;
    
    const prices = JSON.parse(market.outcomePrices || "[]");
    const clobIds = JSON.parse(market.clobTokenIds || "[]");
    if (prices.length < 2 || clobIds.length < 2) return null;
    
    return {
      asset, timeframe, slug,
      title: market.question || `${asset.toUpperCase()} Up/Down ${timeframe}`,
      conditionId: market.conditionId || "",
      upTokenId: clobIds[0], downTokenId: clobIds[1],
      upPrice: parseFloat(prices[0]), downPrice: parseFloat(prices[1]),
      volume24h: parseFloat(market.volume24hr || "0"),
      liquidity: parseFloat(market.liquidityNum || "0"),
      endDate: market.endDate || new Date(windowEnd * 1000).toISOString(),
      tickSize: String(market.orderPriceMinTickSize || "0.01"),
      negRisk: market.negRisk || false,
      windowStart, windowEnd,
    };
  } catch {
    return null;
  }
}

export function getAllAssets(): string[] {
  return [...ALL_ASSETS];
}

export function getTimeframes(): string[] {
  return ["5m", "15m", "1h"];
}
