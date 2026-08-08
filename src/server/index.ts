/**
 * index.ts — Prod Node server entry.
 *
 * Two consumers (npx-launcher spec §4.2 / §4.4):
 *  1. npx CLI（bin/pentou.mjs）import 本模块并调用 `startServer(config)`（唯一契约）。
 *  2. Docker：直接执行 `node dist-server/src/server/index.js`，读 env 后调用 startServer。
 *
 * `import` 本模块不会监听端口——只有作为入口被直接执行时才走 Docker 启动路径。
 * Layout: docker-deploy/architecture.md §5。
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
  type AuthContext,
} from "./auth.js";
import { serveStatic } from "./static-server.js";
import { log } from "./logger.js";
import { resolveAppVersion } from "./app-version.js";

const TRUST_PROXY = (process.env.TRUST_PROXY ?? "1") !== "0";
const SESSION_MAX_AGE_SEC = Number(process.env.SESSION_MAX_AGE_SEC ?? 30 * 24 * 3600);
const LOG_HEALTHZ = process.env.LOG_HEALTHZ === "1";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
// dist-server/src/server/index.js → 包根（npm 包根 / Docker /app）是 3 层上。
const PROJECT_ROOT = path.resolve(HERE, "../../..");
const STATIC_ROOT = path.join(PROJECT_ROOT, "dist");

function readVersion(): string {
  return resolveAppVersion(PROJECT_ROOT);
}

// ── 编程启动接口（CLI 唯一契约，spec §4.4）─────────────────────────────────────

export interface StartServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** 本地模式：未传 password 时免登录 + 回环绑定（仅编程接口可开启）。 */
  local: boolean;
  password?: string;
}

export interface StartedServer {
  url: string;
  host: string;
  port: number;
  dataDir: string;
  close(): Promise<void>;
}

/** 监听地址 → 本机展示地址（spec §4.4 Host 校验与展示 URL）。 */
export function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "") return "127.0.0.1";
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`; // 裸 IPv6 字面量加括号
  return host;
}

function reply(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

interface HandlerDeps {
  dataDir: string;
  staticRoot: string;
  version: string;
  authCtx: AuthContext;
  obscuraBinDir: string;
  obscuraAllowDownload: boolean;
  startTime: number;
}

function createRequestHandler(deps: HandlerDeps): http.RequestListener {
  const { dataDir, staticRoot, version, authCtx, obscuraBinDir, obscuraAllowDownload, startTime } = deps;

  function handleHealthz(res: http.ServerResponse): void {
    // 503 if data dir lost writability mid-run (e.g. volume remount).
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
    } catch {
      reply(res, 503, { ok: false, reason: "fs_not_writable" });
      return;
    }
    reply(res, 200, {
      ok: true,
      version,
      uptimeSec: Math.floor((Date.now() - startTime) / 1000),
    });
  }

  return async (req, res) => {
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
        handleLogout(req, res, authCtx);
        return;
      }
      if (pathOnly === "/api/auth/me" && req.method === "GET") {
        handleMe(req, res, authCtx);
        return;
      }

      // 3. Auth guard for everything else (本地免登录时 authGuard 直接放行)。
      const guard = authGuard(req, authCtx);
      if (guard === "401") { reply(res, 401, { error: "unauthenticated" }); return; }
      if (guard === "redirect-login") {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }

      // 4. /api/* shared router (dev + prod).
      if (pathOnly.startsWith("/api/")) {
        const handled = await handleApiRequest(req, res, {
          dataDir,
          obscuraBinDir,
          obscuraAllowDownload,
          trustProxy: authCtx.trustProxy, // ingest 限速器取真实 IP（spec ingest-gateway US-03）
          version,
        });
        if (!handled) reply(res, 404, { error: "not_found" });
        return;
      }

      // 5. /login：本地免登录直接回到首页；否则 serve 独立 login.html。
      if (pathOnly === "/login") {
        if (authCtx.disabled) {
          res.writeHead(302, { Location: "/" });
          res.end();
          return;
        }
        const loginHtml = path.join(staticRoot, "login.html");
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
      serveStatic(req, res, staticRoot);
    } catch (e: any) {
      log.error(`unhandled ${req.method} ${req.url}: ${e?.stack ?? String(e)}`);
      if (!res.headersSent) reply(res, 500, { error: "internal" });
    } finally {
      if (req.url !== "/healthz" || LOG_HEALTHZ) {
        log.info(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
      }
    }
  };
}

/**
 * 启动服务并在 `listen` 成功后 resolve（spec §4.4）。
 * 启动期错误（数据目录不可写 / listen 失败）一律 reject，由调用方格式化。
 */
export async function startServer(config: StartServerConfig): Promise<StartedServer> {
  const { port, host, dataDir, local, password } = config;

  // 数据目录可写性前置校验（spec 异常 2）。
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch {
    throw new Error(`cannot write to data dir: ${dataDir}`);
  }

  ensureDirs(dataDir);
  const sessionSecret = getOrCreateSessionSecret(dataDir);

  // 本地模式且无密码 → 免登录；传了密码（本地或 Docker）→ 正常鉴权。
  const disabled = local && !password;
  if (password) initPasswordHash(password);

  const authCtx: AuthContext = {
    sessionSecret,
    // 本地直连无反代；Docker 走 env。
    trustProxy: local ? false : TRUST_PROXY,
    sessionMaxAgeSec: SESSION_MAX_AGE_SEC,
    disabled,
  };

  const version = readVersion();
  log.info(`static root: ${STATIC_ROOT}`);

  // 本地模式：obscura 惰性下载到 <dataDir>/bin；Docker：沿用 <cwd>/bin 不下载。
  const obscuraBinDir = local ? path.join(dataDir, "bin") : path.join(process.cwd(), "bin");

  const server = http.createServer(createRequestHandler({
    dataDir,
    staticRoot: STATIC_ROOT,
    version,
    authCtx,
    obscuraBinDir,
    obscuraAllowDownload: local,
    startTime: Date.now(),
  }));

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const displayUrl = `http://${displayHost(host)}:${port}`;
  log.info(`Pentou listening on ${displayUrl}, dataDir=${dataDir}, local=${local}, version=${version}`);

  return {
    url: displayUrl,
    host,
    port,
    dataDir,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => resolve(), 5_000).unref();
    }),
  };
}

// ── Docker 直接执行路径（仅 `node dist-server/src/server/index.js`）──────────────

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === url.pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const PWD = process.env.PENTOU_PASSWORD;
  if (!PWD) {
    console.error("FATAL: PENTOU_PASSWORD env var is required");
    process.exit(1);
  }
  const PORT = Number(process.env.PORT ?? 7766);
  const HOST = process.env.HOST ?? "0.0.0.0";
  const DATA_DIR = process.env.DATA_DIR ?? "/app/data";

  startServer({ port: PORT, host: HOST, dataDir: DATA_DIR, local: false, password: PWD })
    .then((srv) => {
      // 抹掉明文密码，避免经 /proc 或堆 dump 泄露（哈希已在 startServer 内初始化）。
      delete process.env.PENTOU_PASSWORD;
      const shutdown = (signal: string): void => {
        log.info(`received ${signal}, closing server`);
        srv.close().then(() => process.exit(0));
        setTimeout(() => process.exit(0), 5_000).unref();
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    })
    .catch((e: any) => {
      console.error(`FATAL: ${e?.message ?? String(e)}`);
      process.exit(1);
    });
}
