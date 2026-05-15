/**
 * pentouServerPlugin.ts
 * Vite plugin that装配共享 /api/* 路由层（src/server/api-router.ts）作为
 * dev 模式的 Express-like 中间件。Prod 模式由 src/server/index.ts 装配。
 *
 * Dev 模式**不接入**鉴权（本地直连无远程访问风险）。
 */
import type { Plugin } from "vite";
import path from "node:path";
import { handleApiRequest, ensureDirs } from "../src/server/api-router.js";

export function pentouServerPlugin(): Plugin {
  const dataDir = path.resolve(process.cwd(), "data");
  return {
    name: "pentou-server",
    configureServer(server) {
      ensureDirs(dataDir);
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleApiRequest(req, res, { dataDir });
          if (!handled) next();
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: String(e) }));
          }
        }
      });
    },
  };
}

// Re-export shared helpers so existing tests / external callers keep working.
export { conversationToMd, parseMdFile } from "../src/server/api-router.js";
