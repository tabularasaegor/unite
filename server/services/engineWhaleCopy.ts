/**
 * ENGINE E: Whale Copy-Trading — Копитрейдинг прибыльных китов
 * 
 * Стратегия: отслеживаем сделки конкретных адресов с высоким PnL
 * на 5-минутных крипторынках Polymarket.
 * 
 * Источники адресов:
 * - Polymarket Crypto Weekly Leaderboard (top 20)
 * - Известные прибыльные 5m-трейдеры (из публичных исследований)
 * - Динамическое обнаружение через крупные сделки
 * 
 * Алгоритм:
 * 1. Для каждого 5-мин рынка (по conditionId) фетчим последние сделки
 * 2. Фильтруем сделки только от tracked wallets (проверенные киты)
 * 3. Определяем направление: куда ставят киты (Up vs Down) — по объёму
 * 4. Калибровка размера: пропорционально размерам сделок китов
 * 5. Если >= 2 кита согласны и объём > $200 — копируем
 */

import { log } from "../index";
import { storage } from "../storage";

interface WhaleCopySignal {
  direction: "Up" | "Down";
  confidence: number;
  whaleVolume: number;
  whaleRatio: number;
  uniqueWhales: number;
  reasoning: string;
  blocked: boolean;
  kellyFraction: number;
}

// ============================================================
// TRACKED WHALE WALLETS
// Source: Polymarket Crypto Weekly Leaderboard + public research
// Updated: 2026-03-29
// ============================================================

interface TrackedWhale {
  address: string;
  name: string;
  tier: "S" | "A" | "B";      // S = top weekly, A = known profitable, B = discovered
  weeklyPnl: number;           // approximate weekly PnL in USD
  trustWeight: number;          // 1.0 = full trust, 0.5 = half
}

