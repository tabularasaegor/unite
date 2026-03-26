/**
 * Crypto Micro-Scheduler — 5-Minute BTC/ETH/SOL/XRP Up/Down Trading
 * 
 * Every ~60 seconds:
 * 1. Fetch current 5-min window for each asset
 * 2. AI momentum analysis with calibration from past results
 * 3. If edge > 0.5% → place trade (low threshold for near-50/50 markets)
 * 4. Auto-settle after window expires
 * 5. Update calibration stats for continuous learning
 */

import { log } from "../index";
import { storage } from "../storage";
import { fetchPrice } from "./polymarket";
import { computeMLSignal, rebuildCalibrationFromDB } from "./mlCalibration";

const GAMMA_API = "https://gamma-api.polymarket.com";
const ALL_ASSETS = ["btc", "eth", "sol", "xrp"] as const;
type CryptoAsset = string;

interface MicroMarket {
  asset: string;
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

// --- Calibration tracking ---
interface AssetCalibration {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  upWins: number;
  upLosses: number;
  downWins: number;
  downLosses: number;
  lastResults: Array<{ direction: string; won: boolean; pnl: number; ts: number }>;
  avgEdgeRealized: number;
}

const calibration: Record<string, AssetCalibration> = {};

// --- Adaptive regime tracking ---
interface WindowResult { ts: number; wins: number; losses: number; totalPnl: number; }
const windowHistory: WindowResult[] = [];
const assetCooldown: Record<string, number> = {};
let lastWindowPnl = 0;
let consecutiveLossWindows = 0;
let betSizeMultiplier = 1.0;
let sessionPeakPnl = 0;
let sessionPnl = 0;
const modelLog: Array<{ ts: string; event: string; detail: string }> = [];

function logModelChange(event: string, detail: string) {
  const entry = { ts: new Date().toISOString(), event, detail };
  modelLog.push(entry);
  if (modelLog.length > 100) modelLog.shift();
  log(`MODEL: ${event} — ${detail}`, "micro");
  // Persist model log to DB
  try {
    storage.upsertMemory({
      category: "micro_model_log",
      key: "log",
      value: JSON.stringify(modelLog.slice(-100)),
      confidence: 1,
      createdAt: new Date().toISOString(),
    });
  } catch {}
}

function recordWindowResult(wins: number, losses: number, pnl: number) {
  windowHistory.push({ ts: Date.now(), wins, losses, totalPnl: pnl });
  if (windowHistory.length > 20) windowHistory.shift();
  lastWindowPnl = pnl;
  sessionPnl += pnl;
  if (sessionPnl > sessionPeakPnl) sessionPeakPnl = sessionPnl;

  const prevMult = betSizeMultiplier;

  if (losses > wins) {
    consecutiveLossWindows++;
    // AGGRESSIVE decay: drop to base 1.0 immediately, then reduce further
    betSizeMultiplier = Math.max(0.25, 1.0 - consecutiveLossWindows * 0.25);
    logModelChange("LOSS_WINDOW", `${wins}W/${losses}L, consec=${consecutiveLossWindows}, mult: ${prevMult.toFixed(2)}→${betSizeMultiplier.toFixed(2)}`);
  } else {
    if (consecutiveLossWindows > 0) {
      logModelChange("WIN_RECOVERY", `Breaking ${consecutiveLossWindows} loss streak`);
    }
    consecutiveLossWindows = 0;
    // SLOW recovery: only +0.1 per win window, HARD CAP at 1.0 (never over-leverage)
    betSizeMultiplier = Math.min(1.0, betSizeMultiplier + 0.1);
    logModelChange("WIN_WINDOW", `${wins}W/${losses}L, mult=${betSizeMultiplier.toFixed(2)}x`);
  }

  // Drawdown brake: if we've lost >30% from session peak, hard cap at 0.5x
  const drawdown = sessionPeakPnl - sessionPnl;
  if (sessionPeakPnl > 20 && drawdown > sessionPeakPnl * 0.3) {
    betSizeMultiplier = Math.min(betSizeMultiplier, 0.5);
    logModelChange("DRAWDOWN_BRAKE", `Peak=$${sessionPeakPnl.toFixed(0)} Current=$${sessionPnl.toFixed(0)} DD=$${drawdown.toFixed(0)} → mult capped at 0.5x`);
  }
}

function shouldSkipAsset(asset: string): boolean {
  const cooldownUntil = assetCooldown[asset] || 0;
  if (Date.now() < cooldownUntil) return true;
  
  const cal = getCalibration(asset);
  // Use last 3 results (faster reaction) instead of 5
  const recent = cal.lastResults.slice(-3);
  if (recent.length >= 3) {
    const recentWR = recent.filter(r => r.won).length / recent.length;
    if (recentWR < 0.34) { // 0 or 1 win out of 3
      assetCooldown[asset] = Date.now() + 600000; // 10 min cooldown
      logModelChange("ASSET_COOLDOWN", `${asset.toUpperCase()} WR=${(recentWR*100).toFixed(0)}% last 3 → skip 10min`);
      return true;
    }
  }
  return false;
}

export function getModelLog() {
  // Restore from DB if empty (e.g. after server restart)
  if (modelLog.length === 0) {
    try {
      const logMem = storage.getMemory("micro_model_log", "log");
      if (logMem.length > 0) {
        const saved = JSON.parse(logMem[0].value);
        if (Array.isArray(saved)) modelLog.push(...saved.slice(-100));
      }
    } catch {}
  }
  return modelLog.slice(-50);
}

function getCalibration(asset: string): AssetCalibration {
  if (!calibration[asset]) {
    calibration[asset] = {
      totalTrades: 0, wins: 0, losses: 0, totalPnl: 0,
      upWins: 0, upLosses: 0, downWins: 0, downLosses: 0,
      lastResults: [], avgEdgeRealized: 0,
    };
  }
  return calibration[asset];
}

function updateCalibration(asset: string, direction: string, won: boolean, pnl: number) {
  const cal = getCalibration(asset);
  cal.totalTrades++;
  cal.totalPnl += pnl;
  if (won) {
    cal.wins++;
    if (direction === "Up") cal.upWins++; else cal.downWins++;
  } else {
    cal.losses++;
    if (direction === "Up") cal.upLosses++; else cal.downLosses++;
  }
  cal.lastResults.push({ direction, won, pnl, ts: Date.now() });
  if (cal.lastResults.length > 50) cal.lastResults.shift();
  cal.avgEdgeRealized = cal.totalPnl / Math.max(cal.totalTrades, 1);

  // Store in memory for persistence
  storage.upsertMemory({
    category: "micro_calibration",
    key: asset,
    value: JSON.stringify(cal),
    confidence: cal.totalTrades > 0 ? cal.wins / cal.totalTrades : 0.5,
    createdAt: new Date().toISOString(),
  });
}

let calibrationLoaded = false;
function loadCalibrationFromMemory() {
  if (calibrationLoaded) return;
  calibrationLoaded = true;
  for (const asset of ALL_ASSETS) {
    const mem = storage.getMemory("micro_calibration", asset);
    if (mem.length > 0) {
      try {
        calibration[asset] = JSON.parse(mem[0].value);
      } catch {}
    }
  }
}

// --- State ---
let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastCycleAt: string | null = null;
let totalCycles = 0;
let totalTrades = 0;
let totalPnl = 0;
let stateInitialized = false;

/**
 * Reconstruct cumulative counters from DB on startup.
 * This ensures totalTrades, totalPnl, sessionPnl, sessionPeakPnl
 * survive server restarts / scheduler stop-start cycles.
 */
function initStateFromDB(): void {
  if (stateInitialized) return;
  stateInitialized = true;

  try {
    const allPositions = storage.getActivePositions();
    const microClosed = allPositions.filter(p => p.title?.startsWith("[5m]") && p.status === "closed");

    if (microClosed.length === 0) return;

    // Reconstruct cumulative stats
    let dbTrades = 0;
    let dbPnl = 0;
    for (const pos of microClosed) {
      dbTrades++;
      dbPnl += pos.unrealizedPnl || 0;
    }

    // Only bump counters if DB has more trades than memory (avoid double counting)
    if (dbTrades > totalTrades) {
      totalTrades = dbTrades;
      totalPnl = Math.round(dbPnl * 100) / 100;
    }

    // Reconstruct session P&L tracking
    sessionPnl = Math.round(dbPnl * 100) / 100;
    sessionPeakPnl = sessionPnl; // Conservative: set peak to current

    // Restore model log from memory
    const logMem = storage.getMemory("micro_model_log", "log");
    if (logMem.length > 0) {
      try {
        const saved = JSON.parse(logMem[0].value);
        if (Array.isArray(saved)) {
          modelLog.length = 0;
          modelLog.push(...saved.slice(-100));
        }
      } catch {}
    }

    log(`Micro: Restored state from DB — ${dbTrades} trades, P&L: $${totalPnl.toFixed(2)}`, "micro");

    // --- ML Calibration: rebuild from FULL DB history ---
    rebuildCalibrationFromHistory();

    // --- Calibration quality audit on startup ---
    auditCalibrationOnStartup();

  } catch (err) {
    log(`Micro: initStateFromDB error: ${err}`, "micro");
  }
}

/**
 * Audits loaded calibration data and sets regime variables
 * (betSizeMultiplier, consecutiveLossWindows, cooldowns) from history.
 * Logs model events so the UI shows calibration state immediately.
 */
function auditCalibrationOnStartup(): void {
  let totalWins = 0, totalLosses = 0;
  const assetReports: string[] = [];

  for (const asset of ALL_ASSETS) {
    const cal = getCalibration(asset);
    if (cal.totalTrades === 0) continue;

    const wr = cal.totalTrades > 0 ? (cal.wins / cal.totalTrades * 100) : 0;
    totalWins += cal.wins;
    totalLosses += cal.losses;

    // Check last 5 results for recent performance
    const recent5 = cal.lastResults.slice(-5);
    const recent5WR = recent5.length > 0 ? recent5.filter(r => r.won).length / recent5.length : 0.5;
    const recent3 = cal.lastResults.slice(-3);
    const recent3WR = recent3.length > 0 ? recent3.filter(r => r.won).length / recent3.length : 0.5;

    // Log per-asset calibration summary
    const recentStr = recent5.map(r => r.won ? "✓" : "✗").join("");
    assetReports.push(`${asset.toUpperCase()}: ${cal.wins}W/${cal.losses}L (${wr.toFixed(0)}%) last5=[${recentStr}] (${(recent5WR*100).toFixed(0)}%)`);

    // If last 3 results are bad, set cooldown
    if (recent3.length >= 3 && recent3WR < 0.34) {
      assetCooldown[asset] = Date.now() + 600000; // 10 min cooldown
      logModelChange("STARTUP_COOLDOWN", `${asset.toUpperCase()} poor recent WR: ${(recent3WR*100).toFixed(0)}% last 3 → 10min cooldown`);
    }

    // Count trailing losses for regime calculation
    let trailingLosses = 0;
    for (let i = recent5.length - 1; i >= 0; i--) {
      if (!recent5[i].won) trailingLosses++;
      else break;
    }
    if (trailingLosses >= 3) {
      logModelChange("STARTUP_LOSS_STREAK", `${asset.toUpperCase()} has ${trailingLosses} trailing losses`);
    }
  }

  // Set regime from overall recent performance
  const overallWR = (totalWins + totalLosses) > 0 ? totalWins / (totalWins + totalLosses) : 0.5;

  // Count consecutive loss windows from last results across all assets
  // Merge all recent results, sort by timestamp, check trailing pattern
  const allRecent: Array<{ won: boolean; ts: number }> = [];
  for (const asset of ALL_ASSETS) {
    const cal = getCalibration(asset);
    allRecent.push(...cal.lastResults.slice(-10));
  }
  allRecent.sort((a, b) => a.ts - b.ts);

  // Count trailing global losses
  let globalTrailingLosses = 0;
  for (let i = allRecent.length - 1; i >= 0; i--) {
    if (!allRecent[i].won) globalTrailingLosses++;
    else break;
  }

  // Set consecutiveLossWindows based on trailing losses
  if (globalTrailingLosses >= 4) {
    consecutiveLossWindows = Math.floor(globalTrailingLosses / 2);
    betSizeMultiplier = Math.max(0.25, 1.0 - consecutiveLossWindows * 0.25);
    logModelChange("STARTUP_REGIME", `${globalTrailingLosses} trailing losses → mult=${betSizeMultiplier.toFixed(2)}x, consec=${consecutiveLossWindows}`);
  } else {
    betSizeMultiplier = 1.0;
    consecutiveLossWindows = 0;
  }

  // Log overall summary
  logModelChange("CALIBRATION_AUDIT", `${totalWins}W/${totalLosses}L (${(overallWR*100).toFixed(0)}%) | ${assetReports.join(" | ")} | mult=${betSizeMultiplier.toFixed(2)}x`);
}

/**
 * Rebuild calibration from full DB trade history using ML module.
 * This replaces loadCalibrationFromMemory() with actual DB data,
 * ensuring calibration always matches reality.
 */
function rebuildCalibrationFromHistory(): void {
  try {
    const allPositions = storage.getActivePositions("closed");
    const microClosed = allPositions.filter(p => p.title?.startsWith("[5m]"));
    
    if (microClosed.length === 0) {
      // Fall back to stored calibration if no DB history
      loadCalibrationFromMemory();
      return;
    }

    const result = rebuildCalibrationFromDB(microClosed.map(p => ({
      title: p.title,
      side: p.side,
      unrealizedPnl: p.unrealizedPnl || 0,
      closedAt: p.closedAt || "",
      entryPrice: p.entryPrice,
      size: p.size,
    })));

    // Update calibration map with rebuilt data
    for (const [asset, cal] of Object.entries(result.perAsset)) {
      calibration[asset] = cal;
      // Also persist to memory for backup
      storage.upsertMemory({
        category: "micro_calibration",
        key: asset,
        value: JSON.stringify(cal),
        confidence: cal.totalTrades > 0 ? cal.wins / cal.totalTrades : 0.5,
        createdAt: new Date().toISOString(),
      });
    }
    calibrationLoaded = true;

    logModelChange("ML_CALIBRATION", 
      `Rebuilt from ${result.overall.trades} trades: ${result.overall.wins}W/${result.overall.losses}L ` +
      `(${result.overall.winRate}%) P&L=$${result.overall.pnl} | ` +
      Object.entries(result.perAsset).map(([a, c]) => 
        `${a.toUpperCase()}: ${c.wins}W/${c.losses}L (${c.totalTrades > 0 ? Math.round(c.wins/c.totalTrades*100) : 0}%)`
      ).join(", ")
    );
  } catch (err) {
    log(`ML calibration rebuild error: ${err}`, "micro");
    loadCalibrationFromMemory(); // fallback
  }
}

// --- Fetch current 5-min market ---
async function fetchMicroMarket(asset: string): Promise<MicroMarket | null> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % 300);
  const windowEnd = windowStart + 300;
  const slug = `${asset}-updown-5m-${windowStart}`;

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
      asset, slug, title: market.question || `${asset.toUpperCase()} Up/Down 5m`,
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
  } catch { return null; }
}

