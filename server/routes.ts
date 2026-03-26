import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage, ensureSchema } from "./storage";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  calibrateFromHistory,
  applyBacktestPriors,
} from "./services/microEngine";
import {
  scanMarkets,
  runResearch,
  getPipelineDashboard,
  processPipeline,
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

// API key config keys — values are masked in GET /api/config
const API_KEY_FIELDS = [
  "api_key_openai",
  "api_key_anthropic",
  "poly_private_key",
  "poly_funder_address",
  "poly_signature_type",
];

function maskSecret(value: string): string {
  if (!value || value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

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

async function validateToken(token: string): Promise<{ valid: boolean; userId?: number; username?: string }> {
  const sessionJson = await storage.getMemory("auth_sessions", token);
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
    await storage.setMemory("auth_sessions", token, JSON.stringify(session));
    return { valid: true, userId: session.userId, username: session.username };
  } catch {
    return { valid: false };
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
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

  const result = await validateToken(token);
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
  await ensureSchema();

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
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Пользователь уже существует" });
      }

      const passwordHash = hashPassword(password);
      const user = await storage.createUser({ username, passwordHash });

      // Store in registered_users memory for reference
      await storage.setMemory("registered_users", username, JSON.stringify({
        userId: user.id,
        createdAt: new Date().toISOString(),
      }));

      // Auto-login: create session
      const token = generateToken();
      await storage.setMemory("auth_sessions", token, JSON.stringify({
        userId: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
      }));

      await storage.addAuditEntry("регистрация", `Новый пользователь: ${username}`, user.id);

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

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Неверное имя пользователя или пароль" });
      }

      const passwordHash = hashPassword(password);
      if (user.passwordHash !== passwordHash) {
        return res.status(401).json({ message: "Неверное имя пользователя или пароль" });
      }

      const token = generateToken();
      await storage.setMemory("auth_sessions", token, JSON.stringify({
        userId: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
      }));

      await storage.addAuditEntry("вход", `Пользователь вошёл: ${username}`, user.id);

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

    const result = await validateToken(token);
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
        await storage.deleteMemory("auth_sessions", token);
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
      const dbConfig = await storage.getAllConfig();
      const configMap: Record<string, string> = { ...DEFAULT_CONFIG };

      // Override defaults with DB values
      for (const item of dbConfig) {
        configMap[item.key] = item.value;
      }

      // Mask API keys in response — never send secrets to the frontend
      for (const key of API_KEY_FIELDS) {
        if (configMap[key]) {
          configMap[key] = maskSecret(configMap[key]);
        }
      }

      return res.json(configMap);
    } catch (err) {
      console.error("[Config] Get error:", err);
      return res.status(500).json({ message: "Ошибка загрузки конфигурации" });
    }
  });

  // GET /api/config/api-keys — returns which keys are set (boolean flags)
  app.get("/api/config/api-keys", async (_req: Request, res: Response) => {
    try {
      const keys: Record<string, { set: boolean; masked: string }> = {};
      for (const key of API_KEY_FIELDS) {
        const val = await storage.getConfig(key);
        keys[key] = {
          set: !!val && val.length > 0,
          masked: val ? maskSecret(val) : "",
        };
      }
      return res.json(keys);
    } catch (err) {
      console.error("[Config] API keys check error:", err);
      return res.status(500).json({ message: "Ошибка чтения API ключей" });
    }
  });

  // GET /api/system/warnings — returns list of warnings about missing configuration
  app.get("/api/system/warnings", async (_req: Request, res: Response) => {
    try {
      const warnings: { id: string; severity: "error" | "warning" | "info"; message: string }[] = [];

      const openaiKey = await storage.getConfig("api_key_openai");
      const anthropicKey = await storage.getConfig("api_key_anthropic");
      const polyKey = await storage.getConfig("poly_private_key");
      const polyAddress = await storage.getConfig("poly_funder_address");
      const paperTrading = (await storage.getConfig("paper_trading")) ?? "true";

      if (!openaiKey) {
        warnings.push({
          id: "no_openai_key",
          severity: "error",
          message: "OpenAI API ключ не указан — AI-анализ (пайплайн, исследование) не будет работать",
        });
      }
      if (!anthropicKey) {
        warnings.push({
          id: "no_anthropic_key",
          severity: "warning",
          message: "Anthropic API ключ не указан — резервная AI-модель недоступна",
        });
      }
      if (!polyKey) {
        warnings.push({
          id: "no_poly_key",
          severity: paperTrading === "true" ? "warning" : "error",
          message: paperTrading === "true"
            ? "Polymarket приватный ключ не указан — live-торговля невозможна (paper trading активен)"
            : "Polymarket приватный ключ не указан — live-торговля невозможна!",
        });
      }
      if (!polyAddress && polyKey) {
        warnings.push({
          id: "no_poly_address",
          severity: "error",
          message: "Polymarket адрес кошелька не указан — невозможно подписывать ордера",
        });
      }

      // Check if backtest has been run
      const backtestResults = await storage.getLatestBacktestResults();
      if (backtestResults.length === 0) {
        warnings.push({
          id: "no_backtest",
          severity: "info",
          message: "Бэктест не запущен — Thompson Sampling стартует с плоских приоров. Рекомендуется запустить бэктест для инициализации модели.",
        });
      }

      return res.json({ warnings });
    } catch (err) {
      console.error("[System] Warnings error:", err);
      return res.status(500).json({ message: "Ошибка проверки системы" });
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

      await storage.setConfig(key, String(value));

      // Mask secrets in audit log
      const auditValue = API_KEY_FIELDS.includes(key) ? maskSecret(String(value)) : String(value);
      await storage.addAuditEntry("настройки", `${key} = ${auditValue}`, (req as any).userId);

      return res.json({ ok: true, key, value: String(value) });
    } catch (err) {
      console.error("[Config] Update error:", err);
      return res.status(500).json({ message: "Ошибка обновления конфигурации" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // MICRO ROUTES
  // ════════════════════════════════════════════════════════════════

  // Micro stats/dashboard handler (shared)
  async function buildMicroStats() {
    const stats = await storage.getMicroStats();
    const schedulerStatus = await getSchedulerStatus();
    const microBankroll = parseFloat((await storage.getConfig("micro_bankroll")) || DEFAULT_CONFIG.micro_bankroll);
    const windowEnd = schedulerStatus.currentWindow.endISO;

    // Build pnlByAsset from assetStats
    const pnlByAsset = stats.assetStats.map(a => ({ asset: a.asset.toUpperCase(), pnl: a.pnl }));

    // Build cumulativePnl from settled micro positions
    const settledPositions = await storage.getPositions({ source: "micro", status: "settled" });
    const closedPositions = await storage.getPositions({ source: "micro", status: "closed" });
    const allClosed = [...settledPositions, ...closedPositions]
      .sort((a, b) => {
        const dateA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const dateB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return dateA - dateB;
      });
    let runningPnl = 0;
    const cumulativePnl = allClosed.map(p => {
      runningPnl += (p.realizedPnl ?? 0);
      return {
        date: p.closedAt ? new Date(p.closedAt).toLocaleDateString("ru-RU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
        pnl: Math.round(runningPnl * 100) / 100,
      };
    });

    return {
      ...stats,
      winRate: Math.round(stats.winRate * 10000) / 100, // convert 0-1 to percentage
      assetStats: stats.assetStats.map(a => ({
        ...a,
        winRate: Math.round(a.winRate * 10000) / 100,
        pnl: Math.round(a.pnl * 100) / 100,
        status: a.trades > 0 ? "active" : "idle",
      })),
      pnlByAsset,
      cumulativePnl,
      currentBankroll: Math.round((microBankroll + stats.totalPnl) * 100) / 100,
      startingBankroll: microBankroll,
      schedulerRunning: schedulerStatus.running,
      nextWindow: windowEnd,
      currentWindow: schedulerStatus.currentWindow.startISO,
      scheduler: schedulerStatus,
    };
  }

  // GET /api/micro/stats — primary endpoint used by frontend
  app.get("/api/micro/stats", async (_req: Request, res: Response) => {
    try {
      return res.json(await buildMicroStats());
    } catch (err) {
      console.error("[Micro] Stats error:", err);
      return res.status(500).json({ message: "Ошибка загрузки дашборда" });
    }
  });

  // GET /api/micro/dashboard — alias
  app.get("/api/micro/dashboard", async (_req: Request, res: Response) => {
    try {
      return res.json(await buildMicroStats());
    } catch (err) {
      console.error("[Micro] Dashboard error:", err);
      return res.status(500).json({ message: "Ошибка загрузки дашборда" });
    }
  });

  // GET /api/micro/logs — alias for model-log, used by frontend
  app.get("/api/micro/logs", async (req: Request, res: Response) => {
    try {
      const asset = req.query.asset as string | undefined;
      const limit = parseInt(req.query.limit as string || "200", 10);
      const logs = await storage.getModelLog(limit, asset || undefined);
      return res.json(logs);
    } catch (err) {
      console.error("[Micro] Logs error:", err);
      return res.status(500).json({ message: "Ошибка загрузки лога модели" });
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

      const positions = await storage.getPositions(filter);
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
      const microPositions = await storage.getPositions({ source: "micro" });
      const positionIds = new Set(microPositions.map(p => p.id));

      const allExecs = await storage.getExecutions();
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
      const microPositions = await storage.getPositions({ source: "micro" });
      const positionIds = new Set(microPositions.map(p => p.id));

      const allSettlements = await storage.getSettlements();
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
      const logs = await storage.getModelLog(limit, asset || undefined);
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
      const perf = await storage.getStrategyPerformance(asset || undefined);
      return res.json(perf);
    } catch (err) {
      console.error("[Micro] Strategy performance error:", err);
      return res.status(500).json({ message: "Ошибка загрузки статистики стратегий" });
    }
  });

  // POST /api/micro/scheduler/start
  app.post("/api/micro/scheduler/start", async (_req: Request, res: Response) => {
    try {
      await startScheduler();
      return res.json({
        ok: true,
        message: "Планировщик запущен",
        status: await getSchedulerStatus(),
      });
    } catch (err) {
      console.error("[Micro] Scheduler start error:", err);
      return res.status(500).json({ message: "Ошибка запуска планировщика" });
    }
  });

  // POST /api/micro/scheduler/stop
  app.post("/api/micro/scheduler/stop", async (_req: Request, res: Response) => {
    try {
      await stopScheduler();
      return res.json({
        ok: true,
        message: "Планировщик остановлен",
        status: await getSchedulerStatus(),
      });
    } catch (err) {
      console.error("[Micro] Scheduler stop error:", err);
      return res.status(500).json({ message: "Ошибка остановки планировщика" });
    }
  });

  // GET /api/micro/scheduler/status
  app.get("/api/micro/scheduler/status", async (_req: Request, res: Response) => {
    try {
      return res.json(await getSchedulerStatus());
    } catch (err) {
      console.error("[Micro] Scheduler status error:", err);
      return res.status(500).json({ message: "Ошибка получения статуса" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // PIPELINE ROUTES
  // ════════════════════════════════════════════════════════════════

  // Pipeline stats builder — returns shape expected by frontend PipelineStats interface
  async function buildPipelineStats() {
    const dashboard = await getPipelineDashboard();
    return {
      ...dashboard,
      scanCount: dashboard.stageBreakdown.scanned || 0,
      researchCount: dashboard.stageBreakdown.researched || 0,
      positionCount: dashboard.openPositions + dashboard.closedPositions,
    };
  }

  // GET /api/pipeline/stats — primary endpoint for frontend
  app.get("/api/pipeline/stats", async (_req: Request, res: Response) => {
    try {
      return res.json(await buildPipelineStats());
    } catch (err) {
      console.error("[Pipeline] Stats error:", err);
      return res.status(500).json({ message: "Ошибка загрузки статистики пайплайна" });
    }
  });

  // GET /api/pipeline/dashboard — alias
  app.get("/api/pipeline/dashboard", async (_req: Request, res: Response) => {
    try {
      return res.json(await buildPipelineStats());
    } catch (err) {
      console.error("[Pipeline] Dashboard error:", err);
      return res.status(500).json({ message: "Ошибка загрузки дашборда пайплайна" });
    }
  });

  // Shared opportunities handler
  async function filterOpportunities(query: { stage?: string; category?: string; status?: string; limit?: string }) {
    const allOpps = await storage.getOpportunities();
    let filtered = allOpps;
    if (query.stage) filtered = filtered.filter(o => o.pipelineStage === query.stage);
    if (query.category) filtered = filtered.filter(o => o.category === query.category);
    if (query.status) filtered = filtered.filter(o => o.status === query.status);
    if (query.limit) filtered = filtered.slice(0, parseInt(query.limit, 10));
    return filtered;
  }

  // GET /api/opportunities — used by frontend (scanner, pipeline-dashboard, opportunities pages)
  app.get("/api/opportunities", async (req: Request, res: Response) => {
    try {
      return res.json(await filterOpportunities(req.query as any));
    } catch (err) {
      console.error("[Pipeline] Opportunities error:", err);
      return res.status(500).json({ message: "Ошибка загрузки возможностей" });
    }
  });

  // GET /api/pipeline/opportunities — alias
  app.get("/api/pipeline/opportunities", async (req: Request, res: Response) => {
    try {
      return res.json(await filterOpportunities(req.query as any));
    } catch (err) {
      console.error("[Pipeline] Opportunities error:", err);
      return res.status(500).json({ message: "Ошибка загрузки возможностей" });
    }
  });

  // POST /api/pipeline/scan
  app.post("/api/pipeline/scan", async (_req: Request, res: Response) => {
    try {
      const result = await scanMarkets();
      // Auto-process scanned opportunities through research + risk assessment
      let pipelineResult = { processed: 0, errors: 0 };
      if (result.added > 0) {
        pipelineResult = await processPipeline();
      }
      return res.json({
        ok: true,
        message: `Сканирование: ${result.added} новых, исследовано: ${pipelineResult.processed}`,
        ...result,
        pipeline: pipelineResult,
      });
    } catch (err) {
      console.error("[Pipeline] Scan error:", err);
      return res.status(500).json({ message: "Ошибка сканирования рынков" });
    }
  });

  // POST /api/pipeline/process — process all scanned opportunities
  app.post("/api/pipeline/process", async (_req: Request, res: Response) => {
    try {
      const result = await processPipeline();
      return res.json({
        ok: true,
        message: `Обработано ${result.processed} возможностей`,
        ...result,
      });
    } catch (err) {
      console.error("[Pipeline] Process error:", err);
      return res.status(500).json({ message: "Ошибка обработки пайплайна" });
    }
  });

  // POST /api/pipeline/advance/:id — advance an opportunity to next stage
  app.post("/api/pipeline/advance/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Неверный ID" });

      const opp = await storage.getOpportunity(id);
      if (!opp) return res.status(404).json({ message: "Возможность не найдена" });

      // Stage progression
      const stageOrder = ["scanned", "researching", "researched", "estimated", "risk_assessed", "approved", "executed", "settled"];
      const currentIdx = stageOrder.indexOf(opp.pipelineStage);
      const nextStage = currentIdx >= 0 && currentIdx < stageOrder.length - 1
        ? stageOrder[currentIdx + 1]
        : opp.pipelineStage;

      await storage.updateOpportunity(id, { pipelineStage: nextStage });
      await storage.addAuditEntry("пайплайн", `Возможность #${id} переведена на стадию: ${nextStage}`, (req as any).userId);

      return res.json({ ok: true, stage: nextStage });
    } catch (err) {
      console.error("[Pipeline] Advance error:", err);
      return res.status(500).json({ message: "Ошибка продвижения стадии" });
    }
  });

  // GET /api/pipeline/positions
  app.get("/api/pipeline/positions", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const filter: { source: string; status?: string } = { source: "pipeline" };
      if (status && status !== "all") filter.status = status;

      const positions = await storage.getPositions(filter);
      return res.json(positions);
    } catch (err) {
      console.error("[Pipeline] Positions error:", err);
      return res.status(500).json({ message: "Ошибка загрузки позиций" });
    }
  });

  // GET /api/pipeline/trades
  app.get("/api/pipeline/trades", async (_req: Request, res: Response) => {
    try {
      const pipelinePositions = await storage.getPositions({ source: "pipeline" });
      const positionIds = new Set(pipelinePositions.map(p => p.id));

      const allExecs = await storage.getExecutions();
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
      const pipelinePositions = await storage.getPositions({ source: "pipeline" });
      const positionIds = new Set(pipelinePositions.map(p => p.id));

      const allSettlements = await storage.getSettlements();
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
      const postMortems = await storage.getPostMortems();
      return res.json(postMortems);
    } catch (err) {
      console.error("[Pipeline] Post-mortems error:", err);
      return res.status(500).json({ message: "Ошибка загрузки пост-мортемов" });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // CROSS-SOURCE ROUTES — used by frontend pages with ?source= param
  // ════════════════════════════════════════════════════════════════

  // GET /api/positions — universal positions endpoint
  app.get("/api/positions", async (req: Request, res: Response) => {
    try {
      const source = req.query.source as string | undefined;
      const status = req.query.status as string | undefined;
      const filter: { source?: string; status?: string } = {};
      if (source) filter.source = source;
      if (status && status !== "all") filter.status = status;
      return res.json(await storage.getPositions(filter));
    } catch (err) {
      console.error("[Positions] Error:", err);
      return res.status(500).json({ message: "Ошибка загрузки позиций" });
    }
  });

  // GET /api/executions — universal executions endpoint
  app.get("/api/executions", async (req: Request, res: Response) => {
    try {
      const source = req.query.source as string | undefined;
      if (source) {
        const positions = await storage.getPositions({ source });
        const positionIds = new Set(positions.map(p => p.id));
        const allExecs = await storage.getExecutions();
        return res.json(allExecs.filter(e => e.positionId && positionIds.has(e.positionId)));
      }
      return res.json(await storage.getExecutions());
    } catch (err) {
      console.error("[Executions] Error:", err);
      return res.status(500).json({ message: "Ошибка загрузки сделок" });
    }
  });

  // GET /api/settlements — universal settlements endpoint
  app.get("/api/settlements", async (req: Request, res: Response) => {
    try {
      const source = req.query.source as string | undefined;
      if (source) {
        const positions = await storage.getPositions({ source });
        const positionIds = new Set(positions.map(p => p.id));
        const allSettlements = await storage.getSettlements();
        return res.json(allSettlements.filter(s => positionIds.has(s.positionId)));
      }
      return res.json(await storage.getSettlements());
    } catch (err) {
      console.error("[Settlements] Error:", err);
      return res.status(500).json({ message: "Ошибка загрузки расчётов" });
    }
  });

  // GET /api/postmortems — alias for pipeline postmortems
  app.get("/api/postmortems", async (_req: Request, res: Response) => {
    try {
      return res.json(await storage.getPostMortems());
    } catch (err) {
      console.error("[PostMortems] Error:", err);
      return res.status(500).json({ message: "Ошибка загрузки пост-мортемов" });
    }
  });

  // GET /api/risk/stats — risk console stats
  app.get("/api/risk/stats", async (_req: Request, res: Response) => {
    try {
      const bankroll = parseFloat((await storage.getConfig("bankroll")) || DEFAULT_CONFIG.bankroll);
      const maxPosition = parseFloat((await storage.getConfig("max_position")) || "500");
      const maxDrawdownPct = parseFloat((await storage.getConfig("max_drawdown")) || "20");

      // Calculate allocated capital from open positions
      const openPositions = await storage.getPositions({ status: "open" });
      const allocated = openPositions.reduce((s, p) => s + (p.size ?? 0), 0);

      // Calculate current drawdown from settled positions
      const allPositions = await storage.getPositions({});
      const settled = allPositions.filter(p => p.status === "settled" || p.status === "closed");
      const totalPnl = settled.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
      const drawdown = totalPnl < 0 ? Math.abs(totalPnl) : 0;
      const maxDrawdown = bankroll * (maxDrawdownPct / 100);

      // Kelly fraction from win stats
      const wins = settled.filter(p => (p.realizedPnl ?? 0) > 0).length;
      const wr = settled.length > 0 ? wins / settled.length : 0;
      const avgWin = wins > 0 ? settled.filter(p => (p.realizedPnl ?? 0) > 0).reduce((s, p) => s + (p.realizedPnl ?? 0), 0) / wins : 0;
      const losses = settled.length - wins;
      const avgLoss = losses > 0 ? Math.abs(settled.filter(p => (p.realizedPnl ?? 0) <= 0).reduce((s, p) => s + (p.realizedPnl ?? 0), 0)) / losses : 1;
      const kellyFraction = avgLoss > 0 ? Math.max(0, wr - (1 - wr) / (avgWin / avgLoss || 1)) : 0;

      return res.json({
        bankroll,
        allocated: Math.round(allocated * 100) / 100,
        maxPosition,
        kellyFraction: Math.round(kellyFraction * 1000) / 1000,
        drawdown: Math.round(drawdown * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      });
    } catch (err) {
      console.error("[Risk] Stats error:", err);
      return res.status(500).json({ message: "Ошибка загрузки риск-данных" });
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
      const result = await runBacktest(numWindows);

      // Auto-apply backtest results as Thompson Sampling priors
      await applyBacktestPriors(result.results);
      await storage.addAuditEntry(
        "бэктест",
        `Бэктест ${numWindows} окон завершён, лучшая модель: ${result.bestModel} (${((result.results[0]?.winRate || 0) * 100).toFixed(1)}%), приоры Thompson Sampling обновлены`,
        (req as any).userId
      );

      return res.json({ ...result, priorsApplied: true });
    } catch (err) {
      console.error("[Backtest] Run error:", err);
      return res.status(500).json({ message: "Ошибка запуска бэктеста" });
    }
  });

  // POST /api/backtest/apply-priors — re-apply latest backtest to Thompson Sampling
  app.post("/api/backtest/apply-priors", async (req: Request, res: Response) => {
    try {
      const backtestResults = await storage.getLatestBacktestResults();
      if (backtestResults.length === 0) {
        return res.status(404).json({ message: "Нет результатов бэктеста" });
      }

      const parsed = backtestResults.map((r) => ({
        strategyName: r.strategyName,
        winRate: r.winRate,
        totalTrades: r.totalTrades,
        wins: r.wins,
        losses: r.losses,
      }));

      applyBacktestPriors(parsed);
      await storage.addAuditEntry("бэктест", "Приоры Thompson Sampling переприменены из последнего бэктеста", (req as any).userId);

      return res.json({ ok: true, applied: parsed.length });
    } catch (err) {
      console.error("[Backtest] Apply priors error:", err);
      return res.status(500).json({ message: "Ошибка применения приоров" });
    }
  });

  // GET /api/backtest/results
  app.get("/api/backtest/results", async (_req: Request, res: Response) => {
    try {
      const results = await storage.getLatestBacktestResults();
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
      const logs = await storage.getAuditLog(limit);
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
      const snapshots = await storage.getPerformanceSnapshots(source, limit);
      return res.json(snapshots);
    } catch (err) {
      console.error("[Performance] Snapshots error:", err);
      return res.status(500).json({ message: "Ошибка загрузки снимков производительности" });
    }
  });

  return httpServer;
}
