/**
 * static-server.ts
 * Serves files from a given root directory with:
 * - path whitelist (no `..` traversal)
 * - hand-rolled MIME table
 * - long cache for hashed assets, no-cache for index.html
 * - brotli/gzip pre-compressed negotiation (looks for sibling .br / .gz)
 * - SPA fallback to index.html (200) for unknown paths
 * - GET / HEAD only
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function mimeFor(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

function isHashed(p: string): boolean {
  // Vite emits files under /assets/ with a hash in the name (e.g. main-AbCdEf12.js).
  return /\/assets\//.test(p) && /-[A-Za-z0-9_-]{8,}\./.test(p);
}

function pickEncoding(req: IncomingMessage, abs: string): { abs: string; enc?: "br" | "gzip" } {
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (accept.includes("br") && fs.existsSync(abs + ".br")) {
    return { abs: abs + ".br", enc: "br" };
  }
  if (accept.includes("gzip") && fs.existsSync(abs + ".gz")) {
    return { abs: abs + ".gz", enc: "gzip" };
  }
  return { abs };
}

function send(req: IncomingMessage, res: ServerResponse, abs: string, status = 200, cacheControl?: string): void {
  // HEAD has no body but should still set headers.
  const stat = fs.statSync(abs);
  const isHead = req.method === "HEAD";
  const picked = isHead ? { abs } : pickEncoding(req, abs);
  const finalStat = picked.abs === abs ? stat : fs.statSync(picked.abs);

  const headers: Record<string, string> = {
    "Content-Type": mimeFor(abs),
    "Content-Length": String(finalStat.size),
  };
  if (picked.enc) {
    headers["Content-Encoding"] = picked.enc;
    headers["Vary"] = "Accept-Encoding";
  }
  if (cacheControl) headers["Cache-Control"] = cacheControl;

  res.writeHead(status, headers);
  if (isHead) {
    res.end();
    return;
  }
  fs.createReadStream(picked.abs).pipe(res);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): void {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = (req.url ?? "/").split("?")[0];

  // Whitelist: only paths that resolve inside root.
  const requested = path.normalize(path.join(root, decodeURIComponent(url)));
  if (!requested.startsWith(root)) {
    res.writeHead(404);
    res.end();
    return;
  }

  // Resolve actual file: direct hit, then SPA fallback.
  let target = requested;
  let cacheControl: string | undefined;

  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      if (target.endsWith("index.html") || target.endsWith("login.html")) {
        cacheControl = "no-cache, no-store, must-revalidate";
      } else if (isHashed(url)) {
        cacheControl = "public, max-age=31536000, immutable";
      }
      send(req, res, target, 200, cacheControl);
      return;
    }
  } catch {
    /* fall through to SPA fallback */
  }

  // SPA fallback — return index.html with 200 so the client router takes over.
  const fallback = path.join(root, "index.html");
  if (fs.existsSync(fallback)) {
    send(req, res, fallback, 200, "no-cache, no-store, must-revalidate");
    return;
  }

  res.writeHead(404);
  res.end();
}