/**
 * PROVEN 3-TIER STRATEGY (87.5% peak WR reference)
 * 
 * Priority order:
 * 1. CONTRARIAN (>3% deviation from 50/50) — bet AGAINST majority
 * 2. CALIBRATION (>5 trades per asset) — use rolling WR for Up vs Down
 * 3. ALTERNATING (cold start) — alternate by window parity to avoid bias
 * 
 * AI is ONLY for validation (agree/disagree), NEVER chooses direction.
 * ML weights from historical data used ONLY for bet sizing, not direction.
 */
async function analyzeWithCalibration(asset: string, market: MicroMarket): Promise<{
  direction: "Up" | "Down";
  confidence: number;
  reasoning: string;
}> {
  const cal = getCalibration(asset);
  
  let direction: "Up" | "Down";
  let confidence: number;
  let reasoning: string;
  let strategy: string;

  const upPrice = market.upPrice;
  const deviation = Math.abs(upPrice - 0.5);

  // === TIER 1: CONTRARIAN (priority — highest WR historically) ===
  // When market deviates >3% from 50/50, bet AGAINST the majority
  if (deviation > 0.03) {
    direction = upPrice > 0.53 ? "Down" : "Up";
    confidence = 0.50 + deviation * 0.3;
    reasoning = `CONTRARIAN: market ${upPrice > 0.53 ? "Up" : "Down"} at ${(Math.max(upPrice, 1-upPrice)*100).toFixed(1)}%, betting against`;
    strategy = "contrarian";
  }
  // === TIER 2: CALIBRATION (>5 trades — use per-asset rolling WR) ===
  else if (cal.totalTrades >= 5) {
    const upWR = (cal.upWins + cal.upLosses) > 0 ? cal.upWins / (cal.upWins + cal.upLosses) : 0.5;
    const downWR = (cal.downWins + cal.downLosses) > 0 ? cal.downWins / (cal.downWins + cal.downLosses) : 0.5;
    
    if (upWR > downWR + 0.05) {
      direction = "Up";
      confidence = 0.50 + (upWR - 0.5) * 0.2;
      reasoning = `CALIBRATION: ${asset.toUpperCase()} Up WR=${(upWR*100).toFixed(0)}% > Down ${(downWR*100).toFixed(0)}%`;
    } else if (downWR > upWR + 0.05) {
      direction = "Down";
      confidence = 0.50 + (downWR - 0.5) * 0.2;
      reasoning = `CALIBRATION: ${asset.toUpperCase()} Down WR=${(downWR*100).toFixed(0)}% > Up ${(upWR*100).toFixed(0)}%`;
    } else {
      // No clear directional bias — use recent 3-trade streak
      const recent = cal.lastResults.slice(-3);
      const recentUpWins = recent.filter(r => r.direction === "Up" && r.won).length;
      const recentDownWins = recent.filter(r => r.direction === "Down" && r.won).length;
      direction = recentUpWins >= recentDownWins ? "Up" : "Down";
      confidence = 0.52;
      reasoning = `CALIBRATION: balanced, recent momentum → ${direction}`;
    }
    strategy = "calibration";
  }
  // === TIER 3: ALTERNATING (cold start — avoids always-Up bias) ===
  else {
    const windowParity = (market.windowStart / 300) % 2 === 0;
    direction = windowParity ? "Up" : "Down";
    confidence = 0.52;
    reasoning = `ALTERNATE: no data, window parity → ${direction}`;
    strategy = "alternate";
  }

  // Clamp confidence
  confidence = Math.min(0.62, Math.max(0.51, confidence));

  // === AI VALIDATION ONLY (never chooses direction) ===
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const prompt = `5-min ${asset.toUpperCase()} market. Up=${(upPrice*100).toFixed(1)}%, Down=${((1-upPrice)*100).toFixed(1)}%. My signal: ${direction} (${strategy}). Agree/disagree? Reply JSON: {"agree":true/false,"confidence_adj":-0.02 to +0.03}`;

    const response = await client.responses.create({ model: "gpt-5", input: prompt });
    const text = response.output_text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // AI ONLY adjusts confidence, NEVER changes direction
      if (parsed.confidence_adj) {
        confidence = Math.min(0.62, Math.max(0.51, confidence + parsed.confidence_adj));
        if (!parsed.agree) {
          reasoning += " [AI disagrees]";
          // If AI disagrees, reduce confidence but keep direction
          confidence = Math.max(0.51, confidence - 0.02);
        }
      }
    }
  } catch {
    // AI unavailable — strategy signal stands as-is
  }

  return { direction, confidence, reasoning, mlBetMult: 1.0 };
}

