/**
 * auth.ts
 * 鉴权模块：scrypt 密码哈希 + HMAC-SHA256 Session Cookie 签名 + per-IP 限流 +
 * 时序去抖 + 鉴权 guard + login/logout/me handler。
 *
 * 设计依据：docker-deploy/architecture.md §4.2。dev 模式（Vite plugin）**不接入**。
 */
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Password hashing (scrypt) ─────────────────────────────────────────────────
// Single-user / single-password — static salt acceptable per architecture §4.2.1.

const SALT = Buffer.from("pentou-static-salt-v1");
const SCRYPT_N = 1 << 14;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 32;

let passwordHash: Buffer | null = null;

export function initPasswordHash(plain: string): void {
  passwordHash = crypto.scryptSync(plain, SALT, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
}

export function verifyPassword(plain: string): boolean {
  if (!passwordHash) return false;
  const candidate = crypto.scryptSync(plain, SALT, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return crypto.timingSafeEqual(candidate, passwordHash);
}

// Reset for tests; not exported in production paths.
export function _resetPasswordHash(): void {
  passwordHash = null;
}

// ── Cookie signing (HMAC) ─────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
  return Buffer.from(s + pad, "base64");
}

export function signSession(maxAgeSec: number, secret: Buffer): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + maxAgeSec }));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}

export function verifySession(value: string, secret: Buffer): boolean {
  if (!value || typeof value !== "string") return false;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot >= value.length - 1) return false;
  const p = value.slice(0, dot);
  const s = value.slice(dot + 1);
  let payload: Buffer;
  let sig: Buffer;
  try {
    payload = b64urlDecode(p);
    sig = b64urlDecode(s);
  } catch {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(sig, expected)) return false;
  try {
    const obj = JSON.parse(payload.toString("utf8"));
    return typeof obj?.exp === "number" && obj.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// ── Rate limiting (per-IP, in-memory) ─────────────────────────────────────────

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Bucket { fails: number; firstFailAt: number }
const buckets = new Map<string, Bucket>();

export function recordFail(ip: string, now: number = Date.now()): void {
  const b = buckets.get(ip);
  if (!b || now - b.firstFailAt > WINDOW_MS) {
    buckets.set(ip, { fails: 1, firstFailAt: now });
    return;
  }
  b.fails += 1;
}

export function isLimited(ip: string, now: number = Date.now()): { limited: boolean; retryAfterSec: number } {
  const b = buckets.get(ip);
  if (!b) return { limited: false, retryAfterSec: 0 };
  if (now - b.firstFailAt > WINDOW_MS) {
    buckets.delete(ip);
    return { limited: false, retryAfterSec: 0 };
  }
  if (b.fails < MAX_FAILS) return { limited: false, retryAfterSec: 0 };
  const elapsed = now - b.firstFailAt;
  const remainingMs = WINDOW_MS - elapsed;
  return { limited: true, retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

export function clearFails(ip: string): void {
  buckets.delete(ip);
}

// Periodic cleanup of expired buckets. Only schedule outside test envs.
if (typeof process !== "undefined" && process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) {
      if (now - b.firstFailAt > WINDOW_MS) buckets.delete(ip);
    }
  }, 60_000).unref?.();
}

// Reset for tests.
export function _resetLimiter(): void {
  buckets.clear();
}

// ── Client IP / Cookie helpers ────────────────────────────────────────────────

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0) {
      return xff[0].split(",")[0].trim();
    }
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export interface CookieOptions {
  trustProxy: boolean;
  sessionMaxAgeSec: number;
}

export function buildSetCookie(token: string, req: IncomingMessage, opts: CookieOptions): string {
  const xfp = String(req.headers["x-forwarded-proto"] ?? "");
  const secure = opts.trustProxy && xfp === "https";
  const parts = [
    `pentou_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${opts.sessionMaxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(): string {
  return "pentou_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

// ── Auth guard ────────────────────────────────────────────────────────────────

export interface AuthContext {
  sessionSecret: Buffer;
  trustProxy: boolean;
  sessionMaxAgeSec: number;
}

export type GuardResult = "pass" | "redirect-login" | "401";

const PUBLIC_PREFIXES = ["/assets/", "/login.html"];
const PUBLIC_EXACT = new Set([
  "/login",
  "/healthz",
  "/api/auth/login",
  "/favicon.ico",
]);

export function authGuard(req: IncomingMessage, ctx: AuthContext): GuardResult {
  const url = req.url ?? "/";
  const pathOnly = url.split("?")[0];
  if (PUBLIC_EXACT.has(pathOnly)) return "pass";
  if (PUBLIC_PREFIXES.some((p) => pathOnly.startsWith(p))) return "pass";

  const cookies = parseCookie(req.headers.cookie);
  const sess = cookies["pentou_session"];
  if (sess && verifySession(sess, ctx.sessionSecret)) return "pass";

  return pathOnly.startsWith("/api/") ? "401" : "redirect-login";
}

// ── Handlers (login / logout / me) ────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown, extraHeaders?: Record<string, string>): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...(extraHeaders ?? {}),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse, ctx: AuthContext): Promise<void> {
  const ip = clientIp(req, ctx.trustProxy);
  const limit = isLimited(ip);
  if (limit.limited) {
    json(res, 429, { error: "too_many_attempts", retryAfterSec: limit.retryAfterSec }, {
      "Retry-After": String(limit.retryAfterSec),
    });
    return;
  }

  let payload: any = {};
  try { payload = JSON.parse(await readBody(req)); } catch {}
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (verifyPassword(password)) {
    clearFails(ip);
    const token = signSession(ctx.sessionMaxAgeSec, ctx.sessionSecret);
    const cookie = buildSetCookie(token, req, ctx);
    res.writeHead(204, { "Set-Cookie": cookie });
    res.end();
    return;
  }

  recordFail(ip);
  // Timing de-bounce to keep success/failure response times indistinguishable
  // (PRD US-02 AC3). Skip in tests for speed.
  if (!isTestEnv()) {
    const delay = 300 + Math.floor(Math.random() * 200);
    await sleep(delay);
  }
  // PRD US-02 AC4: the 6th attempt (after 5 consecutive failures) returns 429.
  // The current attempt's 5th fail still returns 401; the next attempt will hit
  // the top-of-handler limit check.
  json(res, 401, { error: "invalid_password" });
}

export function handleLogout(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(204, { "Set-Cookie": buildClearCookie() });
  res.end();
}

export function handleMe(req: IncomingMessage, res: ServerResponse, ctx: AuthContext): void {
  const cookies = parseCookie(req.headers.cookie);
  const sess = cookies["pentou_session"];
  if (sess && verifySession(sess, ctx.sessionSecret)) {
    json(res, 200, { authenticated: true });
    return;
  }
  json(res, 401, { authenticated: false });
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

// ── Session secret file (read-or-create) ──────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export function getOrCreateSessionSecret(dataDir: string): Buffer {
  const p = path.join(dataDir, ".session-secret");
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    if (buf.length >= 16) return buf;
    // Corrupted/short — back up and regenerate.
    const backup = `${p}.bak-${Date.now()}`;
    fs.renameSync(p, backup);
  }
  const buf = crypto.randomBytes(32);
  fs.writeFileSync(p, buf, { mode: 0o600 });
  return buf;
}
