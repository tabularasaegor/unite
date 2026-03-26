import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import { initClobClient } from "./services/polymarket";
import { updatePositionPrices, checkMarketResolutions } from "./services/executionEngine";
import { checkSettlements, recordPerformanceSnapshot } from "./services/settlementMonitor";

export function log(message: string, source = "server") {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${time} [${source}]  ${message}`);
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && duration > 200) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 120)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  if (app.get("env") === "development") {
    await setupVite(app, httpServer);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000");
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    log(`Server running on port ${port}`);

    // Initialize Polymarket CLOB client for live trading
    if (process.env.POLY_PRIVATE_KEY) {
      initClobClient().then(ok => {
        if (ok) log("Polymarket CLOB client initialized");
        else log("Polymarket CLOB init failed — read-only mode");
      }).catch(err => {
        log(`Polymarket CLOB init error (non-fatal): ${err}`);
      });
    }

    // Background price updater — runs every 60 seconds
    const PRICE_UPDATE_INTERVAL = 60 * 1000; // 60s
    setInterval(async () => {
      try {
        const result = await updatePositionPrices();
        if (result.updated > 0) {
          // Also check settlements after price update
          const settlements = checkSettlements();
          if (settlements.settled > 0) {
            log(`Auto-settlement: ${settlements.settled} positions settled`, "ticker");
            recordPerformanceSnapshot();
          }
          // Check for market resolutions
          await checkMarketResolutions();
        }
      } catch (err) {
        // Silently ignore ticker errors
      }
    }, PRICE_UPDATE_INTERVAL);
    log("Background price ticker started (every 60s)");

    // Push DB schema (creates tables if missing, no-op if they exist)
    log("Pushing database schema...");
    import("child_process").then(({ execSync }) => {
      try {
        execSync("npx drizzle-kit push", { cwd: process.cwd(), stdio: "pipe" });
        log("Database schema pushed successfully");
      } catch (err) {
        log(`DB push warning: ${err}`);
      }
    });
  });
})();
