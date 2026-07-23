/**
 * ingest.test.ts — Ingest Gateway 测试（spec ingest-gateway §6.1 / §6.2）。
 * 覆盖：token 模块 / externalKey upsert 与 frontmatter 往返 / 请求校验 /
 * 响应模型 / 两级派发 / 脱敏集成 / CORS 矩阵 / ping 无副作用 / 限速。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { handleApiRequest, conversationToMd, parseMdFile } from "./api-router";
import { getIngestToken, rotateIngestToken, verifyIngestToken, readIngestConfig } from "./ingest-token";
import { _resetLimiter } from "./auth";
import { registerRawNormalizer, _resetRawNormalizersForTest } from "../shared/normalizers/registry";

const cleanupDirs: string[] = [];

beforeEach(() => {
  _resetLimiter();
  _resetRawNormalizersForTest();
});

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "pentou-ingest-"));
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

async function call(params: {
  dataDir: string;
  method?: string;
  url: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  ip?: string;
}): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const raw = params.rawBody ?? (params.body === undefined ? "" : JSON.stringify(params.body));
  const buf = Buffer.from(raw);
  const req = Readable.from(buf.length ? [buf] : []) as any;
  req.method = params.method ?? "GET";
  req.url = params.url;
  req.headers = {
    ...(buf.length ? { "content-type": "application/json", "content-length": String(buf.length) } : {}),
    ...(params.headers ?? {}),
  };
  req.socket = { remoteAddress: params.ip ?? "127.0.0.1" };

  let status = 0;
  let responseHeaders: Record<string, string> = {};
  let responseBody = "";
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const res = {
    headersSent: false,
    writeHead(code: number, headers?: Record<string, string>) {
      status = code;
      responseHeaders = { ...(headers ?? {}) };
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    end(chunk?: string | Buffer) {
      if (chunk) responseBody += chunk.toString();
      resolveDone();
      return this;
    },
  } as any;

  const handled = await handleApiRequest(req, res, { dataDir: params.dataDir });
  if (!handled) {
    return { status: 404, headers: {}, body: undefined };
  }
  await done;
  return { status, headers: responseHeaders, body: responseBody ? JSON.parse(responseBody) : undefined };
}

function authed(dataDir: string): Record<string, string> {
  return { authorization: `Bearer ${getIngestToken(dataDir)}` };
}

function listAllFiles(dir: string): string[] {
  const acc: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) acc.push(...listAllFiles(full));
    else acc.push(full);
  }
  return acc.sort();
}

const CLAUDE_JSONL = [
  '{"type":"human","message":{"content":"hello world"},"timestamp":"2026-07-01T00:00:00.000Z"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"hi there"}]},"timestamp":"2026-07-01T00:00:05.000Z"}',
].join("\n");

const CLAUDE_JSONL_GROWN = [
  CLAUDE_JSONL,
  '{"type":"human","message":{"content":"and a follow-up"},"timestamp":"2026-07-01T00:01:00.000Z"}',
  '{"type":"assistant","message":{"content":"sure thing"},"timestamp":"2026-07-01T00:01:05.000Z"}',
].join("\n");

const CLAUDE_JSONL_OTHER = [
  '{"type":"human","message":{"content":"a totally different session"},"timestamp":"2026-07-02T00:00:00.000Z"}',
  '{"type":"assistant","message":{"content":"indeed it is"},"timestamp":"2026-07-02T00:00:05.000Z"}',
].join("\n");

function ingestItem(overrides: Record<string, unknown> = {}) {
  return {
    platform: "claude-code",
    externalId: "sess-42",
    format: "raw",
    data: CLAUDE_JSONL,
    filename: "session.jsonl",
    ...overrides,
  };
}

// ── token 模块（§6.1）─────────────────────────────────────────────────────────

describe("ingest token module", () => {
  it("auto-generates a 32-byte base64url token on first read, file mode 0600", () => {
    const dataDir = makeDataDir();
    const token = getIngestToken(dataDir);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getIngestToken(dataDir)).toBe(token); // 幂等
    const mode = fs.statSync(path.join(dataDir, "ingest", "token")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("verifies only the exact token; rotate invalidates the old one", () => {
    const dataDir = makeDataDir();
    const token = getIngestToken(dataDir);
    expect(verifyIngestToken(dataDir, token)).toBe(true);
    expect(verifyIngestToken(dataDir, token + "x")).toBe(false);
    expect(verifyIngestToken(dataDir, "")).toBe(false);
    const next = rotateIngestToken(dataDir);
    expect(next).not.toBe(token);
    expect(verifyIngestToken(dataDir, token)).toBe(false);
    expect(verifyIngestToken(dataDir, next)).toBe(true);
  });

  it("defaults redact config to true", () => {
    const dataDir = makeDataDir();
    expect(readIngestConfig(dataDir)).toEqual({ redact: true });
  });
});

// ── frontmatter externalKey 往返（§6.1）───────────────────────────────────────

describe("externalKey frontmatter roundtrip", () => {
  it("roundtrips externalKey / ingestSource incl. colon and non-ASCII externalId", () => {
    for (const externalId of ["plain-id", "id:with:colons", "带中文 και ünïcode", 'q"uote']) {
      const externalKey = `chatgpt:${encodeURIComponent(externalId)}`;
      const conv = {
        id: "conv_rt1",
        title: "Roundtrip",
        platform: "ChatGPT",
        date: "2026-07-01T00:00:00.000Z",
        folderId: null,
        externalKey,
        ingestSource: "extension",
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-07-01T00:00:00.000Z" }],
      };
      const parsed = parseMdFile("conv_rt1", conversationToMd(conv));
      expect(parsed.externalKey).toBe(externalKey);
      expect(parsed.ingestSource).toBe("extension");
    }
  });
});

// ── 鉴权与 CORS（US-03 / US-04）───────────────────────────────────────────────

describe("ingest auth and CORS", () => {
  it("answers OPTIONS preflight with 204 and CORS headers", async () => {
    const dataDir = makeDataDir();
    for (const url of ["/api/ingest", "/api/ingest/ping"]) {
      const res = await call({ dataDir, method: "OPTIONS", url });
      expect(res.status).toBe(204);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(res.headers["Access-Control-Allow-Headers"]).toBe("Authorization, Content-Type");
      expect(res.headers["Access-Control-Allow-Methods"]).toBe("POST, GET");
    }
  });

  it("rejects missing/wrong token with 401 + CORS header and writes nothing", async () => {
    const dataDir = makeDataDir();
    getIngestToken(dataDir); // 先生成，避免快照差异
    const before = listAllFiles(dataDir);

    const noToken = await call({ dataDir, method: "POST", url: "/api/ingest", body: { source: "cli", items: [ingestItem()] } });
    expect(noToken.status).toBe(401);
    expect(noToken.headers["Access-Control-Allow-Origin"]).toBe("*");

    const badToken = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [ingestItem()] },
      headers: { authorization: "Bearer wrong-token-value" },
    });
    expect(badToken.status).toBe(401);
    expect(listAllFiles(dataDir)).toEqual(before);
  });

  it("GET /api/ingest/ping: 200 with no side effects; wrong token 401 feeds the IP limiter", async () => {
    const dataDir = makeDataDir();
    const headers = authed(dataDir);
    const before = listAllFiles(dataDir);

    const ok = await call({ dataDir, url: "/api/ingest/ping", headers });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(listAllFiles(dataDir)).toEqual(before); // 无任何副作用（决策 9）

    // 5 次错误尝试后第 6 次 429（复用登录限速器语义）
    for (let i = 0; i < 5; i++) {
      const fail = await call({ dataDir, url: "/api/ingest/ping", headers: { authorization: "Bearer nope" }, ip: "10.0.0.9" });
      expect(fail.status).toBe(401);
    }
    const limited = await call({ dataDir, url: "/api/ingest/ping", headers, ip: "10.0.0.9" });
    expect(limited.status).toBe(429);
    expect(limited.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(limited.headers["Retry-After"]).toBeDefined();
  });

  it("does not add CORS headers to non-ingest APIs", async () => {
    const dataDir = makeDataDir();
    const res = await call({ dataDir, url: "/api/conversations" });
    expect(res.status).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("serves config and rotate on same-origin endpoints without CORS; rotate invalidates old token", async () => {
    const dataDir = makeDataDir();
    const config = await call({ dataDir, url: "/api/ingest/config" });
    expect(config.status).toBe(200);
    expect(config.body.redact).toBe(true);
    expect(config.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(config.headers["Access-Control-Allow-Origin"]).toBeUndefined();

    const oldToken = config.body.token;
    const rotated = await call({ dataDir, method: "POST", url: "/api/ingest/token/rotate" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.token).not.toBe(oldToken);

    const oldPing = await call({ dataDir, url: "/api/ingest/ping", headers: { authorization: `Bearer ${oldToken}` } });
    expect(oldPing.status).toBe(401);
    const newPing = await call({ dataDir, url: "/api/ingest/ping", headers: { authorization: `Bearer ${rotated.body.token}` } });
    expect(newPing.status).toBe(200);
  });
});

// ── 请求校验（§6.1）───────────────────────────────────────────────────────────

describe("ingest request validation", () => {
  it.each([
    ["empty items", { source: "cli", items: [] }, 400],
    ["missing source", { items: [ingestItem()] }, 400],
    ["uppercase platform", { source: "cli", items: [ingestItem({ platform: "ChatGPT" })] }, 400],
    ["platform with colon", { source: "cli", items: [ingestItem({ platform: "a:b" })] }, 400],
    ["empty platform", { source: "cli", items: [ingestItem({ platform: "" })] }, 400],
    ["invalid format", { source: "cli", items: [ingestItem({ format: "xml" })] }, 400],
  ])("rejects %s with expected status", async (_name, body, expected) => {
    const dataDir = makeDataDir();
    const res = await call({ dataDir, method: "POST", url: "/api/ingest", body, headers: authed(dataDir) });
    expect(res.status).toBe(expected);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("rejects more than 50 items with 413", async () => {
    const dataDir = makeDataDir();
    const items = Array.from({ length: 51 }, () => ingestItem());
    const res = await call({ dataDir, method: "POST", url: "/api/ingest", body: { source: "cli", items }, headers: authed(dataDir) });
    expect(res.status).toBe(413);
  });

  it("rejects oversized bodies with 413 (declared content-length)", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [ingestItem()] },
      headers: { ...authed(dataDir), "content-length": String(11 * 1024 * 1024) },
    });
    expect(res.status).toBe(413);
  });

  it("marks invalid externalId as per-item error without failing the batch", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: {
        source: "cli",
        items: [
          ingestItem({ externalId: "x".repeat(257) }),
          ingestItem({ externalId: "has\ncontrol" }),
          ingestItem({ externalId: "ok-1" }),
        ],
      },
      headers: authed(dataDir),
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[0]).toMatchObject({ itemIndex: 0, error: "invalid externalId", conversations: [] });
    expect(res.body.results[1]).toMatchObject({ itemIndex: 1, error: "invalid externalId", conversations: [] });
    expect(res.body.results[2].conversations[0].action).toBe("created");
  });
});

// ── externalId 幂等 upsert（US-01）────────────────────────────────────────────

describe("externalId-first idempotent upsert", () => {
  it("created → merged (title drift ok, versioned) → skipped", async () => {
    const dataDir = makeDataDir();
    const headers = authed(dataDir);
    const post = (data: string) => call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [ingestItem({ data })] },
      headers,
    });

    // 1. created + frontmatter externalKey
    const first = await post(CLAUDE_JSONL);
    expect(first.status).toBe(200);
    const created = first.body.results[0].conversations[0];
    expect(created.action).toBe("created");
    const md = fs.readFileSync(path.join(dataDir, "conversations", `${created.id}.md`), "utf-8");
    expect(md).toContain('externalKey: "claude-code:sess-42"'); // 含冒号 → frontmatter 加引号
    // cli 源细化为 cli:<form-slug>（spec collector-source-expansion §4.4）
    expect(md).toContain('ingestSource: "cli:claude-code"');

    // 2. 追加轮次重传（标题不变场景由 JSONL 决定；再用 conversation 格式验标题漂移）
    const second = await post(CLAUDE_JSONL_GROWN);
    const merged = second.body.results[0].conversations[0];
    expect(merged.action).toBe("merged");
    expect(merged.id).toBe(created.id); // 命中同一条目

    const versions = await call({ dataDir, url: `/api/conversations/${created.id}/versions` });
    expect(versions.status).toBe(200);
    expect(versions.body.versions.some((v: any) => v.type === "pre-import-overwrite")).toBe(true);

    // 3. 相同内容重传 → skipped，版本数不变
    const versionCount = versions.body.versions.length;
    const third = await post(CLAUDE_JSONL_GROWN);
    expect(third.body.results[0].conversations[0]).toMatchObject({ action: "skipped", id: created.id });
    const versionsAfter = await call({ dataDir, url: `/api/conversations/${created.id}/versions` });
    expect(versionsAfter.body.versions.length).toBe(versionCount);
  });

  it("matches by externalId even when title and first user message drift", async () => {
    const dataDir = makeDataDir();
    const headers = authed(dataDir);
    const convPayload = (title: string, firstMsg: string) => ({
      source: "extension",
      items: [{
        platform: "chatgpt",
        externalId: "uuid-123",
        format: "conversation",
        data: {
          title,
          platform: "ChatGPT",
          date: "2026-07-01T00:00:00.000Z",
          messages: [
            { id: "m1", role: "user", content: firstMsg, timestamp: "2026-07-01T00:00:00.000Z" },
            { id: "m2", role: "ai", content: "answer", timestamp: "2026-07-01T00:00:01.000Z" },
          ],
        },
      }],
    });

    const first = await call({ dataDir, method: "POST", url: "/api/ingest", body: convPayload("New chat", "question v1"), headers });
    const created = first.body.results[0].conversations[0];
    expect(created.action).toBe("created");

    // 标题被平台改写 + 首条消息被编辑 → 指纹全漂移，但 externalId 仍命中
    const second = await call({ dataDir, method: "POST", url: "/api/ingest", body: convPayload("Model generated title", "question v2 (edited)"), headers });
    expect(second.body.results[0].conversations[0]).toMatchObject({ action: "merged", id: created.id });

    const files = fs.readdirSync(path.join(dataDir, "conversations")).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1); // 未产生重复条目
  });

  it("falls back to fingerprint dedup when externalId is absent", async () => {
    const dataDir = makeDataDir();
    const headers = authed(dataDir);
    const body = {
      source: "cli",
      items: [ingestItem({ externalId: undefined })],
    };
    const first = await call({ dataDir, method: "POST", url: "/api/ingest", body, headers });
    expect(first.body.results[0].conversations[0].action).toBe("created");
    const md = fs.readFileSync(
      path.join(dataDir, "conversations", `${first.body.results[0].conversations[0].id}.md`), "utf-8");
    expect(md).not.toContain("externalKey:");

    const second = await call({ dataDir, method: "POST", url: "/api/ingest", body, headers });
    expect(second.body.results[0].conversations[0].action).toBe("skipped"); // 指纹三分支不变
  });

  it("preserves externalKey when a manual import merges into an ingest-created conversation", async () => {
    const dataDir = makeDataDir();
    const headers = authed(dataDir);
    const first = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [ingestItem()] }, headers,
    });
    const created = first.body.results[0].conversations[0];

    // 手动文件导入路径（POST /api/conversations，无 externalId）指纹命中同一条
    const manual = await call({
      dataDir, method: "POST", url: "/api/conversations",
      body: {
        id: "conv_manual_1",
        title: "hello world",
        platform: "Claude",
        date: "2026-07-01T00:00:00.000Z",
        folderId: null,
        messages: [
          { id: "m1", role: "user", content: "hello world", timestamp: "2026-07-01T00:00:00.000Z" },
          { id: "m2", role: "ai", content: "hi there", timestamp: "2026-07-01T00:00:05.000Z" },
          { id: "m3", role: "user", content: "extra manual turn", timestamp: "2026-07-01T00:02:00.000Z" },
        ],
      },
    });
    expect(manual.body.action).toBe("merged");
    const md = fs.readFileSync(path.join(dataDir, "conversations", `${created.id}.md`), "utf-8");
    expect(md).toContain('externalKey: "claude-code:sess-42"'); // 身份键未被抹掉
  });
});

// ── 批量与响应模型（US-02 / 决策 8）───────────────────────────────────────────

describe("batch semantics and result model", () => {
  it("keeps results same-length/same-order with itemIndex; one bad item doesn't affect the rest", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: {
        source: "cli",
        items: [
          ingestItem({ externalId: "a-1" }),
          ingestItem({ externalId: "b-1", data: "complete garbage", filename: "notes.xyz" }),
          ingestItem({ externalId: "c-1", data: CLAUDE_JSONL_OTHER }),
        ],
      },
      headers: authed(dataDir),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false); // 有失败 item
    expect(res.body.results.map((r: any) => r.itemIndex)).toEqual([0, 1, 2]);
    expect(res.body.results[0].conversations[0].action).toBe("created");
    expect(res.body.results[1]).toMatchObject({ error: "unrecognized format", conversations: [] });
    expect(res.body.results[2].conversations[0].action).toBe("created");
  });

  it("collects all conversations from one multi-conversation raw item", async () => {
    const dataDir = makeDataDir();
    const hermes = JSON.stringify([
      { session_id: "s1", title: "First", messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }] },
      { session_id: "s2", title: "Second", messages: [{ role: "user", content: "q2" }, { role: "assistant", content: "a2" }] },
    ]);
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [{ platform: "hermes", externalId: "multi", format: "raw", data: hermes, filename: "export.json" }] },
      headers: authed(dataDir),
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1); // results 仍与 items 等长同序
    const conversations = res.body.results[0].conversations;
    expect(conversations).toHaveLength(2);
    expect(conversations.every((c: any) => c.action === "created")).toBe(true);
    // 多对话时 externalId 无法对应单条 → 不写 externalKey（走指纹）
    for (const c of conversations) {
      const md = fs.readFileSync(path.join(dataDir, "conversations", `${c.id}.md`), "utf-8");
      expect(md).not.toContain("externalKey:");
    }
  });

  it("returns per-item errors for unparseable payloads", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: {
        source: "cli",
        items: [
          { platform: "chatgpt", format: "raw", data: "{}", filename: "empty.json" },       // 解析出 0 条
          { platform: "chatgpt", format: "conversation", data: { title: "no messages" } },  // 结构非法
          { platform: "chatgpt", format: "raw", data: 42 },                                  // raw 非字符串
        ],
      },
      headers: authed(dataDir),
    });
    expect(res.body.results[0].error).toBe("chatgpt raw payload missing mapping");
    expect(res.body.results[1].error).toBe("invalid conversation payload");
    expect(res.body.results[2].error).toBe("raw data must be a string");
  });

  it("classifies empty sessions as skippedReason instead of error (边界 3)", async () => {
    const dataDir = makeDataDir();
    // 只跑了 /exit 的 Claude Code 会话：仅元数据行，无真实对话
    const metaOnly = '{"type":"mode","mode":"normal"}\n{"type":"file-history-snapshot","snapshot":{}}\n';
    // 只有 system prompt 的 grok-cli 会话
    const systemOnly = '{"type":"system","content":"You are Grok"}\n';
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: {
        source: "cli",
        items: [
          { platform: "claude-code", format: "raw", data: metaOnly, filename: "s.jsonl" },
          { platform: "grok-cli", format: "raw", data: systemOnly, filename: "chat_history.jsonl" },
        ],
      },
      headers: authed(dataDir),
    });
    expect(res.body.ok).toBe(true); // 空会话不算失败
    expect(res.body.results[0]).toMatchObject({ skippedReason: "no conversations parsed", conversations: [] });
    expect(res.body.results[0].error).toBeUndefined();
    expect(res.body.results[1].skippedReason).toMatch(/no messages/);
    expect(res.body.results[1].error).toBeUndefined();
  });
});

// ── 两级派发（§4.4）───────────────────────────────────────────────────────────

describe("two-level raw dispatch", () => {
  it("uses built-in ChatGPT and DeepSeek API normalizers by platform", async () => {
    const dataDir = makeDataDir();
    const chatgptRaw = JSON.stringify({
      title: "Live ChatGPT",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: { author: { role: "user" }, content: { parts: ["hello api"] }, create_time: 1783560001 },
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          message: { author: { role: "assistant" }, content: { parts: ["hi api"] }, create_time: 1783560002 },
        },
      },
    });
    const deepseekRaw = JSON.stringify({
      data: {
        biz_data: {
          title: "Live DeepSeek",
          messages: [
            { role: "user", content: "ds q" },
            { role: "assistant", fragments: [{ type: "RESPONSE", content: "ds a" }] },
          ],
        },
      },
    });

    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: {
        source: "extension",
        items: [
          { platform: "chatgpt", externalId: "gpt-1", format: "raw", data: chatgptRaw },
          { platform: "deepseek", externalId: "ds-1", format: "raw", data: deepseekRaw },
        ],
      },
      headers: authed(dataDir),
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results[0].conversations[0]).toMatchObject({ action: "created", title: "Live ChatGPT" });
    expect(res.body.results[1].conversations[0]).toMatchObject({ action: "created", title: "Live DeepSeek" });
  });

  it("prefers a registered platform normalizer over parseFileContent", async () => {
    const dataDir = makeDataDir();
    registerRawNormalizer("myplat", (data) => [{
      id: `conv_norm_${Date.now()}`,
      title: `normalized:${data}`,
      platform: "ChatGPT" as any,
      date: "2026-07-01T00:00:00.000Z",
      folderId: null,
      messages: [{ id: "m1", role: "user" as any, content: data, timestamp: "2026-07-01T00:00:00.000Z" }],
    }]);
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [{ platform: "myplat", format: "raw", data: "opaque-payload" }] },
      headers: authed(dataDir),
    });
    expect(res.body.results[0].conversations[0]).toMatchObject({ action: "created", title: "normalized:opaque-payload" });
  });

  it("falls back to parseFileContent for unregistered platforms (filename optional)", async () => {
    const dataDir = makeDataDir();
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      // 不带 filename：由内容嗅探派发 JSONL
      body: { source: "cli", items: [{ platform: "claude-code", format: "raw", data: CLAUDE_JSONL }] },
      headers: authed(dataDir),
    });
    expect(res.body.results[0].conversations[0].action).toBe("created");
  });

  it("auto-classifies ingested claude-code sessions into the Claude folder (spec import-auto-classify US-02)", async () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(path.join(dataDir, "folders.json"), JSON.stringify([]));
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [ingestItem()] },
      headers: authed(dataDir),
    });
    const created = res.body.results[0].conversations[0];
    expect(created.action).toBe("created");
    const folders = JSON.parse(fs.readFileSync(path.join(dataDir, "folders.json"), "utf-8"));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: "Claude", platform: "Claude" });
    const conv = parseMdFile(created.id, fs.readFileSync(path.join(dataDir, "conversations", `${created.id}.md`), "utf-8"));
    expect(conv.folderId).toBe(folders[0].id);
  });
});

// ── 脱敏集成（US-06）──────────────────────────────────────────────────────────

describe("redaction integration", () => {
  const secretConv = {
    source: "cli",
    items: [{
      platform: "claude-code",
      externalId: "secret-1",
      format: "conversation",
      data: {
        title: "with secret",
        platform: "Claude",
        date: "2026-07-01T00:00:00.000Z",
        messages: [
          { id: "m1", role: "user", content: "here is my key sk-abcdefghijklmnopqrst1234 keep it safe", timestamp: "2026-07-01T00:00:00.000Z" },
          { id: "m2", role: "ai", content: "noted", timestamp: "2026-07-01T00:00:01.000Z" },
        ],
      },
    }],
  };

  it("redacts before persisting (default on) and reports the count", async () => {
    const dataDir = makeDataDir();
    const res = await call({ dataDir, method: "POST", url: "/api/ingest", body: secretConv, headers: authed(dataDir) });
    expect(res.body.results[0].redactions).toBe(1);
    const id = res.body.results[0].conversations[0].id;
    const md = fs.readFileSync(path.join(dataDir, "conversations", `${id}.md`), "utf-8");
    expect(md).toContain("[REDACTED:sk-key]");
    expect(md).not.toContain("sk-abcdefghijklmnopqrst1234");
  });

  it("redacts secrets that leak into parser-derived titles", async () => {
    const dataDir = makeDataDir();
    // JSONL 解析器用首条用户消息生成标题 → 标题也会带密钥，须一并脱敏
    const jsonl = '{"type":"human","message":{"content":"key sk-abcdefghijklmnopqrst1234 here"},"timestamp":"2026-07-01T00:00:00.000Z"}';
    const res = await call({
      dataDir, method: "POST", url: "/api/ingest",
      body: { source: "cli", items: [{ platform: "claude-code", format: "raw", data: jsonl, filename: "t.jsonl" }] },
      headers: authed(dataDir),
    });
    const conv = res.body.results[0].conversations[0];
    expect(conv.action).toBe("created");
    const md = fs.readFileSync(path.join(dataDir, "conversations", `${conv.id}.md`), "utf-8");
    expect(md).not.toContain("sk-abcdefghijklmnopqrst1234");
    expect(md.split("\n").find((l) => l.startsWith("title:"))).toContain("[REDACTED:sk-key]");
    // 版本存档同样不含明文（US-06 AC1）
    const versionFiles = listAllFiles(dataDir).filter((f) => f.includes(".versions") || f.includes("versions"));
    for (const f of versionFiles) {
      if (fs.statSync(f).isFile()) expect(fs.readFileSync(f, "utf-8")).not.toContain("sk-abcdefghijklmnopqrst1234");
    }
  });

  it("keeps content verbatim when redaction is disabled via config", async () => {
    const dataDir = makeDataDir();
    const put = await call({ dataDir, method: "PUT", url: "/api/ingest/config", body: { redact: false } });
    expect(put.status).toBe(200);
    expect(readIngestConfig(dataDir).redact).toBe(false);

    const res = await call({ dataDir, method: "POST", url: "/api/ingest", body: secretConv, headers: authed(dataDir) });
    expect(res.body.results[0].redactions).toBeUndefined();
    const id = res.body.results[0].conversations[0].id;
    const md = fs.readFileSync(path.join(dataDir, "conversations", `${id}.md`), "utf-8");
    expect(md).toContain("sk-abcdefghijklmnopqrst1234");
  });
});