// Static list: ACTIVE 5-minute crypto bots found via live Data API analysis
// Criteria: high trade frequency + high balance = automated trading bot
// Updated: 2026-03-29 live market scan
const SEED_WHALES: TrackedWhale[] = [
  // === TIER S: Active high-frequency bots with $50K+ balance ===
  // Found trading 5m crypto markets RIGHT NOW with bot-like patterns (10+ trades/hour)
  { address: "0x732f189193d7a8c8bc8d8eb91f501a22736af081", name: "0x732F1", tier: "S", weeklyPnl: 174632, trustWeight: 1.0 },       // $138K bal, 15tx/4assets, leaderboard #14
  { address: "0xeebde7a0e019a63e6b476eb425505b7b3e6eba30", name: "bot_96k", tier: "S", weeklyPnl: 100000, trustWeight: 1.0 },      // $96K bal, 28tx — most active bot
  { address: "0xec8f31976d2a3260a42944cd5498c577162f8df8", name: "bot_81k", tier: "S", weeklyPnl: 80000, trustWeight: 1.0 },       // $81K bal, 11tx
  { address: "0xd84c2b6d65dc596f49c7b6aadd6d74ca91e407b9", name: "BoneReader", tier: "S", weeklyPnl: 560807, trustWeight: 0.9 },   // Leaderboard #2, $35K bal
  { address: "0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82", name: "bot_3k_multi", tier: "S", weeklyPnl: 50000, trustWeight: 0.9 },  // $2.9K bal, 12tx/3assets
  
  // === TIER A: Active bots with $1K-50K balance, 10+ trades ===
  { address: "0x99c4fb1f78881601075bc25b13c9af76bc5918e7", name: "bot_27k", tier: "A", weeklyPnl: 30000, trustWeight: 0.9 },       // $27K bal, 11tx
  { address: "0x0d05acd6baaa8ea1fac50ab74a7679ae6f534518", name: "bot_9k", tier: "A", weeklyPnl: 15000, trustWeight: 0.85 },       // $9K bal, 8tx
  { address: "0xb977ffa7f22db6633762e6372661a30bb53fb5e2", name: "bot_564", tier: "A", weeklyPnl: 5000, trustWeight: 0.8 },         // $564 bal, 19tx — very active small bot
  { address: "0x16bc7faccdb6dedd07d47333a6f06fef635dd23a", name: "bot_463", tier: "A", weeklyPnl: 5000, trustWeight: 0.8 },         // $463 bal, 18tx
  { address: "0x965659485992e51f04f532e964e56ca2c6aee340", name: "bot_1.5k", tier: "A", weeklyPnl: 5000, trustWeight: 0.8 },        // $1.5K bal, 15tx
  { address: "0xe0229e10a858860218b6132f4234602c47bd6603", name: "bot_1.6k", tier: "A", weeklyPnl: 5000, trustWeight: 0.8 },        // $1.6K bal, 15tx
  { address: "0x476639d9845d7a0261cb005dae6473f089ff5a03", name: "bot_905", tier: "A", weeklyPnl: 3000, trustWeight: 0.8 },         // $905 bal, 14tx
  { address: "0x536be02af900fe046fa708c8059c04f737a2cee3", name: "bot_1.5k_b", tier: "A", weeklyPnl: 3000, trustWeight: 0.8 },      // $1.5K bal, 13tx
  { address: "0xe28feea8eb5e5f909d574a92f860fa751712a9b0", name: "bot_1.4k_5a", tier: "A", weeklyPnl: 5000, trustWeight: 0.85 },   // $1.4K bal, 9tx/5assets — diversified

  // === TIER A: Crypto weekly leaderboard (confirmed profitable) ===
  { address: "0x2d8b401d2f0e6937afebf18e19e11ca568a5260a", name: "vidarx", tier: "A", weeklyPnl: 348494, trustWeight: 0.85 },
  { address: "0x0006af12cd4dacc450836a0e1ec6ce47365d8c63", name: "stingo43", tier: "A", weeklyPnl: 271237, trustWeight: 0.85 },
  { address: "0x29bc82f761749e67fa00d62896bc6855097b683c", name: "BoshBashBish", tier: "A", weeklyPnl: 198125, trustWeight: 0.85 },
  { address: "0x70ec235a31eb35f243e2618d6ea3b5b8962bbb5d", name: "vague-sourdough", tier: "A", weeklyPnl: 190175, trustWeight: 0.8 },
  { address: "0xa45fe11dd1420fca906ceac2c067844379a42429", name: "guh123", tier: "A", weeklyPnl: 187035, trustWeight: 0.8 },
  { address: "0x3e9d296b8f8f670cd859350b3c0a00251dc71f47", name: "hgjghjh85", tier: "A", weeklyPnl: 161184, trustWeight: 0.8 },
  { address: "0x576b0696fd5a9225d66fd9500fd98f5be10b0cab", name: "Hcrystallash", tier: "A", weeklyPnl: 143254, trustWeight: 0.8 },
  { address: "0x45bc74efa620b45c02308acaecdff1f7c06f978b", name: "bbc5z", tier: "A", weeklyPnl: 119680, trustWeight: 0.8 },
  { address: "0x388537259dc9e693c1c9b96fdf07a63f6b7aca77", name: "easypredict", tier: "A", weeklyPnl: 114663, trustWeight: 0.8 },
  { address: "0x751a2b86cab503496efd325c8344e10159349ea1", name: "Sharky6999", tier: "A", weeklyPnl: 112808, trustWeight: 0.8 },

  // === TIER B: Active mid-volume bots ===  
  { address: "0x80ea255721c6fd183d9c436633a416e6d28fc728", name: "bot_2.8k", tier: "B", weeklyPnl: 3000, trustWeight: 0.7 },
  { address: "0x38c6fd3ae5db3217840f71541c949011b651e912", name: "bot_929", tier: "B", weeklyPnl: 2000, trustWeight: 0.7 },
  { address: "0xb4d2499b6cabd0bb93672bb17c5ae47101759ee1", name: "bot_278", tier: "B", weeklyPnl: 2000, trustWeight: 0.7 },
  { address: "0x56e59348ccf8d11b172bd74ddc9ec69722ff6be4", name: "bot_327", tier: "B", weeklyPnl: 2000, trustWeight: 0.7 },

  // === High-balance whale traders (less frequent but big bets) ===
  { address: "0xdf0d2ccfe3d7c2ef120395534e43afe283509f79", name: "whale_72k", tier: "A", weeklyPnl: 50000, trustWeight: 0.85 },
  { address: "0x0997f4b1f822423c65907c57963fe7191e1ec9f6", name: "whale_29k", tier: "A", weeklyPnl: 30000, trustWeight: 0.85 },
  { address: "0x2a9c77ed09d86c2ad2ced0a60c8b5b2a23acc8cf", name: "whale_19k", tier: "B", weeklyPnl: 20000, trustWeight: 0.7 },
  { address: "0x6fc44ec445d73c635ae9029cdaff52f8eb62c89d", name: "whale_6k", tier: "B", weeklyPnl: 10000, trustWeight: 0.7 },
  { address: "0x63ce342161250d705dc0b16df89036c8e5f9ba9a", name: "0x8dxd_MM", tier: "B", weeklyPnl: 501828, trustWeight: 0.5 },      // Market maker — low directional trust
];