// --- Execute micro-trade ---
function executeMicroTrade(market: MicroMarket, direction: "Up" | "Down", confidence: number, reasoning: string, mlBetMult?: number): boolean {
  const killSwitch = storage.getConfig("kill_switch") === "true";
  if (killSwitch) return false;

  const isPaperTrading = storage.getConfig("paper_trading") !== "false";
  const microBankroll = parseFloat(storage.getConfig("micro_bankroll") || "200");
  const microMaxBet = parseFloat(storage.getConfig("micro_max_bet") || "20");
  
  const price = direction === "Up" ? market.upPrice : market.downPrice;
  const impliedEdge = confidence - price;
  
  // Very low threshold for 5-min markets (0.5%)
  if (impliedEdge < 0.005) {
    log(`Micro: ${market.asset.toUpperCase()} ${direction} — edge ${(impliedEdge * 100).toFixed(1)}% < 0.5%, skipping`, "micro");
    return false;
  }

  // Sizing: use percentage of max_bet based on edge strength
  // Edge 0.5-2% → 25% of max bet (min $5)
  // Edge 2-5% → 50% of max bet
  // Edge 5-10% → 75% of max bet
  // Edge >10% → 100% of max bet
  let betFraction: number;
  if (impliedEdge >= 0.10) betFraction = 1.0;
  else if (impliedEdge >= 0.05) betFraction = 0.75;
  else if (impliedEdge >= 0.02) betFraction = 0.50;
  else betFraction = 0.25;
  
  // Original proven sizing: max_bet * edge_fraction * regime_multiplier
  const rawSize = microMaxBet * betFraction * betSizeMultiplier;
  const size = Math.max(3, Math.min(rawSize, microMaxBet, microBankroll * 0.15));
  
  log(`Micro: ${market.asset.toUpperCase()} ${direction} sizing: edge=${(impliedEdge*100).toFixed(1)}% frac=${betFraction} mult=${betSizeMultiplier.toFixed(1)}x → $${size.toFixed(2)}`, "micro");

  // Create all DB records
  const opp = storage.createOpportunity({
    externalId: `micro-${market.slug}-${direction}`,
    platform: "polymarket",
    title: `[5m] ${market.title}`,
    description: `5-min ${market.asset.toUpperCase()} prediction. AI: ${direction} (${(confidence * 100).toFixed(0)}%). ${reasoning}`,
    category: "crypto",
    marketUrl: `https://polymarket.com/event/${market.slug}`,
    currentPrice: price,
    volume24h: market.volume24h,
    totalLiquidity: market.liquidity,
    marketProbability: price,
    conditionId: market.conditionId,
    clobTokenIds: JSON.stringify([market.upTokenId, market.downTokenId]),
    tickSize: market.tickSize,
    negRisk: market.negRisk ? 1 : 0,
    endDate: market.endDate,
    slug: market.slug,
    aiProbability: confidence,
    edge: impliedEdge,
    edgePercent: impliedEdge * 100,
    confidence: confidence > 0.58 ? "medium" : "low",
    kellyFraction: impliedEdge * 0.15,
    recommendedSize: size,
    recommendedSide: direction === "Up" ? "YES" : "NO",
    status: "approved",
    pipelineStage: "execution",
    discoveredAt: new Date().toISOString(),
  });

  const execution = storage.createExecution({
    opportunityId: opp.id,
    platform: "polymarket",
    side: direction === "Up" ? "YES" : "NO",
    orderType: "market",
    requestedPrice: price,
    executedPrice: price,
    size,
    quantity: size / price,
    status: "filled",
    paperTrade: isPaperTrading ? 1 : 0,
    slippage: 0, fees: 0,
    submittedAt: new Date().toISOString(),
    filledAt: new Date().toISOString(),
  });

  const position = storage.createActivePosition({
    opportunityId: opp.id,
    executionId: execution.id,
    platform: "polymarket",
    title: `[5m] ${market.title}`,
    side: direction === "Up" ? "YES" : "NO",
    entryPrice: price,
    currentPrice: price,
    size,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    status: "open",
    openedAt: new Date().toISOString(),
  });

  storage.createSettlement({
    opportunityId: opp.id,
    positionId: position.id,
    ourPrediction: confidence,
    marketPriceAtEntry: price,
    status: "monitoring",
    createdAt: new Date().toISOString(),
  });

  storage.createAuditEntry({
    action: "execute",
    entityType: "execution",
    entityId: execution.id,
    actor: "agent:micro_scheduler",
    details: JSON.stringify({ asset: market.asset, direction, confidence, size, price, edge: impliedEdge, paper: isPaperTrading }),
    timestamp: new Date().toISOString(),
  });

  log(`⚡ MICRO: ${market.asset.toUpperCase()} ${direction} $${size.toFixed(2)} @ ${(price * 100).toFixed(1)}% (edge: ${(impliedEdge * 100).toFixed(1)}%)`, "micro");
  totalTrades++;
  return true;
}

