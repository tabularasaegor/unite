import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage, ensureSchema } from "./storage";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  calibrateFromHistory,
} from "./services/microEngine";
import {
  scanMarkets,
  runResearch,
  getPipelineDashboard,
} from "./services/pipelineEngine";
import { runBacktest } from "./services/backtestEngine";

// ─── Default Config Values ───────────────────────────────────────

const DEFAULT_CONFIG: Record<string, string> = {
  paper_trading: "true",
  auto_execute: "false",
  bankroll: "5000",
  pipeline_interval: "30",
  pipeline_min_days: "0",
  pipeline_max_days: "30",
  pipeline_sectors: "sports,crypto,politics,tech,other",
  pipeline_max_per_run: "30",
  micro_bankroll: "200",
  micro_max_bet: "20",
  micro_assets: "btc,eth,sol,xrp",
  confidence_threshold: "0.52",
};

// ─── Auth Helpers ────────────────────────────────────────────────

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...val] = pair.trim().split("=");
    if (key) cookies[key.trim()] = decodeURIComponent(val.join("="));
  });
  return cookies;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes

function validateToken(token: string): { valid: boolean; userId?: number; username?: string } {
  const sessionJson = storage.getMemory("auth_sessions", token);
  if (!sessionJson) return { valid: false };

  try {
    const session = JSON.parse(sessionJson);
    const createdAt = new Date(session.createdAt).getTime();
    if (Date.now() - createdAt > SESSION_TTL_MS) {
      // Expired — clean up
      return { valid: false };
    }
    // Sliding window: refresh timestamp
    session.createdAt = new Date().toISOString();
    storage.setMemory("auth_sessions", token, JSON.stringify(session));
    return { valid: true, userId: session.userId, username: session.username };
  } catch {
    return { valid: false };
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for auth routes
  if (
    req.path === "/api/auth/login" ||
    req.path === "/api/auth/register" ||
    req.path === "/api/auth/check" ||
    req.path === "/api/auth/logout"
  ) {
    return next();
  }

  // Only protect /api/* routes
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  // Support both cookie and Authorization header (Bearer token)
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies["auth_token"];
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }

  const result = validateToken(token);
  if (!result.valid) {
    return res.status(401).json({ message: "Сессия истекла" });
  }

  // Attach user info to request
  (req as any).userId = result.userId;
  (req as any).username = result.username;
  next();
}

