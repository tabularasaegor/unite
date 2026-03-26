/**
 * Polymarket API integration — Gamma API + CLOB API
 * Handles slug generation, event discovery, midpoints, orderbook, and resolution checking.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

const SUPPORTED_ASSETS = ["btc", "eth", "sol", "xrp"] as const;
export type Asset = (typeof SUPPORTED_ASSETS)[number];

// ─── Slug Generation ─────────────────────────────────────────────

/**
 * Compute the slug for a 5-min window.
 * 
 * IMPORTANT: Polymarket slug timestamp = window START time.
 * The event "btc-updown-5m-1774561200" covers 21:40:00 - 21:45:00.
 * The slug timestamp (1774561200) is 21:40:00 = the window START.
 * 
 * windowsAhead=1 → the currently tradeable window (the one starting at the next 5-min mark).
 */
export function getUpcomingSlug(asset: Asset, windowsAhead = 1): string {
  const t = Math.floor(Date.now() / 1000);
  const nextWindowStart = (Math.floor(t / 300) + windowsAhead) * 300;
  return `${asset}-updown-5m-${nextWindowStart}`;
}

/**
 * Extract the unix timestamp from a slug.
 */
export function slugToTimestamp(slug: string): number {
  const parts = slug.split("-");
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Get current window end timestamp.
 * 
 * This returns the END time of the currently tradeable window.
 * If we're at 21:38, the next tradeable window starts at 21:40 and ends at 21:45.
 * getCurrentWindowEnd() returns 21:45 (1774561500).
 * The slug for this window uses 21:40 (the start): btc-updown-5m-1774561200
 */
export function getCurrentWindowEnd(): number {
  const t = Math.floor(Date.now() / 1000);
  // Next 5-min boundary is the START of the next window
  const nextWindowStart = Math.ceil(t / 300) * 300;
  // The window ends 300s after it starts
  return nextWindowStart + 300;
}

/**
 * Get current window start (= the slug timestamp for the current window).
 */
export function getCurrentWindowStart(): number {
  const t = Math.floor(Date.now() / 1000);
  return Math.ceil(t / 300) * 300;
}

/**
 * Get the window start for a given window end.
 */
export function getWindowStart(windowEnd: number): number {
  return windowEnd - 300;
}

// ─── Gamma API — Event Discovery ─────────────────────────────────

export interface GammaMarket {
  id: string;
  conditionId: string;
  slug: string;
  outcomes: string; // JSON string: '["Up","Down"]'
  clobTokenIds: string; // JSON string: '["upTokenId","downTokenId"]'
  orderPriceMinTickSize: number;
  orderMinSize: number;
  acceptingOrders: boolean;
  eventStartTime: string;
  endDate: string;
}

export interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  restricted: boolean;
  active: boolean;
  closed: boolean;
  startTime: string;
  closedTime?: string;
  seriesSlug: string;
  eventMetadata?: {
    finalPrice?: number;
    priceToBeat?: number;
  };
  markets: GammaMarket[];
}

export interface ParsedEvent {
  eventId: string;
  slug: string;
  title: string;
  active: boolean;
  closed: boolean;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  tickSize: number;
  minSize: number;
  acceptingOrders: boolean;
  windowStart: number; // unix seconds
  windowEnd: number; // unix seconds
  finalPrice?: number;
  priceToBeat?: number;
}

/**
 * Fetch a single event by slug from Gamma API.
 * Returns parsed event or null if not found.
 */
export async function fetchEventBySlug(slug: string): Promise<ParsedEvent | null> {
  try {
    const resp = await fetch(`${GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`);
    if (!resp.ok) {
      console.error(`[Polymarket] Gamma API error: ${resp.status} for slug ${slug}`);
      return null;
    }
    const events: GammaEvent[] = await resp.json() as GammaEvent[];
    if (!events || events.length === 0) return null;

    const event = events[0];
    if (!event.markets || event.markets.length === 0) return null;

    const market = event.markets[0];
    const tokenIds: string[] = JSON.parse(market.clobTokenIds);
    // Slug timestamp = window START time on Polymarket
    const windowStart = slugToTimestamp(slug);
    const windowEnd = windowStart + 300;

    return {
      eventId: event.id,
      slug: event.slug,
      title: event.title,
      active: event.active,
      closed: event.closed,
      conditionId: market.conditionId,
      upTokenId: tokenIds[0],
      downTokenId: tokenIds[1],
      tickSize: market.orderPriceMinTickSize,
      minSize: market.orderMinSize,
      acceptingOrders: market.acceptingOrders,
      windowStart,
      windowEnd,
      finalPrice: event.eventMetadata?.finalPrice,
      priceToBeat: event.eventMetadata?.priceToBeat,
    };
  } catch (err) {
    console.error(`[Polymarket] Failed to fetch event by slug ${slug}:`, err);
    return null;
  }
}

// ─── CLOB API — Prices & Orderbook ──────────────────────────────

/**
 * Get midpoints for multiple token IDs in a single batch call.
 * Returns map: tokenId → midpoint (number).
 */
