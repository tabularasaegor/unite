/**
 * Polymarket CLOB API Integration
 * - Gamma API for market discovery (public, no auth)
 * - CLOB API for orderbook data (public) and order placement (authenticated)
 * - Real-time market data polling
 */

import { log } from "../index";

// --- Types ---

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  category: string;
  endDate: string;
  outcomes: string; // JSON string: ["Yes","No"]
  outcomePrices: string; // JSON string: ["0.72","0.28"]
  volume: string;
  volume24hr: number;
  active: boolean;
  closed: boolean;
  clobTokenIds: string; // JSON string array
  liquidityNum: number;
  bestBid: number;
  bestAsk: number;
  lastTradePrice: number;
  description: string;
  conditionId: string;
  negRisk: boolean;
  orderPriceMinTickSize: number;
  events?: GammaEvent[];
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  category: string;
  volume: number;
  volume24hr: number;
  active: boolean;
  closed: boolean;
  markets?: GammaMarket[];
}

export interface OrderbookEntry {
  price: string;
  size: string;
}

export interface Orderbook {
  market: string;
  asset_id: string;
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  hash: string;
  timestamp: string;
}

export interface ClobPrice {
  token_id: string;
  price: string;
}

export interface OrderResponse {
  orderID: string;
  status: string;
  transactID?: string;
}

// --- Configuration ---

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

// --- Gamma API (Public - Market Discovery) ---

export async function fetchActiveEvents(
  limit = 50,
  offset = 0
): Promise<GammaEvent[]> {
  try {
    const url = `${GAMMA_API}/events?active=true&closed=false&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    log(`Polymarket fetchActiveEvents error: ${err}`, "polymarket");
    return [];
  }
}

export async function fetchMarkets(
  limit = 100,
  offset = 0,
  active = true
): Promise<GammaMarket[]> {
  try {
    const url = `${GAMMA_API}/markets?active=${active}&closed=false&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    return await res.json();
  } catch (err) {
    log(`Polymarket fetchMarkets error: ${err}`, "polymarket");
    return [];
  }
}