// ─── Register Routes ─────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Ensure database schema exists
  ensureSchema();

  // Apply auth middleware to all /api/* routes
  app.use(authMiddleware);

  // ════════════════════════════════════════════════════════════════
  // AUTH ROUTES
  // ════════════════════════════════════════════════════════════════

  // POST /api/auth/register
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Укажите имя пользователя и пароль" });
      }

      if (username.length < 3 || password.length < 4) {
        return res.status(400).json({ message: "Минимум 3 символа для логина, 4 для пароля" });
      }

      // Check if user exists
      const existing = storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Пользователь уже существует" });
      }

      const passwordHash = hashPassword(password);
      const user = storage.createUser({ username, passwordHash });

      // Store in registered_users memory for reference
      storage.setMemory("registered_users", username, JSON.stringify({
        userId: user.id,
        createdAt: new Date().toISOString(),
      }));

      // Auto-login: create session
      const token = generateToken();
      storage.setMemory("auth_sessions", token, JSON.stringify({
        userId: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
      }));

      storage.addAuditEntry("регистрация", `Новый пользователь: ${username}`, user.id);

      res.setHeader("Set-Cookie",
        `auth_token=${token}; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
      );
      return res.json({
        ok: true,
        token,
        user: { id: user.id, username: user.username },
      });
    } catch (err) {
      console.error("[Auth] Register error:", err);
      return res.status(500).json({ message: "Ошибка регистрации" });
    }
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Укажите имя пользователя и пароль" });
      }

      const user = storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Неверное имя пользователя или пароль" });
      }

      const passwordHash = hashPassword(password);
      if (user.passwordHash !== passwordHash) {
        return res.status(401).json({ message: "Неверное имя пользователя или пароль" });
      }

      const token = generateToken();
      storage.setMemory("auth_sessions", token, JSON.stringify({
        userId: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
      }));

      storage.addAuditEntry("вход", `Пользователь вошёл: ${username}`, user.id);

      res.setHeader("Set-Cookie",
        `auth_token=${token}; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
      );
      return res.json({
        ok: true,
        token,
        user: { id: user.id, username: user.username },
      });
    } catch (err) {
      console.error("[Auth] Login error:", err);
      return res.status(500).json({ message: "Ошибка входа" });
    }
  });

  // GET /api/auth/check
  app.get("/api/auth/check", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies["auth_token"];
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return res.json({ authenticated: false });
    }

    const result = validateToken(token);
    if (!result.valid) {
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user: { id: result.userId, username: result.username },
    });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies["auth_token"];
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }
    if (token) {
      // Remove session from DB
      try {
        const { db } = await import("./storage");
        const { memoryStore } = await import("@shared/schema");
        const { and, eq } = await import("drizzle-orm");
        db.delete(memoryStore).where(
          and(eq(memoryStore.category, "auth_sessions"), eq(memoryStore.key, token))
        ).run();
      } catch {}
    }
    res.setHeader("Set-Cookie", "auth_token=; Path=/; Max-Age=0");
    return res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════
  // CONFIG ROUTES
  // ════════════════════════════════════════════════════════════════

  // GET /api/config
  app.get("/api/config", async (_req: Request, res: Response) => {
    try {
      const dbConfig = storage.getAllConfig();
      const configMap: Record<string, string> = { ...DEFAULT_CONFIG };

      // Override defaults with DB values
      for (const item of dbConfig) {
        configMap[item.key] = item.value;
      }

      return res.json(configMap);
    } catch (err) {
      console.error("[Config] Get error:", err);
      return res.status(500).json({ message: "Ошибка загрузки конфигурации" });
    }
  });

  // PUT /api/config/:key
  app.put("/api/config/:key", async (req: Request, res: Response) => {
    try {
      const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
      const { value } = req.body;

      if (value === undefined || value === null) {
        return res.status(400).json({ message: "Укажите значение" });
      }

      storage.setConfig(key, String(value));
      storage.addAuditEntry("настройки", `${key} = ${value}`, (req as any).userId);

      return res.json({ ok: true, key, value: String(value) });
    } catch (err) {
      console.error("[Config] Update error:", err);
      return res.status(500).json({ message: "Ошибка обновления конфигурации" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // MICRO ROUTES
  // ════════════════════════════════════════════════════════════════

  // GET /api/micro/dashboard
  app.get("/api/micro/dashboard", async (_req: Request, res: Response) => {
    try {
      const stats = storage.getMicroStats();
      const schedulerStatus = getSchedulerStatus();
      const microBankroll = parseFloat(storage.getConfig("micro_bankroll") || DEFAULT_CONFIG.micro_bankroll);

      return res.json({
        ...stats,
        currentBankroll: Math.round((microBankroll + stats.totalPnl) * 100) / 100,
        startingBankroll: microBankroll,
        scheduler: schedulerStatus,
      });
    } catch (err) {
      console.error("[Micro] Dashboard error:", err);
      return res.status(500).json({ message: "Ошибка загрузки дашборда" });
    }
  });

  // GET /api/micro/positions
  app.get("/api/micro/positions", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const filter: { source: string; status?: string } = { source: "micro" };

      if (status && status !== "all") {
        filter.status = status;
      }

      const positions = storage.getPositions(filter);
      return res.json(positions);
    } catch (err) {
      console.error("[Micro] Positions error:", err);
      return res.status(500).json({ message: "Ошибка загрузки позиций" });
    }
  });

  // GET /api/micro/trades
  app.get("/api/micro/trades", async (_req: Request, res: Response) => {
    try {
      // Get all micro position IDs, then filter executions
      const microPositions = storage.getPositions({ source: "micro" });
      const positionIds = new Set(microPositions.map(p => p.id));

      const allExecs = storage.getExecutions();
      const microExecs = allExecs.filter(e => e.positionId && positionIds.has(e.positionId));

      return res.json(microExecs);
    } catch (err) {
      console.error("[Micro] Trades error:", err);
      return res.status(500).json({ message: "Ошибка загрузки сделок" });
    }
  });

  // GET /api/micro/settlements
  app.get("/api/micro/settlements", async (_req: Request, res: Response) => {
    try {
      const microPositions = storage.getPositions({ source: "micro" });
      const positionIds = new Set(microPositions.map(p => p.id));

      const allSettlements = storage.getSettlements();
      const microSettlements = allSettlements.filter(s => positionIds.has(s.positionId));

      return res.json(microSettlements);
    } catch (err) {
      console.error("[Micro] Settlements error:", err);
      return res.status(500).json({ message: "Ошибка загрузки расчётов" });
    }
  });

  // GET /api/micro/model-log
  app.get("/api/micro/model-log", async (req: Request, res: Response) => {
    try {
      const asset = req.query.asset as string | undefined;
      const limit = parseInt(req.query.limit as string || "200", 10);
      const logs = storage.getModelLog(limit, asset || undefined);
      return res.json(logs);
    } catch (err) {
      console.error("[Micro] Model log error:", err);
      return res.status(500).json({ message: "Ошибка загрузки лога модели" });
    }
  });

  // GET /api/micro/strategy-performance
  app.get("/api/micro/strategy-performance", async (req: Request, res: Response) => {
    try {
      const asset = req.query.asset as string | undefined;
      const perf = storage.getStrategyPerformance(asset || undefined);
      return res.json(perf);
    } catch (err) {
      console.error("[Micro] Strategy performance error:", err);
      return res.status(500).json({ message: "Ошибка загрузки статистики стратегий" });
    }
  });

  // POST /api/micro/scheduler/start
  app.post("/api/micro/scheduler/start", async (_req: Request, res: Response) => {
    try {
      startScheduler();
      return res.json({
        ok: true,
        message: "Планировщик запущен",
        status: getSchedulerStatus(),
      });
    } catch (err) {
      console.error("[Micro] Scheduler start error:", err);
      return res.status(500).json({ message: "Ошибка запуска планировщика" });
    }
  });

  // POST /api/micro/scheduler/stop
  app.post("/api/micro/scheduler/stop", async (_req: Request, res: Response) => {
    try {
      stopScheduler();
      return res.json({
        ok: true,
        message: "Планировщик остановлен",
        status: getSchedulerStatus(),
      });
    } catch (err) {
      console.error("[Micro] Scheduler stop error:", err);
      return res.status(500).json({ message: "Ошибка остановки планировщика" });
    }
  });

  // GET /api/micro/scheduler/status
  app.get("/api/micro/scheduler/status", async (_req: Request, res: Response) => {
    try {
      return res.json(getSchedulerStatus());
    } catch (err) {
      console.error("[Micro] Scheduler status error:", err);
      return res.status(500).json({ message: "Ошибка получения статуса" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // PIPELINE ROUTES
  // ════════════════════════════════════════════════════════════════

  // GET /api/pipeline/dashboard
  app.get("/api/pipeline/dashboard", async (_req: Request, res: Response) => {
    try {
      const dashboard = getPipelineDashboard();
      return res.json(dashboard);
    } catch (err) {
      console.error("[Pipeline] Dashboard error:", err);
      return res.status(500).json({ message: "Ошибка загрузки дашборда пайплайна" });
    }
  });

  // GET /api/pipeline/opportunities
  app.get("/api/pipeline/opportunities", async (req: Request, res: Response) => {
    try {
      const allOpps = storage.getOpportunities();

      // Apply query filters
      const stage = req.query.stage as string | undefined;
      const category = req.query.category as string | undefined;
      const status = req.query.status as string | undefined;

      let filtered = allOpps;
      if (stage) filtered = filtered.filter(o => o.pipelineStage === stage);
      if (category) filtered = filtered.filter(o => o.category === category);
      if (status) filtered = filtered.filter(o => o.status === status);

      return res.json(filtered);
    } catch (err) {
      console.error("[Pipeline] Opportunities error:", err);
      return res.status(500).json({ message: "Ошибка загрузки возможностей" });
    }
  });

  // POST /api/pipeline/scan
  app.post("/api/pipeline/scan", async (_req: Request, res: Response) => {
    try {
      const result = await scanMarkets();
      return res.json({
        ok: true,
        message: `Сканирование завершено: найдено ${result.added} новых возможностей`,
        ...result,
      });
    } catch (err) {
      console.error("[Pipeline] Scan error:", err);
      return res.status(500).json({ message: "Ошибка сканирования рынков" });
    }
  });

  // GET /api/pipeline/positions
  app.get("/api/pipeline/positions", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const filter: { source: string; status?: string } = { source: "pipeline" };
      if (status && status !== "all") filter.status = status;

      const positions = storage.getPositions(filter);
      return res.json(positions);
    } catch (err) {
      console.error("[Pipeline] Positions error:", err);
      return res.status(500).json({ message: "Ошибка загрузки позиций" });
    }
  });

  // GET /api/pipeline/trades
  app.get("/api/pipeline/trades", async (_req: Request, res: Response) => {
    try {
      const pipelinePositions = storage.getPositions({ source: "pipeline" });
      const positionIds = new Set(pipelinePositions.map(p => p.id));

      const allExecs = storage.getExecutions();
      const pipelineExecs = allExecs.filter(e => e.positionId && positionIds.has(e.positionId));

      return res.json(pipelineExecs);
    } catch (err) {
      console.error("[Pipeline] Trades error:", err);
      return res.status(500).json({ message: "Ошибка загрузки сделок" });
    }
  });

  // GET /api/pipeline/settlements
  app.get("/api/pipeline/settlements", async (_req: Request, res: Response) => {
    try {
      const pipelinePositions = storage.getPositions({ source: "pipeline" });
      const positionIds = new Set(pipelinePositions.map(p => p.id));

      const allSettlements = storage.getSettlements();
      const pipelineSettlements = allSettlements.filter(s => positionIds.has(s.positionId));

      return res.json(pipelineSettlements);
    } catch (err) {
      console.error("[Pipeline] Settlements error:", err);
      return res.status(500).json({ message: "Ошибка загрузки расчётов" });
    }
  });

  // GET /api/pipeline/postmortems
  app.get("/api/pipeline/postmortems", async (_req: Request, res: Response) => {
    try {
      const postMortems = storage.getPostMortems();
      return res.json(postMortems);
    } catch (err) {
      console.error("[Pipeline] Post-mortems error:", err);
      return res.status(500).json({ message: "Ошибка загрузки пост-мортемов" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // BACKTEST ROUTES
  // ════════════════════════════════════════════════════════════════

  // POST /api/backtest/run
  app.post("/api/backtest/run", async (req: Request, res: Response) => {
    try {
      const { windows } = req.body || {};
      const numWindows = Math.max(100, Math.min(10000, windows || 2000));
      const result = runBacktest(numWindows);
      return res.json(result);
    } catch (err) {
      console.error("[Backtest] Run error:", err);
      return res.status(500).json({ message: "Ошибка запуска бэктеста" });
    }
  });

  // GET /api/backtest/results
  app.get("/api/backtest/results", async (_req: Request, res: Response) => {
    try {
      const results = storage.getLatestBacktestResults();
      if (results.length === 0) {
        return res.json({ results: [], bestModel: null, timestamp: null });
      }
      // Parse rollingWr50 back from JSON
      const parsed = results.map((r) => ({
        ...r,
        rollingWr50: r.rollingWr50 ? JSON.parse(r.rollingWr50) : [],
      }));
      return res.json({
        results: parsed,
        bestModel: parsed[0]?.strategyName || null,
        timestamp: parsed[0]?.runAt || null,
        batchId: parsed[0]?.batchId || null,
      });
    } catch (err) {
      console.error("[Backtest] Results error:", err);
      return res.status(500).json({ message: "Ошибка загрузки результатов бэктеста" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // AUDIT & PERFORMANCE
  // ════════════════════════════════════════════════════════════════

  // GET /api/audit
  app.get("/api/audit", async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string || "200", 10);
      const logs = storage.getAuditLog(limit);
      return res.json(logs);
    } catch (err) {
      console.error("[Audit] Error:", err);
      return res.status(500).json({ message: "Ошибка загрузки журнала" });
    }
  });

  // GET /api/performance-snapshots
  app.get("/api/performance-snapshots", async (req: Request, res: Response) => {
    try {
      const source = (req.query.source as string) || "micro";
      const limit = parseInt(req.query.limit as string || "100", 10);
      const snapshots = storage.getPerformanceSnapshots(source, limit);
      return res.json(snapshots);
    } catch (err) {
      console.error("[Performance] Snapshots error:", err);
      return res.status(500).json({ message: "Ошибка загрузки снимков производительности" });
    }
  });

  return httpServer;
}