// Dynamic whale discovery cache
interface DynamicWhale {
  address: string;
  discoveredAt: number;
  trades: number;
  volume: number;
  winRate: number;          // tracked win rate
  wins: number;
  losses: number;
}

const dynamicWhales: Map<string, DynamicWhale> = new Map();
const DYNAMIC_MIN_TRADES = 3;
const DYNAMIC_MIN_WINRATE = 0.52;
const DYNAMIC_MIN_VOLUME = 200;

// Build lookup set for fast checking
const trackedAddresses = new Set(SEED_WHALES.map(w => w.address.toLowerCase()));

function getWhaleInfo(address: string): TrackedWhale | null {
  const lower = address.toLowerCase();
  const seed = SEED_WHALES.find(w => w.address.toLowerCase() === lower);
  if (seed) return seed;
  
  const dynamic = dynamicWhales.get(lower);
  if (dynamic && dynamic.trades >= DYNAMIC_MIN_TRADES && dynamic.winRate >= DYNAMIC_MIN_WINRATE) {
    return {
      address: lower,
      name: `discovered_${lower.slice(0, 8)}`,
      tier: "B",
      weeklyPnl: dynamic.volume * (dynamic.winRate - 0.5),
      trustWeight: Math.min(0.6, 0.3 + dynamic.winRate * 0.3),
    };
  }
  return null;
}

// ============================================================
// TRADE FETCHING
// ============================================================

interface TradeData {
  proxyWallet: string;
  side: string;
  outcome: string;
  usdcSize: number;
  price: number;
  timestamp: number;
  outcomeIndex: number;
}

const tradeCache: Record<string, { trades: TradeData[]; fetchedAt: number }> = {};
const CACHE_TTL = 40000; // 40 seconds

async function fetchMarketTrades(conditionId: string): Promise<TradeData[]> {
  const now = Date.now();
  if (tradeCache[conditionId] && now - tradeCache[conditionId].fetchedAt < CACHE_TTL) {
    return tradeCache[conditionId].trades;
  }

  try {
    const url = `https://data-api.polymarket.com/trades?market=${conditionId}&limit=200`;
    const resp = await fetch(url);
    if (!resp.ok) return tradeCache[conditionId]?.trades || [];
    
    const raw = await resp.json();
    if (!Array.isArray(raw)) return [];

    const trades: TradeData[] = raw.map((t: any) => ({
      proxyWallet: (t.proxyWallet || "").toLowerCase(),
      side: t.side || "BUY",
      outcome: t.outcome || "",
      usdcSize: Number(t.usdcSize || t.size || 0),
      price: Number(t.price || 0),
      timestamp: Number(t.timestamp || 0),
      outcomeIndex: Number(t.outcomeIndex || 0),
    }));

    tradeCache[conditionId] = { trades, fetchedAt: now };
    
    // Dynamic whale discovery: check for non-tracked large traders
    discoverNewWhales(trades);
    
    return trades;
  } catch (err) {
    log(`Whale: fetch error ${conditionId}: ${err}`, "micro");
    return tradeCache[conditionId]?.trades || [];
  }
}

