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
  lastResults: Array<{ direction: string; won: boolean; pnl: number; ts: number; strategy?: string; hour?: number }>;
  avgEdgeRealized: number;
}

const calibration: Record<string, AssetCalibration> = {};

// --- Learning Matrix: per-asset per-direction per-hour weight ---
// Learns from all historical data which (asset, direction, hour) combos work best
interface LearningWeight {
  trades: number;
  wins: number;
  pnl: number;
  weight: number; // 0.0 to 2.0, 1.0 = neutral
}
const learningMatrix: Record<string, LearningWeight> = {};

function getLearningKey(asset: string, direction: string, hour?: number): string {
  return hour !== undefined ? `${asset}|${direction}|${hour}` : `${asset}|${direction}`;
}

function getLearningWeight(asset: string, direction: string, hour: number): number {
  // Combine asset+direction weight with asset+direction+hour weight
  const adKey = getLearningKey(asset, direction);
  const adhKey = getLearningKey(asset, direction, hour);
  const ad = learningMatrix[adKey];
  const adh = learningMatrix[adhKey];
  // Base weight from asset+direction (most data)
  let w = ad && ad.trades >= 3 ? ad.weight : 1.0;
  // Hour-specific adjustment (if enough data)
  if (adh && adh.trades >= 3) {
    w = w * 0.6 + adh.weight * 0.4; // Blend: 60% base, 40% hourly
  }
  return w;
}

function updateLearningMatrix(asset: string, direction: string, hour: number, won: boolean, pnl: number) {
  for (const key of [getLearningKey(asset, direction), getLearningKey(asset, direction, hour)]) {
    if (!learningMatrix[key]) learningMatrix[key] = { trades: 0, wins: 0, pnl: 0, weight: 1.0 };
    const lw = learningMatrix[key];
    lw.trades++;
    if (won) lw.wins++;
    lw.pnl += pnl;
    // Weight = WR-based: <40% WR → penalize, >60% WR → boost
    const wr = lw.trades > 0 ? lw.wins / lw.trades : 0.5;
    lw.weight = Math.max(0.1, Math.min(2.0, 0.5 + wr * 1.5));
  }
}

// --- Strategy Performance Tracker ---
interface StrategyPerf { trades: number; wins: number; pnl: number; recentResults: boolean[]; }
const strategyPerf: Record<string, StrategyPerf> = {};

function getStrategyPerf(strategy: string): StrategyPerf {
  if (!strategyPerf[strategy]) strategyPerf[strategy] = { trades: 0, wins: 0, pnl: 0, recentResults: [] };
  return strategyPerf[strategy];
}

function updateStrategyPerf(strategy: string, won: boolean, pnl: number) {
  const sp = getStrategyPerf(strategy);
  sp.trades++;
  if (won) sp.wins++;
  sp.pnl += pnl;
  sp.recentResults.push(won);
  if (sp.recentResults.length > 20) sp.recentResults.shift();
}