export async function getMidpoints(tokenIds: string[]): Promise<Record<string, number>> {
  try {
    const body = tokenIds.map(token_id => ({ token_id }));
    const resp = await fetch(`${CLOB_BASE}/midpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(`[Polymarket] CLOB midpoints error: ${resp.status}`);
      return {};
    }
    const data = await resp.json() as Record<string, string>;
    const result: Record<string, number> = {};
    for (const [id, val] of Object.entries(data)) {
      result[id] = parseFloat(val) || 0.5;
    }
    return result;
  } catch (err) {
    console.error("[Polymarket] Failed to fetch midpoints:", err);
    return {};
  }
}

/**
 * Get midpoint for a single token ID.
 */
export async function getMidpoint(tokenId: string): Promise<number> {
  try {
    const resp = await fetch(`${CLOB_BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`);
    if (!resp.ok) return 0.5;
    const data = await resp.json() as { mid: string };
    return parseFloat(data.mid) || 0.5;
  } catch {
    return 0.5;
  }
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  hash: string;
}

/**
 * Get full orderbook for a token ID.
 */
export async function getOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const resp = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`);
    if (!resp.ok) {
      console.error(`[Polymarket] CLOB book error: ${resp.status}`);
      return null;
    }
    return await resp.json() as OrderBook;
  } catch (err) {
    console.error("[Polymarket] Failed to fetch orderbook:", err);
    return null;
  }
}

/**
 * Get price history for a token (for momentum/mean-reversion strategies).
 * interval: "1h" for recent data, fidelity: 1 = one point per minute.
 */
export async function getPriceHistory(
  tokenId: string,
  interval = "1h",
  fidelity = 1
): Promise<{ t: number; p: number }[]> {
  try {
    const url = `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as { history: { t: number; p: number }[] };
    return data.history || [];
  } catch {
    return [];
  }
}

/**
 * Check if an event has been resolved.
 * 
 * PRIMARY method: use market.outcomePrices (e.g. ["1","0"] or ["0","1"]).
 * This is available as soon as the event closes — much faster than eventMetadata.finalPrice
 * which can take 10-15 minutes to populate.
 * 
 * FALLBACK: eventMetadata.finalPrice/priceToBeat if outcomePrices is not available.
 */
export async function fetchResolvedEvent(slug: string): Promise<{
  resolved: boolean;
  outcome?: "up" | "down";
  finalPrice?: number;
  priceToBeat?: number;
  closed: boolean;
} | null> {
  try {
    const resp = await fetch(`${GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`);
    if (!resp.ok) return null;
    const events: GammaEvent[] = await resp.json() as GammaEvent[];
    if (!events || events.length === 0) return null;

    const event = events[0];
    if (!event.markets || event.markets.length === 0) {
      return { resolved: false, closed: event.closed };
    }

    const market = event.markets[0];
    const meta = event.eventMetadata;

    // Method 1: outcomePrices — fastest resolution signal
    // outcomes = ["Up", "Down"], outcomePrices = ["1", "0"] means Up won
    if (event.closed && (market as any).outcomePrices) {
      try {
        const outcomePrices: string[] = JSON.parse((market as any).outcomePrices);
        if (outcomePrices.length >= 2) {
          const upPrice = parseFloat(outcomePrices[0]);
          const downPrice = parseFloat(outcomePrices[1]);
          if ((upPrice === 1 && downPrice === 0) || (upPrice === 0 && downPrice === 1)) {
            const outcome: "up" | "down" = upPrice === 1 ? "up" : "down";
            return {
              resolved: true,
              outcome,
              finalPrice: meta?.finalPrice,
              priceToBeat: meta?.priceToBeat,
              closed: true,
            };
          }
        }
      } catch {
        // outcomePrices might not be parseable, fall through
      }
    }

    // Method 2: eventMetadata.finalPrice (takes 10-15 min to populate)
    if (event.closed && meta?.finalPrice !== undefined && meta?.priceToBeat !== undefined) {
      const outcome: "up" | "down" = meta.finalPrice >= meta.priceToBeat ? "up" : "down";
      return {
        resolved: true,
        outcome,
        finalPrice: meta.finalPrice,
        priceToBeat: meta.priceToBeat,
        closed: true,
      };
    }

    return {
      resolved: false,
      closed: event.closed,
      finalPrice: meta?.finalPrice,
      priceToBeat: meta?.priceToBeat,
    };
  } catch (err) {
    console.error(`[Polymarket] Failed to check resolution for ${slug}:`, err);
    return null;
  }
}

/**
 * Get active and upcoming windows for all assets.
 * Returns current + next window info per asset.
 */
export async function getActiveWindows(assets: Asset[] = [...SUPPORTED_ASSETS]): Promise<
  Record<string, {
    currentSlug: string;
    currentWindowEnd: number;
    nextSlug: string;
    nextWindowEnd: number;
    currentEvent: ParsedEvent | null;
  }>
> {
  const result: Record<string, any> = {};

  for (const asset of assets) {
    const currentSlug = getUpcomingSlug(asset, 1);
    const nextSlug = getUpcomingSlug(asset, 2);
    const currentWindowEnd = slugToTimestamp(currentSlug);
    const nextWindowEnd = slugToTimestamp(nextSlug);

    let currentEvent: ParsedEvent | null = null;
    try {
      currentEvent = await fetchEventBySlug(currentSlug);
    } catch {
      // Market might not be created yet
    }

    result[asset] = {
      currentSlug,
      currentWindowEnd,
      nextSlug,
      nextWindowEnd,
      currentEvent,
    };
  }

  return result;
}

/**
 * Compute Order Book Imbalance from raw orderbook data.
 * OBI = (bidVol - askVol) / (bidVol + askVol), range [-1, 1].
 * Uses top N levels (default 10).
 */
export function computeOBI(book: OrderBook, levels = 10): number {
  const bidVol = book.bids
    .slice(0, levels)
    .reduce((sum, l) => sum + parseFloat(l.size), 0);
  const askVol = book.asks
    .slice(0, levels)
    .reduce((sum, l) => sum + parseFloat(l.size), 0);
  const total = bidVol + askVol;
  if (total === 0) return 0;
  return (bidVol - askVol) / total;
}
