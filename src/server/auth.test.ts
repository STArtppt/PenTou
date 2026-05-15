import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  initPasswordHash,
  verifyPassword,
  _resetPasswordHash,
  signSession,
  verifySession,
  recordFail,
  isLimited,
  clearFails,
  _resetLimiter,
  clientIp,
  parseCookie,
  buildSetCookie,
  authGuard,
} from "./auth";

const SECRET = crypto.randomBytes(32);

function mockReq(opts: { url?: string; cookie?: string; xff?: string; xfp?: string; remote?: string } = {}): any {
  return {
    url: opts.url ?? "/",
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.xff ? { "x-forwarded-for": opts.xff } : {}),
      ...(opts.xfp ? { "x-forwarded-proto": opts.xfp } : {}),
    },
    socket: { remoteAddress: opts.remote ?? "127.0.0.1" },
  };
}

describe("password hashing", () => {
  beforeEach(() => _resetPasswordHash());

  it("verifies the correct password", () => {
    initPasswordHash("hunter2");
    expect(verifyPassword("hunter2")).toBe(true);
  });

  it("rejects a wrong password", () => {
    initPasswordHash("hunter2");
    expect(verifyPassword("wrong")).toBe(false);
  });

  it("rejects when not initialized", () => {
    expect(verifyPassword("anything")).toBe(false);
  });
});

describe("session cookie sign/verify", () => {
  it("round-trips a fresh token", () => {
    const t = signSession(60, SECRET);
    expect(verifySession(t, SECRET)).toBe(true);
  });

  it("rejects an empty / malformed token", () => {
    expect(verifySession("", SECRET)).toBe(false);
    expect(verifySession("not-a-token", SECRET)).toBe(false);
    expect(verifySession("a.b", SECRET)).toBe(false);
  });

  it("rejects with a different secret", () => {
    const t = signSession(60, SECRET);
    expect(verifySession(t, crypto.randomBytes(32))).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const t = signSession(60, SECRET);
    const [p, s] = t.split(".");
    // Flip the first byte of the payload.
    const decoded = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64");
    decoded[0] ^= 0xff;
    const tampered = decoded.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "." + s;
    expect(verifySession(tampered, SECRET)).toBe(false);
  });

  it("rejects an expired token", () => {
    // exp = now - 10s
    const expired = signSession(-10, SECRET);
    expect(verifySession(expired, SECRET)).toBe(false);
  });
});

describe("per-IP rate limiting", () => {
  beforeEach(() => _resetLimiter());

  it("allows up to MAX_FAILS within the window", () => {
    for (let i = 0; i < 4; i++) recordFail("1.1.1.1");
    expect(isLimited("1.1.1.1").limited).toBe(false);
  });

  it("limits at the MAX_FAILS threshold", () => {
    for (let i = 0; i < 5; i++) recordFail("1.1.1.1");
    const r = isLimited("1.1.1.1");
    expect(r.limited).toBe(true);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it("resets after the window has passed", () => {
    const longAgo = Date.now() - 16 * 60 * 1000;
    for (let i = 0; i < 5; i++) recordFail("1.1.1.1", longAgo);
    expect(isLimited("1.1.1.1", Date.now()).limited).toBe(false);
  });

  it("clearFails removes the bucket", () => {
    for (let i = 0; i < 5; i++) recordFail("1.1.1.1");
    clearFails("1.1.1.1");
    expect(isLimited("1.1.1.1").limited).toBe(false);
  });

  it("isolates IPs", () => {
    for (let i = 0; i < 5; i++) recordFail("1.1.1.1");
    expect(isLimited("2.2.2.2").limited).toBe(false);
  });
});

describe("clientIp", () => {
  it("uses leftmost X-Forwarded-For when trustProxy=true", () => {
    expect(clientIp(mockReq({ xff: "1.2.3.4, 5.6.7.8", remote: "10.0.0.1" }), true)).toBe("1.2.3.4");
  });

  it("falls back to socket.remoteAddress when trustProxy=false", () => {
    expect(clientIp(mockReq({ xff: "1.2.3.4", remote: "10.0.0.1" }), false)).toBe("10.0.0.1");
  });

  it("falls back to socket.remoteAddress when XFF missing", () => {
    expect(clientIp(mockReq({ remote: "10.0.0.1" }), true)).toBe("10.0.0.1");
  });
});

describe("parseCookie", () => {
  it("parses a single cookie", () => {
    expect(parseCookie("a=1")).toEqual({ a: "1" });
  });
  it("parses multiple cookies", () => {
    expect(parseCookie("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });
  it("ignores malformed entries", () => {
    expect(parseCookie("a=1; broken; b=2")).toEqual({ a: "1", b: "2" });
  });
  it("handles undefined", () => {
    expect(parseCookie(undefined)).toEqual({});
  });
});

describe("buildSetCookie", () => {
  const opts = { trustProxy: true, sessionMaxAgeSec: 3600 };

  it("includes Secure when X-Forwarded-Proto=https", () => {
    const c = buildSetCookie("tok", mockReq({ xfp: "https" }), opts);
    expect(c).toMatch(/Secure/);
  });

  it("omits Secure when X-Forwarded-Proto is missing", () => {
    const c = buildSetCookie("tok", mockReq({}), opts);
    expect(c).not.toMatch(/Secure/);
  });

  it("omits Secure when trustProxy=false even on https", () => {
    const c = buildSetCookie("tok", mockReq({ xfp: "https" }), { ...opts, trustProxy: false });
    expect(c).not.toMatch(/Secure/);
  });

  it("always includes HttpOnly + SameSite=Lax + Max-Age", () => {
    const c = buildSetCookie("tok", mockReq({}), opts);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Max-Age=3600/);
  });
});

describe("authGuard", () => {
  const ctx = { sessionSecret: SECRET, trustProxy: true, sessionMaxAgeSec: 3600 };
  const validToken = signSession(60, SECRET);

  it("passes public paths without a cookie", () => {
    expect(authGuard(mockReq({ url: "/login" }), ctx)).toBe("pass");
    expect(authGuard(mockReq({ url: "/healthz" }), ctx)).toBe("pass");
    expect(authGuard(mockReq({ url: "/api/auth/login" }), ctx)).toBe("pass");
    expect(authGuard(mockReq({ url: "/assets/main.js" }), ctx)).toBe("pass");
    expect(authGuard(mockReq({ url: "/favicon.ico" }), ctx)).toBe("pass");
  });

  it("redirects unauthenticated SPA paths to /login", () => {
    expect(authGuard(mockReq({ url: "/" }), ctx)).toBe("redirect-login");
    expect(authGuard(mockReq({ url: "/folder/123" }), ctx)).toBe("redirect-login");
  });

  it("returns 401 on unauthenticated /api/* (except auth/login)", () => {
    expect(authGuard(mockReq({ url: "/api/conversations" }), ctx)).toBe("401");
    expect(authGuard(mockReq({ url: "/api/auth/me" }), ctx)).toBe("401");
  });

  it("passes when a valid session cookie is present", () => {
    expect(authGuard(mockReq({ url: "/api/conversations", cookie: `pentou_session=${validToken}` }), ctx))
      .toBe("pass");
    expect(authGuard(mockReq({ url: "/", cookie: `pentou_session=${validToken}` }), ctx))
      .toBe("pass");
  });

  it("rejects tampered cookies", () => {
    expect(authGuard(mockReq({ url: "/api/conversations", cookie: "pentou_session=bogus.value" }), ctx))
      .toBe("401");
  });
});