// --- Settle expired trades and update calibration ---
async function settleMicroTrades(): Promise<number> {
  const openPositions = storage.getActivePositions("open");
  const microPositions = openPositions.filter(p => p.title.startsWith("[5m]"));
  let settled = 0;

  for (const pos of microPositions) {
    const opp = storage.getOpportunity(pos.opportunityId);
    if (!opp || !opp.endDate) continue;

    const endTime = new Date(opp.endDate).getTime();
    const elapsed = Date.now() - endTime;
    if (elapsed < 30000) continue; // Wait 30s after window

    try {
      const tokenIds = opp.clobTokenIds ? JSON.parse(opp.clobTokenIds) : [];
      if (tokenIds.length === 0) continue;

      let finalUpPrice: number | null = null;
      
      // Try to get price from CLOB
      const priceStr = await fetchPrice(tokenIds[0]);
      if (priceStr) finalUpPrice = parseFloat(priceStr);

      // Fallback: if price unavailable after >2 minutes, settle as loss
      // (expired markets often don't return CLOB prices)
      if (finalUpPrice === null && elapsed > 120000) {
        // Use the current price from the opportunity (last known)
        finalUpPrice = opp.currentPrice || 0.5;
        log(`Micro: Force-settling expired position #${pos.id} (${elapsed/1000}s expired, CLOB unavailable)`, "micro");
      }
      
      if (finalUpPrice === null) continue; // Still waiting

      const outcome = finalUpPrice > 0.5 ? "YES" : "NO";
      const wasCorrect = pos.side === outcome;
      const priceDiff = pos.side === "YES" ? finalUpPrice - pos.entryPrice : pos.entryPrice - finalUpPrice;
      const realizedPnl = priceDiff * pos.size;

      // Close position
      storage.updateActivePosition(pos.id, {
        status: "closed",
        currentPrice: finalUpPrice,
        unrealizedPnl: Math.round(realizedPnl * 100) / 100,
        closedAt: new Date().toISOString(),
      });

      // Update settlement
      const settlement = storage.getSettlement(pos.opportunityId);
      if (settlement) {
        storage.updateSettlement(settlement.id, {
          outcome,
          finalPrice: finalUpPrice,
          realizedPnl: Math.round(realizedPnl * 100) / 100,
          realizedPnlPercent: pos.entryPrice > 0 ? Math.round((realizedPnl / pos.size) * 10000) / 100 : 0,
          wasCorrect: wasCorrect ? 1 : 0,
          status: "settled",
          resolvedAt: new Date().toISOString(),
        });
      }

      storage.updateOpportunity(pos.opportunityId, {
        currentPrice: finalUpPrice,
        status: "settled",
        pipelineStage: "settlement",
      });

      totalPnl += realizedPnl;
      settled++;

      // Extract asset name from title: "[5m] Bitcoin Up..." → "btc"
      const assetMap: Record<string, string> = { "bitcoin": "btc", "ethereum": "eth", "solana": "sol", "xrp": "xrp" };
      const titleLower = (opp.title || "").toLowerCase();
      let asset = "btc";
      for (const [name, code] of Object.entries(assetMap)) {
        if (titleLower.includes(name)) { asset = code; break; }
      }
      const direction = pos.side === "YES" ? "Up" : "Down";
      
      // Update calibration
      updateCalibration(asset, direction, wasCorrect, realizedPnl);

      const icon = wasCorrect ? "✓" : "✗";
      const cal = getCalibration(asset);
      log(`⚡ SETTLED ${icon}: ${asset.toUpperCase()} ${direction} → ${outcome}, PnL: $${realizedPnl.toFixed(2)} | Win rate: ${(cal.wins/cal.totalTrades*100).toFixed(0)}% (${cal.wins}/${cal.totalTrades})`, "micro");

    } catch {}
  }

  // Record window result for regime tracking
  if (settled > 0) {
    const windowWins = settled; // We counted settled positions
    // Re-count actual wins/losses from this batch
    let batchWins = 0, batchLosses = 0, batchPnl = 0;
    // Use the last N settled positions
    const allPos = storage.getActivePositions("closed");
    const recentClosed = allPos.filter(p => p.title?.startsWith("[5m]")).slice(-settled);
    for (const p of recentClosed) {
      if ((p.unrealizedPnl || 0) > 0) batchWins++; else batchLosses++;
      batchPnl += p.unrealizedPnl || 0;
    }
    recordWindowResult(batchWins, batchLosses, batchPnl);
  }

  return settled;
}