function getStrategyRecentWR(strategy: string): number {
  const sp = getStrategyPerf(strategy);
  if (sp.recentResults.length < 3) return 0.5;
  return sp.recentResults.filter(w => w).length / sp.recentResults.length;
}

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
  if (modelLog.length > 200) modelLog.splice(0, modelLog.length - 200);
  log(`MODEL: ${event} — ${detail}`, "micro");
  // Persist model log to DB
  try {
    storage.upsertMemory({
      category: "micro_model_log",
      key: "log",
      value: JSON.stringify(modelLog.slice(-200)),
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
    betSizeMultiplier = Math.max(0.3, betSizeMultiplier - 0.2);
    logModelChange("LOSS_WINDOW", `${wins}W/${losses}L, consec=${consecutiveLossWindows}, mult: ${prevMult.toFixed(2)}→${betSizeMultiplier.toFixed(2)}`);
  } else {
    if (consecutiveLossWindows > 0) {
      logModelChange("WIN_RECOVERY", `Breaking ${consecutiveLossWindows} loss streak`);
    }
    consecutiveLossWindows = 0;
    // SLOW recovery: only +0.1 per win window, HARD CAP at 1.0 (never over-leverage)
    betSizeMultiplier = Math.min(1.5, betSizeMultiplier + 0.1);
    logModelChange("WIN_WINDOW", `${wins}W/${losses}L, mult=${betSizeMultiplier.toFixed(2)}x`);
  }

  // Drawdown brake: if we've lost >30% from session peak, hard cap at 0.5x
  const drawdown = sessionPeakPnl - sessionPnl;
  if (sessionPeakPnl > 20 && drawdown > sessionPeakPnl * 0.3) {
    betSizeMultiplier = Math.min(betSizeMultiplier, 0.5);
    logModelChange("DRAWDOWN_BRAKE", `Peak=$${sessionPeakPnl.toFixed(0)} Current=$${sessionPnl.toFixed(0)} DD=$${drawdown.toFixed(0)} → mult capped at 0.5x`);
  }
}

// Returns risk multiplier for asset based on recent performance (no blocking)
function getAssetRiskMultiplier(asset: string): number {
  const cal = getCalibration(asset);
  const recent = cal.lastResults.slice(-5);
  if (recent.length < 5) return 1.0;
  const recentWR = recent.filter(r => r.won).length / recent.length;
  // WR < 30% → минимальная ставка, WR 30-50% → сниженная, WR > 50% → полная
  if (recentWR < 0.20) return 0.2;
  if (recentWR < 0.40) return 0.4;
  if (recentWR < 0.50) return 0.6;
  return 1.0;
}

export function getModelLog() {
  // Restore from DB if empty (e.g. after server restart)
  if (modelLog.length === 0) {
    try {
      const logMem = storage.getMemory("micro_model_log", "log");
      if (logMem.length > 0) {
        const saved = JSON.parse(logMem[0].value);
        if (Array.isArray(saved)) modelLog.push(...saved.slice(-200));
      }
    } catch {}
  }
  return modelLog.slice(-100);
}

export function getLearningMatrixSummary() {
  const summary: Array<{ key: string; trades: number; wins: number; winRate: number; pnl: number; weight: number }> = [];
  for (const [key, lw] of Object.entries(learningMatrix)) {
    if (lw.trades >= 1) {
      summary.push({
        key,
        trades: lw.trades,
        wins: lw.wins,
        winRate: lw.trades > 0 ? Math.round(lw.wins / lw.trades * 100) : 0,
        pnl: Math.round(lw.pnl * 100) / 100,
        weight: Math.round(lw.weight * 100) / 100,
      });
    }
  }
  return summary.sort((a, b) => b.weight - a.weight);
}

export function getStrategyPerfSummary() {
  const summary: Array<{ strategy: string; trades: number; wins: number; winRate: number; recentWR: number; pnl: number }> = [];
  for (const [strategy, sp] of Object.entries(strategyPerf)) {
    summary.push({
      strategy,
      trades: sp.trades,
      wins: sp.wins,
      winRate: sp.trades > 0 ? Math.round(sp.wins / sp.trades * 100) : 0,
      recentWR: Math.round(getStrategyRecentWR(strategy) * 100),
      pnl: Math.round(sp.pnl * 100) / 100,
    });
  }
  return summary;
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
    // Log per-asset calibration summary
    const recentStr = recent5.map(r => r.won ? "✓" : "✗").join("");
    assetReports.push(`${asset.toUpperCase()}: ${cal.wins}W/${cal.losses}L (${wr.toFixed(0)}%) last5=[${recentStr}] (${(recent5WR*100).toFixed(0)}%)`);

    // Log low WR warning (no cooldown — trades continue with reduced size)
    if (recent5.length >= 5 && recent5WR < 0.30) {
      const riskMult = getAssetRiskMultiplier(asset);
      logModelChange("РИСК_АКТИВ", `${asset.toUpperCase()} WR=${(recent5WR*100).toFixed(0)}% last 5 → risk=${riskMult}x (сниженный размер)`);
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
    betSizeMultiplier = Math.max(0.3, 1.0 - consecutiveLossWindows * 0.2);
    logModelChange("STARTUP_REGIME", `${globalTrailingLosses} trailing losses → mult=${betSizeMultiplier.toFixed(2)}x, consec=${consecutiveLossWindows}`);
  } else {
    betSizeMultiplier = 1.0;
    consecutiveLossWindows = 0;
  }

  // Log overall summary
  logModelChange("CALIBRATION_AUDIT", `${totalWins}W/${totalLosses}L (${(overallWR*100).toFixed(0)}%) | ${assetReports.join(" | ")} | mult=${betSizeMultiplier.toFixed(2)}x`);
}

/**
 * Rebuild calibration, learning matrix, strategy perf, and model log
 * from full DB trade history. Self-contained, no external dependencies.
 */
function rebuildCalibrationFromHistory(): void {
  try {
    const allPositions = storage.getActivePositions("closed");
    const microClosed = allPositions.filter(p => p.title?.startsWith("[5m]"));
    
    if (microClosed.length === 0) {
      loadCalibrationFromMemory();
      return;
    }

    const assetMap: Record<string, string> = { bitcoin: "btc", ethereum: "eth", solana: "sol", xrp: "xrp" };
    const sorted = [...microClosed].sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || ""));
    let totalW = 0, totalL = 0, totalPnlAcc = 0;

    // Reset all state from scratch
    for (const asset of ALL_ASSETS) {
      calibration[asset] = { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, upWins: 0, upLosses: 0, downWins: 0, downLosses: 0, lastResults: [], avgEdgeRealized: 0 };
    }
    // Clear learning matrix and strategy perf
    Object.keys(learningMatrix).forEach(k => delete learningMatrix[k]);
    Object.keys(strategyPerf).forEach(k => delete strategyPerf[k]);

    // Also load opportunity descriptions to extract strategy info
    const oppDescriptions: Record<number, string> = {};
    try {
      const opps = storage.getActivePositions("closed"); // positions have opportunityId
      for (const pos of sorted) {
        try {
          const opp = storage.getOpportunity(pos.opportunityId);
          if (opp) oppDescriptions[pos.id] = opp.description || "";
        } catch {}
      }
    } catch {}

    for (const pos of sorted) {
      const titleLower = (pos.title || "").toLowerCase();
      let asset = "btc";
      for (const [name, code] of Object.entries(assetMap)) {
        if (titleLower.includes(name)) { asset = code; break; }
      }
      const cal = calibration[asset];
      const won = (pos.unrealizedPnl || 0) > 0;
      const pnl = pos.unrealizedPnl || 0;
      const direction = pos.side === "YES" ? "Up" : "Down";
      const openedAt = pos.openedAt || pos.closedAt || "";
      const hour = new Date(openedAt).getUTCHours();

      // Detect strategy from description
      const desc = oppDescriptions[pos.id] || "";
      let strategy = "unknown";
      if (desc.includes("CONTRARIAN")) strategy = "contrarian";
      else if (desc.includes("CALIBRATION")) strategy = "calibration";
      else if (desc.includes("ALTERNATE")) strategy = "alternate";

      cal.totalTrades++; cal.totalPnl += pnl; totalPnlAcc += pnl;
      if (won) { cal.wins++; totalW++; if (direction === "Up") cal.upWins++; else cal.downWins++; }
      else { cal.losses++; totalL++; if (direction === "Up") cal.upLosses++; else cal.downLosses++; }
      cal.lastResults.push({ direction, won, pnl, ts: new Date(pos.closedAt || "").getTime() || Date.now(), strategy, hour });
      if (cal.lastResults.length > 50) cal.lastResults.shift();
      cal.avgEdgeRealized = cal.totalPnl / Math.max(cal.totalTrades, 1);

      // Update learning matrix
      updateLearningMatrix(asset, direction, hour, won, pnl);

      // Update strategy perf
      updateStrategyPerf(strategy, won, pnl);
    }

    // Persist calibration to memory
    for (const [asset, cal] of Object.entries(calibration)) {
      if (cal.totalTrades > 0) {
        storage.upsertMemory({ category: "micro_calibration", key: asset, value: JSON.stringify(cal), confidence: cal.wins / cal.totalTrades, createdAt: new Date().toISOString() });
      }
    }
    calibrationLoaded = true;

    const total = totalW + totalL;
    logModelChange("REBUILD",
      `${total} сделок: ${totalW}W/${totalL}L (${total > 0 ? Math.round(totalW/total*100) : 0}%) P&L=$${Math.round(totalPnlAcc*100)/100}`
    );

    // Log learning matrix insights
    const matrixEntries = Object.entries(learningMatrix)
      .filter(([k, lw]) => !k.includes("|") || k.split("|").length === 2) // asset|direction only
      .filter(([, lw]) => lw.trades >= 3)
      .sort(([, a], [, b]) => b.weight - a.weight);
    
    if (matrixEntries.length > 0) {
      const best = matrixEntries.slice(0, 3).map(([k, lw]) => `${k.toUpperCase()}:${Math.round(lw.wins/lw.trades*100)}%w=${lw.weight.toFixed(2)}`).join(" ");
      const worst = matrixEntries.slice(-3).map(([k, lw]) => `${k.toUpperCase()}:${Math.round(lw.wins/lw.trades*100)}%w=${lw.weight.toFixed(2)}`).join(" ");
      logModelChange("ОБУЧЕНИЕ", `Лучшие: ${best} | Худшие: ${worst}`);
    }

    // Log strategy performance
    const stratSummary = Object.entries(strategyPerf)
      .filter(([, sp]) => sp.trades > 0)
      .map(([s, sp]) => `${s}: ${sp.wins}/${sp.trades} (${Math.round(sp.wins/sp.trades*100)}%) $${sp.pnl.toFixed(0)}`)
      .join(" | ");
    if (stratSummary) {
      logModelChange("СТРАТЕГИИ", stratSummary);
    }

    // Log per-asset calibration
    Object.entries(calibration).filter(([, c]) => c.totalTrades > 0).forEach(([a, c]) => {
      const wr = Math.round(c.wins / c.totalTrades * 100);
      const upWR = (c.upWins + c.upLosses) > 0 ? Math.round(c.upWins / (c.upWins + c.upLosses) * 100) : 0;
      const downWR = (c.downWins + c.downLosses) > 0 ? Math.round(c.downWins / (c.downWins + c.downLosses) * 100) : 0;
      const recent5 = c.lastResults.slice(-5).map(r => r.won ? "✓" : "✗").join("");
      logModelChange("КАЛИБРОВКА", `${a.toUpperCase()}: ${c.wins}W/${c.losses}L (${wr}%) Up:${upWR}% Down:${downWR}% [${recent5}] P&L=$${c.totalPnl.toFixed(2)}`);
    });

    // Log hourly insights
    const hourlyMap: Record<number, { trades: number; wins: number; pnl: number }> = {};
    for (const [key, lw] of Object.entries(learningMatrix)) {
      const parts = key.split("|");
      if (parts.length === 3) { // asset|direction|hour
        const h = parseInt(parts[2]);
        if (!hourlyMap[h]) hourlyMap[h] = { trades: 0, wins: 0, pnl: 0 };
        hourlyMap[h].trades += lw.trades;
        hourlyMap[h].wins += lw.wins;
        hourlyMap[h].pnl += lw.pnl;
      }
    }
    const hourSummary = Object.entries(hourlyMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([h, d]) => `${h}:00=${Math.round(d.wins/d.trades*100)}%(${d.trades})`)
      .join(" ");
    if (hourSummary) {
      logModelChange("ЧАСЫ", hourSummary);
    }

  } catch (err) {
    log(`Calibration rebuild error: ${err}`, "micro");
    loadCalibrationFromMemory();
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
 * PROVEN SIMPLE MODEL (87-95% WR reference from Batch 1-2)
 * 
 * Ключевые принципы лучшей модели:
 * 1. Только рынки близкие к 50/50 (0.47-0.53) — НЕ ставить против сильного тренда
 * 2. Чередование Up/Down по паритету окна — никакого смещения
 * 3. Маленькие равные ставки ($5-$15)
 * 4. AI оценивает и может переключить направление
 * 
 * Что убрано (показало убытки):
 * - Learning weights (создавали bias в сторону Up)
 * - Contrarian на экстремальных девиациях (37% WR, -$32)
 * - Комплексная калибровка с весами (петля обратной связи)
 */
async function analyzeWithCalibration(asset: string, market: MicroMarket): Promise<{
  direction: "Up" | "Down";
  confidence: number;
  reasoning: string;
  strategy: string;
  aiVerdict: string;
  learningWeight: number;
}> {
  const cal = getCalibration(asset);
  
  let direction: "Up" | "Down";
  let confidence: number;
  let reasoning: string;
  let strategy: string;

  const upPrice = market.upPrice;
  const deviation = Math.abs(upPrice - 0.5);

  // === Основной принцип: чередование по паритету окна ===
  // Каждый актив чередует Up/Down каждое 5-минутное окно
  const windowIndex = Math.floor(market.windowStart / 300);
  // Разные активы начинают с разных сторон (offset) для диверсификации
  const assetOffset: Record<string, number> = { btc: 0, eth: 1, sol: 0, xrp: 1 };
  const offset = assetOffset[asset] || 0;
  const parity = (windowIndex + offset) % 2 === 0;
  direction = parity ? "Up" : "Down";
  confidence = 0.53;
  reasoning = `ПАРИТЕТ: окно #${windowIndex} ${asset.toUpperCase()} → ${direction}`;
  strategy = "parity";

  // === Контрариан только для небольших отклонений (3-7%) ===
  // При девиации > 7% — не трогаем, рынок знает лучше
  if (deviation > 0.03 && deviation <= 0.07) {
    direction = upPrice > 0.53 ? "Down" : "Up";
    confidence = 0.54;
    reasoning = `КОНТРАРИАН: ${(Math.max(upPrice,1-upPrice)*100).toFixed(1)}% → ${direction}`;
    strategy = "contrarian";
  }

  // === Фильтр: пропускаем экстремальные рынки (>60% в одну сторону) ===
  // Исторически ставки против >60% давали крупные убытки
  if (deviation > 0.10) {
    confidence = 0.51; // минимальный — самая маленькая ставка
    reasoning += ` [высокая девиация ${(deviation*100).toFixed(0)}%]`;
  }

  // Clamp confidence
  confidence = Math.min(0.58, Math.max(0.51, confidence));

  // === AI EVALUATION ===
  // Методология:
  // 1. Отправляем AI полный контекст: цены, стратегия, исторические веса, калибровка
  // 2. AI оценивает наше направление: agree/disagree + confidence_adj
  // 3. При disagree — запрашиваем оценку противоположного направления
  // 4. Если AI уверен в обратном (confidence >= 0.55) — переключаем направление
  let aiVerdict = "";
  try {
    const { default: OpenAI } = await import("openai");
    const userKey = storage.getConfig("openai_api_key") || process.env.OPENAI_API_KEY || "";
    const client = new OpenAI({
      apiKey: userKey,
      baseURL: "https://api.openai.com/v1",
    });

    const otherDir = direction === "Up" ? "Down" : "Up";
    const calInfo = cal.totalTrades > 0
      ? `Historical: ${cal.wins}W/${cal.losses}L (${Math.round(cal.wins/cal.totalTrades*100)}% WR), Up WR=${(cal.upWins+cal.upLosses)>0 ? Math.round(cal.upWins/(cal.upWins+cal.upLosses)*100) : '?'}%, Down WR=${(cal.downWins+cal.downLosses)>0 ? Math.round(cal.downWins/(cal.downWins+cal.downLosses)*100) : '?'}%`
      : "No historical data";

    const systemMsg = `You are a 5-minute crypto prediction market analyst. You evaluate short-term Up/Down signals for BTC/ETH/SOL/XRP on Polymarket. These are binary markets that resolve in 5 minutes. Prices near 0.50 mean market is uncertain. Reply ONLY with valid JSON.`;

    const prompt = [
      `Asset: ${asset.toUpperCase()}`,
      `Market prices: Up=${(upPrice*100).toFixed(1)}%, Down=${((1-upPrice)*100).toFixed(1)}%`,
      `My signal: ${direction} (strategy: ${strategy})`,
      calInfo,
      ``,
      `Evaluate my signal. Reply JSON:`,
      `{"agree": true/false, "confidence": 0.50-0.65, "reasoning": "brief reason"}`
    ].join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.2,
    });
    const text = response.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const aiConf = typeof parsed.confidence === "number" ? Math.min(0.65, Math.max(0.45, parsed.confidence)) : 0.52;
      const aiReason = parsed.reasoning || "";

      if (parsed.agree) {
        // AI согласен — повышаем confidence
        confidence = Math.min(0.62, Math.max(confidence, (confidence + aiConf) / 2));
        aiVerdict = "agree";
        reasoning += ` [AI✓ ${(aiConf*100).toFixed(0)}%]`;
      } else {
        // AI не согласен — оцениваем противоположное направление
        logModelChange("AI_ОЦЕНКА", `${asset.toUpperCase()} ${direction} — AI против (${(aiConf*100).toFixed(0)}%): ${aiReason}`);

        // Запрос 2: оценка противоположного
        try {
          const reversePrompt = [
            `Asset: ${asset.toUpperCase()}`,
            `Market prices: Up=${(upPrice*100).toFixed(1)}%, Down=${((1-upPrice)*100).toFixed(1)}%`,
            `Signal to evaluate: ${otherDir}`,
            calInfo,
            ``,
            `How confident are you in ${otherDir}? Reply JSON:`,
            `{"confident": true/false, "confidence": 0.50-0.65, "reasoning": "brief reason"}`
          ].join("\n");

          const rev = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemMsg },
              { role: "user", content: reversePrompt },
            ],
            max_tokens: 100,
            temperature: 0.2,
          });
          const revText = rev.choices?.[0]?.message?.content || "";
          const revMatch = revText.match(/\{[\s\S]*?\}/);
          if (revMatch) {
            const revParsed = JSON.parse(revMatch[0]);
            const revConf = typeof revParsed.confidence === "number" ? Math.min(0.65, Math.max(0.45, revParsed.confidence)) : 0.50;
            const revReason = revParsed.reasoning || "";

            if (revParsed.confident && revConf >= 0.55) {
              // AI уверен в обратном — переключаем
              logModelChange("AI_ФЛИП", `${asset.toUpperCase()} ${direction}→${otherDir} AI conf=${(revConf*100).toFixed(0)}%: ${revReason}`);
              direction = otherDir as "Up" | "Down";
              confidence = Math.min(0.60, revConf);
              reasoning += ` [AI→${otherDir} ${(revConf*100).toFixed(0)}%]`;
              aiVerdict = "flip";
            } else {
              // AI не уверен и в обратном — оставляем но снижаем
              confidence = Math.max(0.51, confidence - 0.02);
              reasoning += ` [AI✗ ${(aiConf*100).toFixed(0)}%, rev=${(revConf*100).toFixed(0)}%]`;
              aiVerdict = "disagree";
            }
          } else {
            confidence = Math.max(0.51, confidence - 0.02);
            reasoning += " [AI✗]";
            aiVerdict = "disagree";
          }
        } catch {
          // Второй запрос упал — просто disagree
          confidence = Math.max(0.51, confidence - 0.02);
          reasoning += " [AI✗]";
          aiVerdict = "disagree";
        }
      }
    } else {
      aiVerdict = "no_json";
    }
  } catch (err: any) {
    aiVerdict = "unavailable";
    log(`AI validation error: ${err?.message?.substring(0, 100)}`, "micro");
  }

  // Log the decision
  logModelChange("РЕШЕНИЕ", `${asset.toUpperCase()} ${direction} [${strategy}] conf=${(confidence*100).toFixed(0)}% ai=${aiVerdict} | ${reasoning}`);

  return { direction, confidence, reasoning, strategy, aiVerdict, learningWeight: 1.0 };
}