export async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
  try {
    const url = `${GAMMA_API}/markets/slug/${slug}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    log(`Polymarket fetchMarketBySlug error: ${err}`, "polymarket");
    return null;
  }
}

export async function searchMarkets(query: string, limit = 20): Promise<any[]> {
  try {
    const url = `${GAMMA_API}/public-search?query=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma search error: ${res.status}`);
    return await res.json();
  } catch (err) {
    log(`Polymarket searchMarkets error: ${err}`, "polymarket");
    return [];
  }
}

// --- CLOB API (Public - Orderbook & Prices) ---

export async function fetchOrderbook(tokenId: string): Promise<Orderbook | null> {
  try {
    const url = `${CLOB_API}/book?token_id=${tokenId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CLOB orderbook error: ${res.status}`);
    return await res.json();
  } catch (err) {
    log(`Polymarket fetchOrderbook error: ${err}`, "polymarket");
    return null;
  }
}

export async function fetchPrice(tokenId: string): Promise<string | null> {
  try {
    const url = `${CLOB_API}/price?token_id=${tokenId}&side=buy`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.price;
  } catch (err) {
    log(`Polymarket fetchPrice error: ${err}`, "polymarket");
    return null;
  }
}

export async function fetchPrices(tokenIds: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  // Batch up to 20 at a time
  for (let i = 0; i < tokenIds.length; i += 20) {
    const batch = tokenIds.slice(i, i + 20);
    try {
      const promises = batch.map(async (id) => {
        const price = await fetchPrice(id);
        if (price) result[id] = price;
      });
      await Promise.all(promises);
    } catch (err) {
      log(`Polymarket fetchPrices batch error: ${err}`, "polymarket");
    }
  }
  return result;
}

export async function fetchMidpoint(tokenId: string): Promise<string | null> {
  try {
    const url = `${CLOB_API}/midpoint?token_id=${tokenId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.mid;
  } catch (err) {
    return null;
  }
}

export async function fetchSpread(tokenId: string): Promise<{ bid: string; ask: string } | null> {
  try {
    const url = `${CLOB_API}/spread?token_id=${tokenId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// --- CLOB API (Authenticated - Order Management) ---
// Uses @polymarket/clob-client SDK for EIP-712 signing

let clobClient: any = null;

export async function initClobClient(): Promise<boolean> {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  if (!privateKey) {
    log("POLY_PRIVATE_KEY not set — Polymarket trading disabled (read-only mode)", "polymarket");
    return false;
  }

  try {
    // Dynamic imports since these are optional dependencies
    const { ClobClient } = await import("@polymarket/clob-client");
    const { Wallet } = await import("ethers");

    const signer = new Wallet(privateKey);

    const signatureType = parseInt(process.env.POLY_SIGNATURE_TYPE || "0");
    const funderAddress = process.env.POLY_FUNDER_ADDRESS || signer.address;

    // Derive API credentials
    const tempClient = new ClobClient(CLOB_API, CHAIN_ID, signer);
    const apiCreds = await tempClient.createOrDeriveApiKey();

    // Initialize full trading client
    // signatureType: 0=EOA, 1=Magic/Email, 2=Gnosis Safe
    clobClient = new ClobClient(
      CLOB_API,
      CHAIN_ID,
      signer,
      apiCreds,
      signatureType,
      funderAddress,
    );

    const typeNames: Record<number, string> = { 0: "EOA", 1: "Magic/Email", 2: "Gnosis Safe" };
    log(`Polymarket CLOB client initialized. Type: ${typeNames[signatureType] || signatureType}, Funder: ${funderAddress}`, "polymarket");
    return true;
  } catch (err) {
    log(`Polymarket CLOB client init failed: ${err}`, "polymarket");
    return false;
  }
}

export function isTradeEnabled(): boolean {
  return clobClient !== null;
}

export async function placeOrder(params: {
  tokenId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  tickSize?: string;
  negRisk?: boolean;
  orderType?: "GTC" | "GTD" | "FOK" | "FAK";
}): Promise<OrderResponse | null> {
  if (!clobClient) {
    log("Cannot place order: CLOB client not initialized", "polymarket");
    return null;
  }

  try {
    const { Side, OrderType } = await import("@polymarket/clob-client");

    const sideEnum = params.side === "BUY" ? Side.BUY : Side.SELL;
    const orderTypeMap: Record<string, any> = {
      GTC: OrderType.GTC,
      GTD: OrderType.GTD,
      FOK: OrderType.FOK,
      FAK: OrderType.FAK,
    };

    const response = await clobClient.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: sideEnum,
      },
      {
        tickSize: params.tickSize || "0.01",
        negRisk: params.negRisk || false,
      },
      orderTypeMap[params.orderType || "GTC"],
    );

    log(`Order placed: ${response.orderID} — ${params.side} ${params.size} @ ${params.price}`, "polymarket");
    return {
      orderID: response.orderID,
      status: response.status,
      transactID: response.transactID,
    };
  } catch (err) {
    log(`Order placement failed: ${err}`, "polymarket");
    return null;
  }
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  if (!clobClient) return false;
  try {
    await clobClient.cancelOrder(orderId);
    log(`Order cancelled: ${orderId}`, "polymarket");
    return true;
  } catch (err) {
    log(`Cancel order failed: ${err}`, "polymarket");
    return false;
  }
}

export async function getOpenOrders(): Promise<any[]> {
  if (!clobClient) return [];
  try {
    return await clobClient.getOpenOrders();
  } catch (err) {
    log(`Get open orders failed: ${err}`, "polymarket");
    return [];
  }
}

// --- Helper: Parse Gamma market data into our internal format ---

export function parseGammaMarket(m: GammaMarket): {
  externalId: string;
  platform: string;
  name: string;
  category: string;
  currentPrice: number;
  volume24h: number;
  liquidity: number;
  marketProbability: number;
  status: string;
  tokenIds: string[];
  description: string;
  conditionId: string;
  clobTokenIds: string;
  tickSize: string;
  negRisk: boolean;
  endDate: string;
  slug: string;
} {
  let outcomes: string[] = [];
  let prices: string[] = [];
  let tokenIds: string[] = [];

  try { outcomes = JSON.parse(m.outcomes || "[]"); } catch {}
  try { prices = JSON.parse(m.outcomePrices || "[]"); } catch {}
  try { tokenIds = JSON.parse(m.clobTokenIds || "[]"); } catch {}

  const yesPrice = prices.length > 0 ? parseFloat(prices[0]) : 0;
  const tickSize = m.orderPriceMinTickSize ? String(m.orderPriceMinTickSize) : "0.01";

  return {
    externalId: `pm-${m.id}`,
    platform: "polymarket",
    name: m.question || "Unknown",
    category: m.category || "other",
    currentPrice: yesPrice,
    volume24h: m.volume24hr || 0,
    liquidity: m.liquidityNum || 0,
    marketProbability: yesPrice,
    status: m.active && !m.closed ? "active" : "resolved",
    tokenIds,
    description: m.description || "",
    conditionId: m.conditionId || "",
    clobTokenIds: m.clobTokenIds || "[]",
    tickSize,
    negRisk: m.negRisk || false,
    endDate: m.endDate || "",
    slug: m.slug || "",
  };
}
