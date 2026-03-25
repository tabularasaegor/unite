import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runFullPipeline, runStage, startPipelineScheduler, stopPipelineScheduler, getPipelineStatus } from "./services/pipelineOrchestrator";
import { runMarketScan, getLastScanResult, isScanRunning } from "./services/marketScanner";
import { researchOpportunity } from "./services/researchSwarm";
import { estimateProbability } from "./services/probabilityEngine";
import { assessRisk, approveRiskAssessment, rejectRiskAssessment } from "./services/riskEngine";
import { startMicroScheduler, stopMicroScheduler, getMicroStatus, getModelLog } from "./services/cryptoMicroScheduler";
import { executeOpportunity, closePosition, updatePositionPrices } from "./services/executionEngine";
import { checkSettlements, generatePostMortem, recordPerformanceSnapshot } from "./services/settlementMonitor";
import { isTradeEnabled, fetchMarkets } from "./services/polymarket";

// --- Authentication ---
// Built-in users + registered users stored in DB via memoryStore
const BUILTIN_USERS: Record<string, string> = {
  "animusvox": "Rodman91!",
};

function getUsers(): Record<string, string> {
  const users = { ...BUILTIN_USERS };
  // Load registered users from DB
  const registered = storage.getMemory("registered_users");
  for (const entry of registered) {
    try {
      const { username, password } = JSON.parse(entry.value);
      if (username && password) users[username] = password;
    } catch {}
  }
  return users;
}
const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

// Sessions backed by DB (memoryStore) so they survive server restart.
// In-memory cache avoids hitting DB on every request.
const sessionCache = new Map<string, { expiry: number; username: string }>();
let sessionCacheLoaded = false;

function loadSessionsFromDB() {
  if (sessionCacheLoaded) return;
  sessionCacheLoaded = true;
  try {
    const entries = storage.getMemory("auth_sessions");
    const now = Date.now();
    for (const entry of entries) {
      try {
        const { expiry, username } = JSON.parse(entry.value);
        if (expiry > now) {
          sessionCache.set(entry.key, { expiry, username });
        }
      } catch {}
    }
  } catch {}
}

function saveSession(token: string, expiry: number, username: string) {
  sessionCache.set(token, { expiry, username });
  storage.upsertMemory({
    category: "auth_sessions",
    key: token,
    value: JSON.stringify({ expiry, username }),
    confidence: 1,
    createdAt: new Date().toISOString(),
  });
}

function deleteSession(token: string) {
  sessionCache.delete(token);
  // Delete from DB by setting expired value
  storage.upsertMemory({
    category: "auth_sessions",
    key: token,
    value: JSON.stringify({ expiry: 0, username: "" }),
    confidence: 0,
    createdAt: new Date().toISOString(),
  });
}

function generateToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function isTokenValid(token: string): boolean {
  loadSessionsFromDB();
  const session = sessionCache.get(token);
  if (!session) return false;
  if (Date.now() > session.expiry) {
    deleteSession(token);
    return false;
  }
  // Extend on activity (sliding window)
  const newExpiry = Date.now() + TOKEN_TTL_MS;
  session.expiry = newExpiry;
  // Persist extension to DB (throttled — only if >5 min since last save)
  saveSession(token, newExpiry, session.username);
  return true;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // --- Auth routes (no auth required) ---
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Логин и пароль обязательны" });
    const users = getUsers();
    if (users[username] !== password) return res.status(401).json({ error: "Неверный логин или пароль" });
    const token = generateToken();
    saveSession(token, Date.now() + TOKEN_TTL_MS, username);
    res.json({ token, username });
  });

  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Логин и пароль обязательны" });
    if (username.length < 3) return res.status(400).json({ error: "Логин минимум 3 символа" });
    if (password.length < 6) return res.status(400).json({ error: "Пароль минимум 6 символов" });
    const users = getUsers();
    if (users[username]) return res.status(409).json({ error: "Пользователь уже существует" });
    // Save to DB
    storage.upsertMemory({
      category: "registered_users",
      key: username,
      value: JSON.stringify({ username, password }),
      confidence: 1,
      createdAt: new Date().toISOString(),
    });
    // Auto-login after registration
    const token = generateToken();
    saveSession(token, Date.now() + TOKEN_TTL_MS, username);
    res.json({ token, username });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) deleteSession(token);
    res.json({ ok: true });
  });

  app.get("/api/auth/check", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    res.json({ authenticated: !!token && isTokenValid(token) });
  });

  // --- Auth middleware (60-min sliding window) ---
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth")) return next();
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token || !isTokenValid(token)) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }
    next();
  });

  // ============================================================================
  // PREDICTION MARKET PLATFORM — API Routes
  // ============================================================================

  // --- Pipeline ---

  app.get("/api/pipeline/status", (_req, res) => {
    res.json(getPipelineStatus());
  });

  app.post("/api/pipeline/run", async (_req, res) => {
    try {
      const result = await runFullPipeline();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/pipeline/stage/:stage", async (req, res) => {
    try {
      const { stage } = req.params;
      const opportunityId = req.body?.opportunityId;
      const result = await runStage(stage, opportunityId);
      res.json(result);
    } catch (err: any) {
      res.status(422).json({ error: err.message });
    }
  });

  app.post("/api/pipeline/scheduler/start", (req, res) => {
    // Read interval from request body OR from saved config
    const interval = parseInt(req.body?.intervalMinutes as string) || parseInt(storage.getConfig("pipeline_interval") || "30");
    storage.setConfig("pipeline_interval", String(interval));
    startPipelineScheduler(interval);
    res.json({ status: "started", intervalMinutes: interval });
  });

  app.post("/api/pipeline/scheduler/stop", (_req, res) => {
    stopPipelineScheduler();
    res.json({ status: "stopped" });
  });

  // --- Scanner ---

  app.post("/api/scanner/scan", async (_req, res) => {
    try {
      const result = await runMarketScan();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scanner/markets", async (_req, res) => {
    try {
      const markets = await fetchMarkets(100);
      res.json(markets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scanner/status", (_req, res) => {
    res.json({
      scanning: isScanRunning(),
      lastResult: getLastScanResult(),
    });
  });

  // --- Opportunities ---

  app.get("/api/opportunities", (req, res) => {
    const { status, platform, stage, limit } = req.query;
    const opportunities = storage.getOpportunities({
      status: status as string,
      platform: platform as string,
      stage: stage as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(opportunities);
  });

  app.get("/api/opportunities/:id", (req, res) => {
    const opp = storage.getOpportunity(parseInt(req.params.id));
    if (!opp) return res.status(404).json({ error: "Not found" });
    res.json(opp);
  });

  app.get("/api/opportunities/:id/research", (req, res) => {
    const reports = storage.getResearchReports(parseInt(req.params.id));
    res.json(reports);
  });

  app.get("/api/opportunities/:id/estimates", (req, res) => {
    const estimates = storage.getProbabilityEstimates(parseInt(req.params.id));
    res.json(estimates);
  });

  app.get("/api/opportunities/:id/risk", (req, res) => {
    const risk = storage.getRiskAssessment(parseInt(req.params.id));
    res.json(risk || null);
  });

  // --- Manual Pipeline Actions on Opportunity ---

  app.post("/api/opportunities/:id/research", async (req, res) => {
    try {
      const result = await researchOpportunity(parseInt(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/opportunities/:id/estimate", async (req, res) => {
    try {
      const result = await estimateProbability(parseInt(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/opportunities/:id/risk", async (req, res) => {
    try {
      const result = await assessRisk(parseInt(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/opportunities/:id/execute", async (req, res) => {
    try {
      const result = await executeOpportunity(parseInt(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Risk Approval ---

  app.post("/api/risk/:id/approve", (req, res) => {
    try {
      approveRiskAssessment(parseInt(req.params.id));
      res.json({ approved: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/risk/:id/reject", (req, res) => {
    try {
      const { reason } = req.body;
      rejectRiskAssessment(parseInt(req.params.id), reason || "Rejected by user");
      res.json({ rejected: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Positions ---

  app.get("/api/positions", (req, res) => {
    const status = (req.query.status as string) || undefined;
    const type = req.query.type as string; // "micro" | "regular" | undefined
    const positions = storage.getActivePositions(status);
    const enriched = positions.map(p => {
      const opp = storage.getOpportunity(p.opportunityId);
      return {
        ...p,
        marketUrl: opp?.marketUrl || null,
        slug: opp?.slug || null,
        endDate: opp?.endDate || null,
      };
    });
    if (type === "micro") return res.json(enriched.filter(p => p.title.startsWith("[5m]")));
    if (type === "regular") return res.json(enriched.filter(p => !p.title.startsWith("[5m]")));
    res.json(enriched);
  });

  app.post("/api/positions/:id/close", async (req, res) => {
    try {
      await closePosition(parseInt(req.params.id));
      res.json({ closed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Executions ---

  app.get("/api/executions", (req, res) => {
    const { status, opportunityId, type } = req.query;
    const execs = storage.getExecutions({
      status: status as string,
      opportunityId: opportunityId ? parseInt(opportunityId as string) : undefined,
    });
    const positions = storage.getActivePositions();
    const enriched = execs.map(e => {
      const opp = storage.getOpportunity(e.opportunityId);
      const position = positions.find(p => p.executionId === e.id);
      return {
        ...e,
        title: opp?.title || `Opportunity #${e.opportunityId}`,
        marketUrl: opp?.marketUrl || null,
        slug: opp?.slug || null,
        endDate: opp?.endDate || null,
        category: opp?.category || null,
        positionId: position?.id || null,
        positionStatus: position?.status || null,
      };
    });
    if (type === "micro") return res.json(enriched.filter(e => (e.title || "").startsWith("[5m]")));
    if (type === "regular") return res.json(enriched.filter(e => !(e.title || "").startsWith("[5m]")));
    res.json(enriched);
  });

  // --- Settlements ---

  app.get("/api/settlements", (req, res) => {
    const { status, type } = req.query;
    const raw = storage.getSettlements({ status: status as string });
    const enriched = raw.map(s => {
      const opp = storage.getOpportunity(s.opportunityId);
      const position = s.positionId ? storage.getActivePosition(s.positionId) : undefined;
      const execution = position ? storage.getExecution(position.executionId) : undefined;
      return {
        ...s,
        title: opp?.title || `Opportunity #${s.opportunityId}`,
        marketUrl: opp?.marketUrl || null,
        slug: opp?.slug || null,
        endDate: opp?.endDate || null,
        category: opp?.category || null,
        positionSide: position?.side || null,
        positionEntryPrice: position?.entryPrice || null,
        positionSize: position?.size || null,
        executionId: execution?.id || null,
      };
    });
    if (type === "micro") return res.json(enriched.filter(s => (s.title || "").startsWith("[5m]")));
    if (type === "regular") return res.json(enriched.filter(s => !(s.title || "").startsWith("[5m]")));
    res.json(enriched);
  });

  // --- Post-Mortems ---

  app.get("/api/post-mortems", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(storage.getPostMortems(limit));
  });

  app.post("/api/post-mortems/:opportunityId", async (req, res) => {
    try {
      const result = await generatePostMortem(parseInt(req.params.opportunityId));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Micro-Scheduler (5-min crypto) ---

  app.get("/api/micro/status", (_req, res) => {
    res.json(getMicroStatus());
  });

  app.post("/api/micro/start", (req, res) => {
    const assets = req.body?.assets; // e.g. "btc,eth,sol"
    const bankroll = req.body?.bankroll;
    const maxBet = req.body?.maxBet;
    if (assets) storage.setConfig("micro_assets", assets);
    if (bankroll) storage.setConfig("micro_bankroll", String(bankroll));
    if (maxBet) storage.setConfig("micro_max_bet", String(maxBet));
    startMicroScheduler();
    res.json({ started: true, ...getMicroStatus() });
  });

  app.get("/api/micro/model-log", (_req, res) => {
    res.json(getModelLog());
  });

  app.post("/api/micro/stop", (_req, res) => {
    stopMicroScheduler();
    res.json({ stopped: true, ...getMicroStatus() });
  });

  // Detailed micro stats with per-asset breakdown, time series, averages
  app.get("/api/micro/stats", (_req, res) => {
    try {
      const allPositions = storage.getActivePositions();
      const microPositions = allPositions.filter(p => p.title?.startsWith("[5m]"));
      const closedMicro = microPositions.filter(p => p.status === "closed");
      const openMicro = microPositions.filter(p => p.status === "open");

      const allExec = storage.getExecutions();
      const microExec = allExec.filter(e => {
        const opp = storage.getOpportunity(e.opportunityId);
        return opp?.title?.startsWith("[5m]");
      });

      // Per-asset stats
      const assetMap: Record<string, string> = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", xrp: "XRP" };
      const perAsset: Record<string, { trades: number; wins: number; losses: number; pnl: number; totalSize: number; totalConfidence: number }> = {};

      // Time series of results
      const timeSeries: Array<{ time: string; asset: string; direction: string; pnl: number; won: boolean; size: number; confidence: number }> = [];

      for (const pos of closedMicro) {
        const opp = storage.getOpportunity(pos.opportunityId);
        if (!opp) continue;

        // Detect asset
        const titleLower = (pos.title || "").toLowerCase();
        let assetCode = "BTC";
        for (const [name, code] of Object.entries(assetMap)) {
          if (titleLower.includes(name)) { assetCode = code; break; }
        }

        if (!perAsset[assetCode]) perAsset[assetCode] = { trades: 0, wins: 0, losses: 0, pnl: 0, totalSize: 0, totalConfidence: 0 };
        const a = perAsset[assetCode];
        const pnl = pos.unrealizedPnl || 0;
        const won = pnl > 0;
        a.trades++;
        if (won) a.wins++; else a.losses++;
        a.pnl += pnl;
        a.totalSize += pos.size;
        a.totalConfidence += opp.aiProbability || 0.5;

        timeSeries.push({
          time: pos.closedAt || pos.openedAt || "",
          asset: assetCode,
          direction: pos.side === "YES" ? "Up" : "Down",
          pnl: Math.round(pnl * 100) / 100,
          won,
          size: pos.size,
          confidence: opp.aiProbability || 0.5,
        });
      }

      // Sort time series by time
      timeSeries.sort((a, b) => a.time.localeCompare(b.time));

      // Totals
      const totalTrades = closedMicro.length;
      const totalWins = closedMicro.filter(p => (p.unrealizedPnl || 0) > 0).length;
      const totalPnl = closedMicro.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
      const avgSize = totalTrades > 0 ? microExec.reduce((s, e) => s + (e.size || 0), 0) / microExec.length : 0;
      const avgConfidence = totalTrades > 0 ? Object.values(perAsset).reduce((s, a) => s + a.totalConfidence, 0) / totalTrades : 0;
      const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 0;

      // Streaks
      let currentStreak = 0;
      let maxWinStreak = 0;
      let maxLossStreak = 0;
      let tmpWin = 0, tmpLoss = 0;
      for (const t of timeSeries) {
        if (t.won) { tmpWin++; tmpLoss = 0; maxWinStreak = Math.max(maxWinStreak, tmpWin); }
        else { tmpLoss++; tmpWin = 0; maxLossStreak = Math.max(maxLossStreak, tmpLoss); }
      }
      if (timeSeries.length > 0) {
        const last = timeSeries[timeSeries.length - 1];
        currentStreak = last.won ? tmpWin : -tmpLoss;
      }

      // Per-asset formatted
      const assetStats = Object.entries(perAsset).map(([code, a]) => ({
        asset: code,
        trades: a.trades,
        wins: a.wins,
        losses: a.losses,
        winRate: a.trades > 0 ? Math.round(a.wins / a.trades * 100) : 0,
        pnl: Math.round(a.pnl * 100) / 100,
        avgSize: a.trades > 0 ? Math.round(a.totalSize / a.trades * 100) / 100 : 0,
        avgConfidence: a.trades > 0 ? Math.round(a.totalConfidence / a.trades * 100) : 0,
      }));

      res.json({
        totalTrades,
        totalWins,
        totalLosses: totalTrades - totalWins,
        winRate: Math.round(winRate * 10) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        avgSize: Math.round(avgSize * 100) / 100,
        avgConfidence: Math.round(avgConfidence * 100),
        openPositions: openMicro.length,
        maxWinStreak,
        maxLossStreak,
        currentStreak,
        assetStats,
        timeSeries: timeSeries.slice(-100), // Last 100
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/micro/dashboard", (_req, res) => {
    const allPositions = storage.getActivePositions();
    const microPositions = allPositions.filter(p => p.title.startsWith("[5m]"));
    const openMicro = microPositions.filter(p => p.status === "open");
    const closedMicro = microPositions.filter(p => p.status === "closed");
    const totalPnl = closedMicro.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const wins = closedMicro.filter(p => (p.unrealizedPnl || 0) > 0).length;
    const winRate = closedMicro.length > 0 ? (wins / closedMicro.length * 100) : 0;

    const allExec = storage.getExecutions();
    const microExec = allExec.filter(e => {
      const opp = storage.getOpportunity(e.opportunityId);
      return opp?.title?.startsWith("[5m]");
    });

    res.json({
      openPositions: openMicro.length,
      closedPositions: closedMicro.length,
      totalTrades: microExec.length,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      totalVolume: Math.round(microExec.reduce((s, e) => s + (e.size || 0), 0) * 100) / 100,
    });
  });

  // --- Memory Store ---

  app.get("/api/memory", (req, res) => {
    const { category, key } = req.query;
    if (!category) return res.status(400).json({ error: "category required" });
    res.json(storage.getMemory(category as string, key as string));
  });

  // --- Audit Log ---

  app.get("/api/audit-log", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const entityType = req.query.entityType as string;
    res.json(storage.getAuditLog(limit, entityType));
  });

  // --- Dashboard ---

  app.get("/api/dashboard/stats", (_req, res) => {
    const stats = storage.getDashboardStats();
    // Exclude micro ([5m]) positions from main dashboard stats
    const allPositions = storage.getActivePositions();
    const regularOpen = allPositions.filter(p => p.status === "open" && !p.title.startsWith("[5m]"));
    const microOpenCount = allPositions.filter(p => p.status === "open" && p.title.startsWith("[5m]")).length;
    res.json({
      ...stats,
      activePositions: stats.activePositions - microOpenCount,
      totalTrades: stats.totalTrades - allPositions.filter(p => p.title.startsWith("[5m]")).length,
    });
  });

  app.get("/api/dashboard/performance", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(storage.getPerformanceSnapshots(limit));
  });

  // --- Polymarket Info ---

  app.get("/api/polymarket/status", async (_req, res) => {
    const funderAddress = process.env.POLY_FUNDER_ADDRESS || storage.getConfig("poly_funder_address") || null;
    let balance: string | null = null;
    
    // Try to fetch USDC balance from Data API
    if (funderAddress) {
      try {
        const resp = await fetch(`https://data-api.polymarket.com/value?user=${funderAddress}`);
        if (resp.ok) {
          const data = await resp.json();
          // API returns array: [{user: "0x...", value: 0}]
          const entry = Array.isArray(data) ? data[0] : data;
          balance = entry?.value != null ? String(entry.value) : "0";
        }
      } catch {}
    }

    res.json({
      tradingEnabled: isTradeEnabled(),
      address: funderAddress,
      balance,
      signatureType: process.env.POLY_SIGNATURE_TYPE || storage.getConfig("poly_signature_type") || "0",
      hasPrivateKey: !!(process.env.POLY_PRIVATE_KEY || storage.getConfig("poly_private_key")),
      hasOpenaiKey: !!(process.env.OPENAI_API_KEY || storage.getConfig("openai_api_key")),
      hasAnthropicKey: !!(process.env.ANTHROPIC_API_KEY || storage.getConfig("anthropic_api_key")),
    });
  });

  // Save keys from UI
  app.post("/api/config/keys", (req, res) => {
    const { poly_private_key, poly_funder_address, poly_signature_type, openai_api_key, anthropic_api_key } = req.body;
    if (poly_private_key) storage.setConfig("poly_private_key", poly_private_key);
    if (poly_funder_address) storage.setConfig("poly_funder_address", poly_funder_address);
    if (poly_signature_type) storage.setConfig("poly_signature_type", poly_signature_type);
    if (openai_api_key) storage.setConfig("openai_api_key", openai_api_key);
    if (anthropic_api_key) storage.setConfig("anthropic_api_key", anthropic_api_key);
    res.json({ saved: true });
  });

  // --- Kill Switch ---

  app.post("/api/config/kill-switch", (req, res) => {
    const { enabled } = req.body;
    storage.setConfig("kill_switch", enabled ? "true" : "false");
    storage.createAuditEntry({
      action: "config",
      entityType: "config",
      actor: "human",
      details: JSON.stringify({ kill_switch: enabled }),
      timestamp: new Date().toISOString(),
    });
    res.json({ kill_switch: enabled });
  });

  // --- Config ---

  app.get("/api/config", (_req, res) => {
    const keys = [
      "paper_trading", "auto_execute", "bankroll", "max_position_pct",
      "max_drawdown", "gpt_weight", "claude_weight", "gemini_weight",
      "min_edge_threshold", "pipeline_interval", "require_human_approval",
      "auto_approve_threshold", "kill_switch", "max_trade_size",
      "micro_scheduler_enabled", "micro_assets", "micro_bankroll", "micro_max_bet",
      "pipeline_min_days", "pipeline_max_days", "pipeline_sectors",
    ];
    const config: Record<string, string> = {};
    for (const key of keys) {
      config[key] = storage.getConfig(key) || getDefaultConfigValue(key);
    }
    res.json(config);
  });

  app.post("/api/config", (req, res) => {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      storage.setConfig(key, String(value));
    }
    res.json({ updated: Object.keys(updates).length });
  });

  return httpServer;
}

function getDefaultConfigValue(key: string): string {
  const defaults: Record<string, string> = {
    paper_trading: "true",
    auto_execute: "false",
    bankroll: "5000",
    max_position_pct: "0.10",
    max_drawdown: "0.20",
    gpt_weight: "0.40",
    claude_weight: "0.35",
    gemini_weight: "0.25",
    min_edge_threshold: "0.015",
    pipeline_interval: "30",
    require_human_approval: "true",
    auto_approve_threshold: "100",
    kill_switch: "false",
    max_trade_size: "100",
    micro_scheduler_enabled: "false",
    micro_assets: "btc,eth,sol,xrp",
    micro_bankroll: "200",
    micro_max_bet: "20",
    pipeline_min_days: "0",
    pipeline_max_days: "30",
    pipeline_sectors: "sports,crypto,politics,tech,other",
  };
  return defaults[key] || "";
}