// ============================================================
// DYNAMIC WHALE DISCOVERY
// ============================================================

function discoverNewWhales(trades: TradeData[]) {
  for (const t of trades) {
    if (t.usdcSize < 30) continue; // Consider $30+ trades for discovery
    if (trackedAddresses.has(t.proxyWallet)) continue; // Already tracked
    
    if (!dynamicWhales.has(t.proxyWallet)) {
      dynamicWhales.set(t.proxyWallet, {
        address: t.proxyWallet,
        discoveredAt: Date.now(),
        trades: 0,
        volume: 0,
        winRate: 0.5,
        wins: 0,
        losses: 0,
      });
    }
    const dw = dynamicWhales.get(t.proxyWallet)!;
    dw.trades++;
    dw.volume += t.usdcSize;
  }
  
  // Cleanup old dynamic whales (>24 hours without activity)
  const cutoff = Date.now() - 86400000;
  for (const [addr, dw] of dynamicWhales) {
    if (dw.discoveredAt < cutoff && dw.trades < DYNAMIC_MIN_TRADES) {
      dynamicWhales.delete(addr);
    }
  }
}

/**
 * Update dynamic whale win/loss tracking.
 * Called from settlement to learn which discovered whales are actually good.
 */
export function updateWhalePerformance(conditionId: string, resolvedUp: boolean) {
  // Check cached trades for this market
  const cached = tradeCache[conditionId];
  if (!cached) return;
  
  for (const t of cached.trades) {
    const dw = dynamicWhales.get(t.proxyWallet);
    if (!dw) continue;
    
    const outcomeNorm = (t.outcome || "").toLowerCase();
    let tradeIsUp = false;
    if (t.side === "BUY") {
      tradeIsUp = outcomeNorm === "up" || outcomeNorm === "yes" || t.outcomeIndex === 0;
    } else {
      tradeIsUp = outcomeNorm === "down" || outcomeNorm === "no" || t.outcomeIndex === 1;
    }
    
    const correct = tradeIsUp === resolvedUp;
    if (correct) dw.wins++;
    else dw.losses++;
    dw.winRate = dw.wins / Math.max(1, dw.wins + dw.losses);
    
    // Promote to tracked if good enough
    if (dw.trades >= DYNAMIC_MIN_TRADES && dw.winRate >= DYNAMIC_MIN_WINRATE && dw.volume >= DYNAMIC_MIN_VOLUME) {
      trackedAddresses.add(dw.address);
      log(`Whale: Promoted ${dw.address.slice(0, 14)} to tracked (WR=${(dw.winRate * 100).toFixed(0)}%, ${dw.trades}tx, $${dw.volume.toFixed(0)})`, "micro");
    }
  }
}

// ============================================================
// MAIN ENGINE
// ============================================================