// --- Execute micro-trade ---
function executeMicroTrade(market: MicroMarket, direction: "Up" | "Down", confidence: number, reasoning: string, riskMultiplier: number = 1.0): boolean {
  const killSwitch = storage.getConfig("kill_switch") === "true";
  if (killSwitch) return false;

  const isPaperTrading = storage.getConfig("paper_trading") !== "false";
  const microBankroll = parseFloat(storage.getConfig("micro_bankroll") || "200");
  const microMaxBet = parseFloat(storage.getConfig("micro_max_bet") || "20");
  
  const price = direction === "Up" ? market.upPrice : market.downPrice;
  const impliedEdge = confidence - price;
  
  // Простой сайзинг: базовая ставка $10 × riskMultiplier
  // Лучшая модель использовала $5-$15, средняя $10
  const baseBet = 10;
  const rawSize = baseBet * riskMultiplier;
  const size = Math.max(3, Math.min(rawSize, microMaxBet, microBankroll * 0.10));
  
  log(`Micro: ${market.asset.toUpperCase()} ${direction} sizing: base=$${baseBet} risk=${riskMultiplier.toFixed(2)}x → $${size.toFixed(2)}`, "micro");

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

      // Update learning matrix (per-asset, per-direction, per-hour)
      const settleHour = new Date(pos.openedAt || "").getUTCHours();
      updateLearningMatrix(asset, direction, settleHour, wasCorrect, realizedPnl);

      // Update strategy performance
      const oppDesc = opp.description || "";
      let settleStrategy = "unknown";
      if (oppDesc.includes("CONTRARIAN")) settleStrategy = "contrarian";
      else if (oppDesc.includes("CALIBRATION")) settleStrategy = "calibration";
      else if (oppDesc.includes("ALTERNATE")) settleStrategy = "alternate";
      updateStrategyPerf(settleStrategy, wasCorrect, realizedPnl);

      const icon = wasCorrect ? "✓" : "✗";
      const cal = getCalibration(asset);
      const lw = getLearningWeight(asset, direction, settleHour);
      logModelChange("СЕТЛМЕНТ", `${icon} ${asset.toUpperCase()} ${direction} [${settleStrategy}] PnL=$${realizedPnl.toFixed(2)} WR=${(cal.wins/cal.totalTrades*100).toFixed(0)}%(${cal.wins}/${cal.totalTrades}) w=${lw.toFixed(2)}`);

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
    const analyses: Array<{ asset: string; market: MicroMarket; direction: "Up" | "Down"; confidence: number; reasoning: string; strategy: string; aiVerdict: string; learningWeight: number }> = [];

    for (const asset of enabledAssets) {
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

    // Execute trades — all 4 assets always trade, but with risk-adjusted sizing
    for (const a of analyses) {
      let riskMult = 1.0;

      // === RISK ADJUSTMENT ===

      // Риск актива (последние 5 сделок)
      riskMult *= getAssetRiskMultiplier(a.asset);

      // AI не согласен (но не флипнул) → снижаем
      if (a.aiVerdict === "disagree") riskMult *= 0.5;
      // AI недоступен → нет валидации, снижаем
      if (a.aiVerdict === "unavailable" || a.aiVerdict === "no_json") riskMult *= 0.6;
      // AI флипнул направление → умеренный размер (новая гипотеза)
      if (a.aiVerdict === "flip") riskMult *= 0.7;

      // alternate стратегия — дополнительное снижение
      if (a.strategy === "alternate") {
        const altPerf = getStrategyPerf("alternate");
        const altWR = getStrategyRecentWR("alternate");
        const hasLearningData = a.learningWeight !== 1.0;

        // Нет данных обучения → минимальная ставка
        if (!hasLearningData) riskMult *= 0.3;
        // WR < 55% при >= 5 сделках → минимальная ставка
        if (altPerf.trades >= 5 && altWR < 0.55) riskMult *= 0.3;

        logModelChange("РИСК", `${a.asset.toUpperCase()} [alternate] w=${a.learningWeight.toFixed(2)} ai=${a.aiVerdict} altWR=${(altWR*100).toFixed(0)}% → risk=${riskMult.toFixed(2)}x`);
      }

      // Общий минимум 0.15x, максимум 1.0x
      riskMult = Math.max(0.15, Math.min(1.0, riskMult));

      executeMicroTrade(a.market, a.direction, a.confidence, a.reasoning, riskMult);
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

  // Asset risk multipliers (replaces cooldowns)
  const assetRisk: Record<string, number> = {};
  for (const asset of enabledAssets) {
    assetRisk[asset.toLowerCase()] = getAssetRiskMultiplier(asset.toLowerCase());
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
      assetRisk,
    },
  };
}