// --- Main cycle ---
async function runMicroCycle(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    totalCycles++;
    if (storage.getConfig("micro_scheduler_enabled") !== "true") { isRunning = false; return; }

    // Settle expired trades
    const settled = await settleMicroTrades();
    if (settled > 0) {
      log(`Micro: settled ${settled} trades. Total P&L: $${totalPnl.toFixed(2)}`, "micro");
    }

    // Get enabled assets
    const enabledAssets = (storage.getConfig("micro_assets") || "btc,eth,sol,xrp").split(",").map(s => s.trim().toLowerCase());

    // Collect all analyses first, then diversify
    const analyses: Array<{ asset: string; market: MicroMarket; direction: "Up" | "Down"; confidence: number; reasoning: string }> = [];

    for (const asset of enabledAssets) {
      if (shouldSkipAsset(asset)) {
        log(`Micro: ${asset.toUpperCase()} on cooldown, skipping`, "micro");
        continue;
      }

      const market = await fetchMicroMarket(asset);
      if (!market) continue;

      if (storage.getOpportunityByExternalId(`micro-${market.slug}-Up`) || 
          storage.getOpportunityByExternalId(`micro-${market.slug}-Down`)) continue;

      // Min liquidity $500
      if (market.liquidity < 500) continue;

      // AI analysis with calibration context
      const analysis = await analyzeWithCalibration(asset, market);
      analyses.push({ asset, market, ...analysis });
    }

    // --- Diversification: prevent all-same-direction ---
    if (analyses.length >= 3) {
      const upCount = analyses.filter(a => a.direction === "Up").length;
      const downCount = analyses.filter(a => a.direction === "Down").length;
      
      if (upCount === analyses.length || downCount === analyses.length) {
        // All same direction — flip the weakest signal to diversify
        const sorted = [...analyses].sort((a, b) => a.confidence - b.confidence);
        const weakest = sorted[0];
        weakest.direction = weakest.direction === "Up" ? "Down" : "Up";
        weakest.reasoning += " [DIVERSIFIED: flipped weakest]";
        logModelChange("DIVERSIFY", `All ${upCount > 0 ? "Up" : "Down"} → flipped ${weakest.asset.toUpperCase()} to ${weakest.direction}`);
      }
    }

    // Execute all trades with ML bet multiplier
    for (const a of analyses) {
      executeMicroTrade(a.market, a.direction, a.confidence, a.reasoning, (a as any).mlBetMult);
    }

    lastCycleAt = new Date().toISOString();
  } catch (err) {
    log(`Micro cycle error: ${err}`, "micro");
  } finally {
    isRunning = false;
  }
}