export async function runWhaleCopyTrading(
  asset: string,
  conditionId: string,
  upPrice: number,
  liquidity: number
): Promise<WhaleCopySignal> {
  const MIN_WHALE_CONSENSUS = 0.55;  // lowered: bots often split 55/45
  const MIN_WHALES = 1;              // even 1 tracked whale is a signal
  const MIN_WHALE_VOLUME = 15;       // lowered: bots trade $20-50 per position

  if (!conditionId) {
    return { direction: "Up", confidence: 0.50, whaleVolume: 0, whaleRatio: 0.5, uniqueWhales: 0, reasoning: "нет conditionId", blocked: true, kellyFraction: 0 };
  }

  const trades = await fetchMarketTrades(conditionId);
  if (trades.length === 0) {
    return { direction: "Up", confidence: 0.50, whaleVolume: 0, whaleRatio: 0.5, uniqueWhales: 0, reasoning: "нет сделок", blocked: true, kellyFraction: 0 };
  }

  // Filter trades from tracked whales only
  let upVolume = 0, downVolume = 0;
  let upWeightedVol = 0, downWeightedVol = 0;
  const upWhales = new Map<string, number>(); // address → volume
  const downWhales = new Map<string, number>();

  for (const t of trades) {
    const whale = getWhaleInfo(t.proxyWallet);
    if (!whale) continue;
    if (t.usdcSize < 3) continue; // Skip dust (bots trade as low as $5)

    const outcomeNorm = (t.outcome || "").toLowerCase();
    let isUp = false;
    
    if (t.side === "BUY") {
      isUp = outcomeNorm === "up" || outcomeNorm === "yes" || t.outcomeIndex === 0;
    } else {
      isUp = outcomeNorm === "down" || outcomeNorm === "no" || t.outcomeIndex === 1;
    }

    const weightedSize = t.usdcSize * whale.trustWeight;

    if (isUp) {
      upVolume += t.usdcSize;
      upWeightedVol += weightedSize;
      upWhales.set(whale.address, (upWhales.get(whale.address) || 0) + t.usdcSize);
    } else {
      downVolume += t.usdcSize;
      downWeightedVol += weightedSize;
      downWhales.set(whale.address, (downWhales.get(whale.address) || 0) + t.usdcSize);
    }
  }

  const totalWhaleVol = upVolume + downVolume;
  const totalWeighted = upWeightedVol + downWeightedVol;
  const allWhaleAddrs = new Set([...upWhales.keys(), ...downWhales.keys()]);
  const uniqueWhales = allWhaleAddrs.size;

  if (totalWhaleVol < MIN_WHALE_VOLUME || uniqueWhales < MIN_WHALES) {
    return {
      direction: "Up", confidence: 0.50, whaleVolume: totalWhaleVol, whaleRatio: 0.5,
      uniqueWhales, reasoning: `мало данных: $${totalWhaleVol.toFixed(0)}, ${uniqueWhales} китов`, blocked: true, kellyFraction: 0,
    };
  }

  // Direction from trust-weighted volume
  const direction: "Up" | "Down" = upWeightedVol >= downWeightedVol ? "Up" : "Down";
  const winWeighted = direction === "Up" ? upWeightedVol : downWeightedVol;
  const whaleRatio = totalWeighted > 0 ? winWeighted / totalWeighted : 0.5;
  const winWhaleCount = direction === "Up" ? upWhales.size : downWhales.size;

  const reasons: string[] = [];
  
  // Name the top whales that are driving the signal
  const whaleMap = direction === "Up" ? upWhales : downWhales;
  const topWhaleNames: string[] = [];
  for (const [addr, vol] of [...whaleMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const info = getWhaleInfo(addr);
    if (info) topWhaleNames.push(`${info.name}($${vol.toFixed(0)})`);
  }
  reasons.push(topWhaleNames.join("+"));
  reasons.push(`ratio:${(whaleRatio * 100).toFixed(0)}%`);
  reasons.push(`vol:$${totalWhaleVol.toFixed(0)}`);

  // Confidence calculation
  let confidence = 0.50;

  // Whale consensus
  if (whaleRatio > 0.80) {
    confidence = 0.60;
    reasons.push("strong");
  } else if (whaleRatio > 0.65) {
    confidence = 0.56;
    reasons.push("moderate");
  } else if (whaleRatio > MIN_WHALE_CONSENSUS) {
    confidence = 0.53;
  }

  // Volume bonus
  if (totalWhaleVol > 2000) { confidence += 0.03; reasons.push("huge_vol"); }
  else if (totalWhaleVol > 500) { confidence += 0.02; }

  // Multiple whales agree
  if (winWhaleCount >= 3) { confidence += 0.03; reasons.push(`${winWhaleCount}whales`); }
  else if (winWhaleCount >= 2) { confidence += 0.01; }

  // S-tier whales present — strongest signal
  const sTierInDirection = [...whaleMap.keys()].filter(a => {
    const info = getWhaleInfo(a);
    return info?.tier === "S";
  });
  if (sTierInDirection.length > 0) {
    confidence += 0.02;
    reasons.push(`S-tier:${sTierInDirection.length}`);
  }

  // Market disagreement = edge opportunity
  const polyDir = upPrice > 0.52 ? "Up" : upPrice < 0.48 ? "Down" : "neutral";
  if (polyDir !== "neutral" && polyDir !== direction) {
    confidence += 0.02;
    reasons.push("whale≠market");
  }

  // Blocking — very permissive, we want to trade when whales are active
  let blocked = false;
  if (whaleRatio < MIN_WHALE_CONSENSUS && totalWhaleVol < 200) { blocked = true; }
  // Don't block if single whale with large volume (>$500) — strong signal
  if (uniqueWhales < MIN_WHALES && totalWhaleVol < 500) { blocked = true; }

  // Kelly sizing — calibrate to whale volume proportionally
  const edge = Math.max(0, confidence - 0.50);
  const volumeScale = Math.min(1.0, totalWhaleVol / 500); // $500+ whale vol = full kelly
  // Down bias: if whale consensus is Down, boost kelly (matches overall market tendency)
  const dirBoost = direction === "Down" ? 1.2 : 1.0;
  const kellyFraction = edge > 0 ? edge * 0.70 * volumeScale * dirBoost : 0;

  return {
    direction,
    confidence: Math.min(0.70, confidence),
    whaleVolume: totalWhaleVol,
    whaleRatio,
    uniqueWhales,
    reasoning: `WHALE_COPY: ${reasons.join(" ")}`,
    blocked,
    kellyFraction,
  };
}

// ============================================================
// PUBLIC API — for status display
// ============================================================

/**
 * Dynamically refresh whale list by scanning recent large trades.
 * Called periodically (~every 30 minutes) to discover new active bots.
 */
export async function refreshWhaleList(): Promise<void> {
  try {
    const url = "https://data-api.polymarket.com/trades?limit=500&filterType=CASH&filterAmount=30";
    const resp = await fetch(url);
    if (!resp.ok) return;
    const trades = await resp.json();
    if (!Array.isArray(trades)) return;

    // Filter 5m crypto trades
    const crypto5m = trades.filter((t: any) => (t.title || "").includes("Up or Down"));
    
    // Aggregate per wallet
    const walletStats: Record<string, { trades: number; volume: number }> = {};
    for (const t of crypto5m) {
      const w = (t.proxyWallet || "").toLowerCase();
      if (!walletStats[w]) walletStats[w] = { trades: 0, volume: 0 };
      walletStats[w].trades++;
      walletStats[w].volume += Number(t.usdcSize || t.size || 0);
    }

    // Find new high-frequency traders not yet tracked
    let added = 0;
    for (const [addr, stats] of Object.entries(walletStats)) {
      if (trackedAddresses.has(addr)) continue;
      if (stats.trades >= 8 && stats.volume >= 200) {
        // High-frequency trader — add to tracked
        trackedAddresses.add(addr);
        SEED_WHALES.push({
          address: addr,
          name: `auto_${addr.slice(0, 8)}`,
          tier: "B",
          weeklyPnl: stats.volume,
          trustWeight: 0.6,
        });
        added++;
      }
    }
    if (added > 0) {
      log(`Whale: Refreshed — added ${added} new wallets (total: ${trackedAddresses.size})`, "micro");
    }
  } catch (err) {
    log(`Whale: Refresh error: ${err}`, "micro");
  }
}

export function getWhaleStatus() {
  const seedInfo = SEED_WHALES.map(w => ({
    address: w.address.slice(0, 14) + "...",
    name: w.name,
    tier: w.tier,
    weeklyPnl: w.weeklyPnl,
    trustWeight: w.trustWeight,
  }));
  
  const dynamicInfo = [...dynamicWhales.values()]
    .filter(d => d.trades >= 3)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
    .map(d => ({
      address: d.address.slice(0, 14) + "...",
      trades: d.trades,
      volume: Math.round(d.volume),
      winRate: Math.round(d.winRate * 100),
      promoted: trackedAddresses.has(d.address),
    }));

  return {
    trackedCount: trackedAddresses.size,
    seedWhales: seedInfo,
    dynamicWhales: dynamicInfo,
  };
}
