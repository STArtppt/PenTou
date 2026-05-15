/**
 * index.ts — Prod Node server entry.
 * Started by `node dist-server/src/server/index.js` (see package.json `start`).
 * Layout: docker-deploy/architecture.md §5.
 */
import http from "node:http";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import { handleApiRequest, ensureDirs } from "./api-router.js";
import {
  initPasswordHash,
  getOrCreateSessionSecret,
  authGuard,
  handleLogin,
  handleLogout,
  handleMe,
} from "./auth.js";
import { serveStatic } from "./static-server.js";
import { log } from "./logger.js";

const PORT = Number(process.env.PORT ?? 7766);
const DATA_DIR = process.env.DATA_DIR ?? "/app/data";
const TRUST_PROXY = (process.env.TRUST_PROXY ?? "1") !== "0";
const SESSION_MAX_AGE_SEC = Number(process.env.SESSION_MAX_AGE_SEC ?? 30 * 24 * 3600);
const LOG_HEALTHZ = process.env.LOG_HEALTHZ === "1";

// ── Pre-flight env validation ────────────────────────────────────────────────
const PWD = process.env.PENTOU_PASSWORD;
if (!PWD) {
  console.error("FATAL: PENTOU_PASSWORD env var is required");
  process.exit(1);
}

// Ensure dataDir is writable before opening the socket.
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  console.error(`FATAL: cannot write to ${DATA_DIR} (check volume ownership; container runs as uid=1000)`);
  process.exit(1);
}

ensureDirs(DATA_DIR);
const sessionSecret = getOrCreateSessionSecret(DATA_DIR);
initPasswordHash(PWD);
// Wipe the env var so the plaintext password isn't visible via /proc or a heap dump.
delete process.env.PENTOU_PASSWORD;

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
// dist-server/src/server/index.js → project root is 3 levels up.
const PROJECT_ROOT = path.resolve(HERE, "../../..");
const STATIC_ROOT = path.join(PROJECT_ROOT, "dist");

// Read package version once for /healthz.
let VERSION = "0.0.0";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  if (pkg.version) VERSION = String(pkg.version);
} catch { /* keep default */ }
log.info(`static root: ${STATIC_ROOT}`);

const authCtx = { sessionSecret, trustProxy: TRUST_PROXY, sessionMaxAgeSec: SESSION_MAX_AGE_SEC };

const startTime = Date.now();

function reply(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function handleHealthz(res: http.ServerResponse): void {
  // 503 if data dir lost writability mid-run (e.g. volume remount).
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
  } catch {
    reply(res, 503, { ok: false, reason: "fs_not_writable" });
    return;
  }
  reply(res, 200, {
    ok: true,
    version: VERSION,
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
  });
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  try {
    const u = req.url ?? "/";
    const pathOnly = u.split("?")[0];

    // 1. Health check (public).
    if (pathOnly === "/healthz") {
      handleHealthz(res);
      return;
    }

    // 2. Auth endpoints handled directly (login bypasses guard; logout/me require it).
    if (pathOnly === "/api/auth/login" && req.method === "POST") {
      await handleLogin(req, res, authCtx);
      return;
    }
    if (pathOnly === "/api/auth/logout" && req.method === "POST") {
      handleLogout(req, res);
      return;
    }
    if (pathOnly === "/api/auth/me" && req.method === "GET") {
      handleMe(req, res, authCtx);
      return;
    }

    // 3. Auth guard for everything else.
    const guard = authGuard(req, authCtx);
    if (guard === "401") { reply(res, 401, { error: "unauthenticated" }); return; }
    if (guard === "redirect-login") {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }

    // 4. /api/* shared router (dev + prod).
    if (pathOnly.startsWith("/api/")) {
      const handled = await handleApiRequest(req, res, { dataDir: DATA_DIR });
      if (!handled) reply(res, 404, { error: "not_found" });
      return;
    }

    // 5. /login → serve the standalone login.html (built by Vite multi-entry).
    if (pathOnly === "/login") {
      const loginHtml = path.join(STATIC_ROOT, "login.html");
      if (fs.existsSync(loginHtml)) {
        const body = fs.readFileSync(loginHtml);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(body.length),
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(body);
        return;
      }
      reply(res, 500, { error: "login_html_missing" });
      return;
    }

    // 6. Static assets + SPA fallback.
    serveStatic(req, res, STATIC_ROOT);
  } catch (e: any) {
    log.error(`unhandled ${req.method} ${req.url}: ${e?.stack ?? String(e)}`);
    if (!res.headersSent) reply(res, 500, { error: "internal" });
  } finally {
    if (req.url !== "/healthz" || LOG_HEALTHZ) {
      log.info(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
    }
  }
});

server.listen(PORT, () => {
  log.info(`Pentou listening on :${PORT}, dataDir=${DATA_DIR}, version=${VERSION}`);
});

function shutdown(signal: string): void {
  log.info(`received ${signal}, closing server`);
  server.close(() => process.exit(0));
  // Hard exit fallback if connections drag on.
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