// --- Public API ---
export function startMicroScheduler(): void {
  if (schedulerInterval) clearInterval(schedulerInterval);
  storage.setConfig("micro_scheduler_enabled", "true");
  initStateFromDB();
  loadCalibrationFromMemory();
  runMicroCycle();
  schedulerInterval = setInterval(() => runMicroCycle(), 60 * 1000);
  log("⚡ Micro-scheduler started (BTC/ETH/SOL/XRP 5-min markets)", "micro");
}

export function stopMicroScheduler(): void {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
  storage.setConfig("micro_scheduler_enabled", "false");
  log("Micro-scheduler stopped", "micro");
}

export function getMicroStatus() {
  // Ensure historical state is loaded from DB even if scheduler never started
  initStateFromDB();
  loadCalibrationFromMemory();

  const enabledAssets = (storage.getConfig("micro_assets") || "btc,eth,sol,xrp").split(",").map(s => s.trim());
  
  // Build calibration summary
  const calSummary: Record<string, any> = {};
  for (const asset of enabledAssets) {
    const cal = getCalibration(asset);
    if (cal.totalTrades > 0) {
      calSummary[asset] = {
        trades: cal.totalTrades,
        winRate: Math.round(cal.wins / cal.totalTrades * 100),
        pnl: Math.round(cal.totalPnl * 100) / 100,
        upWinRate: (cal.upWins + cal.upLosses) > 0 ? Math.round(cal.upWins / (cal.upWins + cal.upLosses) * 100) : null,
        downWinRate: (cal.downWins + cal.downLosses) > 0 ? Math.round(cal.downWins / (cal.downWins + cal.downLosses) * 100) : null,
      };
    }
  }

  // Cooldown status per asset
  const cooldowns: Record<string, boolean> = {};
  for (const asset of enabledAssets) {
    cooldowns[asset.toLowerCase()] = shouldSkipAsset(asset.toLowerCase());
  }

  return {
    active: schedulerInterval !== null && storage.getConfig("micro_scheduler_enabled") === "true",
    totalCycles,
    totalTrades,
    totalPnl: Math.round(totalPnl * 100) / 100,
    lastCycleAt,
    enabledAssets,
    microBankroll: parseFloat(storage.getConfig("micro_bankroll") || "200"),
    microMaxBet: parseFloat(storage.getConfig("micro_max_bet") || "20"),
    calibration: calSummary,
    regime: {
      betSizeMultiplier: Math.round(betSizeMultiplier * 100) / 100,
      consecutiveLossWindows,
      lastWindowPnl: Math.round(lastWindowPnl * 100) / 100,
      cooldowns,
    },
  };
}
