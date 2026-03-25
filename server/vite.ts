import { type Express } from "express";
import { type Server } from "http";

export async function setupVite(app: Express, httpServer: Server) {
  // Dynamic import to avoid CJS bundling issues
  const { createServer: createViteServer, createLogger } = await import("vite");
  const viteConfig = (await import("../vite.config")).default;
  const fs = await import("fs");
  const path = await import("path");
  const { nanoid } = await import("nanoid");

  const viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    hmr: { server: httpServer, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg: string, options?: any) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        process.cwd(),
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
