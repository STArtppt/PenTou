/**
 * api-router.ts
 * 共享的 /api/* 路由层。dev 模式由 pentouServerPlugin 装配为 Vite 中间件；
 * prod 模式由 src/server/index.ts 在 http.createServer 内挂载。
 *
 * 所有目录路径通过 RouterContext.dataDir 传入，避免硬编码 process.cwd()。
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import formidable from "formidable";
import {
  documentsApiHandler,
  setDocsDataDir,
  ensureDocDirs,
} from "../../vite-plugins/documentsPlugin.js";
import {
  localizeMedia,
  localizeMessages,
  setAssetsDataDir,
  ensureAssetsDir,
  saveAssetBuffer,
  resolveAssetExt,
  EXT_TO_MIME,
  ASSET_MAX_SIZE,
} from "./media-assets.js";
import { conversationSignature, conversationDedupable } from "./dedup.js";
import {
  configureSearch,
  markStale,
  search,
  searchHybrid,
  getEmbeddingState,
  updateEmbeddingConfig,
} from "./search-service.js";
import {
  hasConvVersions,
  initConvVersions,
  appendConvVersion,
  updateConvCurrentPointer,
  readConvVersionIndex,
  readConvVersionBody,
  deleteConvVersions,
} from "./conversation-versions.js";

export interface RouterContext {
  dataDir: string;
  /**
   * obscura 二进制所在目录。npx 本地模式传 `<dataDir>/bin` 并允许惰性下载；
   * Docker / dev 不传，沿用 `<cwd>/bin`（spec npx-launcher §4.5 决策 5）。
   */
  obscuraBinDir?: string;
  /** 缺失时是否惰性下载 obscura（仅 npx 本地模式开启）。 */
  obscuraAllowDownload?: boolean;
}

// ── Directory initialization ──────────────────────────────────────────────────

const DEFAULT_FOLDERS = [
  { id: "f1", name: "ChatGPT", platform: "ChatGPT" },
  { id: "f2", name: "DeepSeek", platform: "DeepSeek" },
  { id: "f3", name: "Gemini", platform: "Gemini" },
  { id: "f4", name: "Claude", platform: "Claude" },
];

const CONVERSATION_ID_RE = /^conv_[a-zA-Z0-9_]+$/;
const DOCUMENT_ID_RE = /^doc_[a-zA-Z0-9_]+$/;

export function ensureDirs(dataDir: string): void {
  const convDir = path.join(dataDir, "conversations");
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });

  const aiChatsDir = path.join(dataDir, "ai-chats");
  if (!fs.existsSync(aiChatsDir)) fs.mkdirSync(aiChatsDir, { recursive: true });

  const foldersFile = path.join(dataDir, "folders.json");
  if (!fs.existsSync(foldersFile)) {
    fs.writeFileSync(foldersFile, JSON.stringify(DEFAULT_FOLDERS, null, 2));
  }

  ensureDocDirs(dataDir);

  // 图片资产目录（spec media-assets 异常 1）。
  ensureAssetsDir(dataDir);

  // 检索索引：设定数据目录并后台预热（spec hybrid-search §4.5 决策7）。
  configureSearch(dataDir);
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseId(url: string, prefix: string): string | null {
  const rest = url.slice(prefix.length);
  const id = rest.split("?")[0].replace(/^\//, "");
  return id || null;
}

export function isMetaMode(url: string): boolean {
  return /[?&]fields=meta(\b|&|$)/.test(url);
}

function toConversationMeta(conv: any) {
  return {
    id: conv.id,
    title: conv.title,
    platform: conv.platform,
    date: conv.date,
    folderId: conv.folderId,
    updatedAt: conv.updatedAt,
    currentVersionId: conv.currentVersionId,
    messageCount: conv.messages?.length ?? 0,
    messages: [],
  };
}

// ── Conversation MD <-> object ────────────────────────────────────────────────

function escapeFrontmatterValue(val: string): string {
  if (val.includes('"') || val.includes('\n') || val.includes(':')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

export function conversationToMd(conv: any): string {
  const messages: any[] = conv.messages ?? [];
  const msgBlock = messages
    .map((m: any) => {
      const role = m.role === "user" ? "## User" : `## ${conv.platform ?? "AI"}`;
      return `${role}\n\n${m.content}\n`;
    })
    .join("\n---\n\n");

  const fmLines = [
    `id: ${escapeFrontmatterValue(conv.id)}`,
    `title: ${escapeFrontmatterValue(conv.title ?? "Untitled")}`,
    `platform: ${escapeFrontmatterValue(conv.platform ?? "ChatGPT")}`,
    `date: ${escapeFrontmatterValue(conv.date ?? new Date().toISOString())}`,
    `folderId: ${conv.folderId ? escapeFrontmatterValue(conv.folderId) : "null"}`,
  ];
  if (conv.updatedAt) fmLines.push(`updatedAt: ${escapeFrontmatterValue(conv.updatedAt)}`);
  if (conv.currentVersionId) fmLines.push(`currentVersionId: ${escapeFrontmatterValue(conv.currentVersionId)}`);

  return `---
${fmLines.join("\n")}
---

${msgBlock}`;
}

function mergeConsecutiveMessages(messages: any[]): any[] {
  const merged: any[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = [previous.content, message.content].filter(Boolean).join("\n\n");
      continue;
    }
    merged.push(message);
  }
  return merged;
}

export function parseMdFile(id: string, content: string): any {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      id,
      title: id,
      platform: "ChatGPT",
      date: new Date().toISOString(),
      folderId: null,
      messages: [{ id: `${id}_m1`, role: "ai", content: content.trim(), timestamp: new Date().toISOString() }],
    };
  }

  const [, frontmatterRaw, body] = frontmatterMatch;

  const meta: Record<string, string> = {};
  for (const line of frontmatterRaw.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      meta[match[1]] = val;
    }
  }

  const roleLabels = [
    "user", "human", "you",
    "ai", "assistant", "chatgpt", "claude", "deepseek", "gemini",
    "cli", "cursor", "copilot", "codex",
    meta.platform,
  ].filter(Boolean);
  const rolePattern = roleLabels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const headerRegex = new RegExp(`^##\\s+(${rolePattern})\\s*$`, "gmi");
  const matches = [...body.matchAll(headerRegex)];
  const messages: any[] = [];
  let msgIndex = 0;

  if (matches.length === 0) {
    const trimmed = body.trim();
    if (trimmed) {
      messages.push({
        id: `${id}_m${msgIndex++}`,
        role: "ai",
        content: trimmed,
        timestamp: meta.date ?? new Date().toISOString(),
      });
    }
  } else {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const roleLabel = match[1].trim().toLowerCase();
      const isUser = /user|human|you/i.test(roleLabel);
      const role = isUser ? "user" : "ai";

      const startIdx = match.index! + match[0].length;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index! : body.length;
      let content = body.slice(startIdx, endIdx).trim();
      content = content.replace(/\s*---$/, "").trim();

      if (!content) continue;

      messages.push({
        id: `${id}_m${msgIndex++}`,
        role,
        content,
        timestamp: meta.date ?? new Date().toISOString(),
      });
    }
  }

  return {
    id: meta.id ?? id,
    title: meta.title ?? id,
    platform: meta.platform ?? "ChatGPT",
    date: meta.date ?? new Date().toISOString(),
    folderId: meta.folderId === "null" ? null : (meta.folderId || null),
    updatedAt: meta.updatedAt || undefined,
    currentVersionId: meta.currentVersionId || undefined,
    messages: mergeConsecutiveMessages(messages),
  };
}

// ── Conversation dedup / merge / versioning ──────────────────────────────────

const CONV_ID_RE = /^[a-zA-Z0-9_-]+$/;
const CVER_ID_RE = /^cver_[a-zA-Z0-9_]+$/;
const AI_CHAT_ID_RE = /^chat_[a-zA-Z0-9_]+$/;
const AI_MSG_START_RE = /^<!--\s*ai-msg\s+([^>]*)-->\s*$/gm;
const AI_MSG_END_RE = /^<!--\s*\/ai-msg\s*-->\s*$/m;

export interface UpsertConversationResult {
  action: "created" | "merged" | "skipped";
  id: string;
  title: string;
  conversation?: any;
  mergedIntoExisting?: boolean;
}

function writeConversationFile(convDir: string, conv: any): void {
  fs.writeFileSync(path.join(convDir, `${conv.id}.md`), conversationToMd(conv), "utf-8");
}

function normalizeConversation(conv: any): any {
  return parseMdFile(conv.id, conversationToMd(conv));
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s]+))/g;
  for (const match of raw.matchAll(re)) attrs[match[1]] = unescapeAttr(match[2] ?? match[3] ?? "");
  return attrs;
}

function aiChatSessionToMd(session: any): string {
  const lines = ["---"];
  lines.push(`id: ${escapeFrontmatterValue(session.id)}`);
  lines.push(`title: ${escapeFrontmatterValue(session.title || "New chat")}`);
  lines.push(`createdAt: ${escapeFrontmatterValue(session.createdAt ?? new Date().toISOString())}`);
  lines.push(`updatedAt: ${escapeFrontmatterValue(session.updatedAt ?? new Date().toISOString())}`);
  if (session.model) lines.push(`model: ${escapeFrontmatterValue(session.model)}`);
  if (session.contextType) lines.push(`contextType: ${escapeFrontmatterValue(session.contextType)}`);
  if (session.contextId) lines.push(`contextId: ${escapeFrontmatterValue(session.contextId)}`);
  lines.push("---", "");

  for (const message of session.messages ?? []) {
    const attrs = [
      `role=${message.role === "user" ? "user" : "assistant"}`,
      `id=${escapeAttr(message.id ?? "")}`,
      `status=${message.status ?? "done"}`,
      message.error ? `error="${escapeAttr(message.error)}"` : "",
      message.contextLabel ? `contextLabel="${escapeAttr(message.contextLabel)}"` : "",
    ].filter(Boolean);
    lines.push(`<!-- ai-msg ${attrs.join(" ")} -->`);
    lines.push(message.content ?? "");
    lines.push("<!-- /ai-msg -->", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function parseAiChatMd(id: string, content: string): any {
  const now = new Date().toISOString();
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { id, title: id, messages: [], createdAt: now, updatedAt: now };

  const meta: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      meta[match[1]] = val;
    }
  }

  const body = fmMatch[2] ?? "";
  const starts = [...body.matchAll(AI_MSG_START_RE)];
  const messages: any[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const attrs = parseAttrs(start[1]);
    const contentStart = (start.index ?? 0) + start[0].length;
    const rest = body.slice(contentStart);
    const end = rest.match(AI_MSG_END_RE);
    const nextStart = i + 1 < starts.length ? (starts[i + 1].index ?? body.length) - contentStart : rest.length;
    const contentEnd = end?.index ?? nextStart;
    const rawContent = rest.slice(0, contentEnd).replace(/^\n/, "").replace(/\n$/, "");
    messages.push({
      id: attrs.id || `aimsg_${Date.now()}_${messages.length}`,
      role: attrs.role === "user" ? "user" : "assistant",
      status: ["streaming", "done", "aborted", "error"].includes(attrs.status) ? attrs.status : "done",
      content: rawContent,
      error: attrs.error || undefined,
      contextLabel: attrs.contextLabel || undefined,
    });
  }

  return {
    id: meta.id ?? id,
    title: meta.title || "New chat",
    createdAt: meta.createdAt ?? now,
    updatedAt: meta.updatedAt ?? now,
    model: meta.model || undefined,
    contextType: meta.contextType === "chat" || meta.contextType === "doc" ? meta.contextType : undefined,
    contextId: meta.contextId || undefined,
    messages,
  };
}

function assertValidAiChatId(id: string | null): asserts id is string {
  if (!id || !AI_CHAT_ID_RE.test(id)) throw new Error(`Invalid AI chat id: "${id}"`);
}

function resolveAiChatPath(aiChatsDir: string, id: string): string {
  assertValidAiChatId(id);
  const resolvedDir = path.resolve(aiChatsDir);
  const resolvedPath = path.resolve(resolvedDir, `${id}.md`);
  const relative = path.relative(resolvedDir, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path traversal detected");
  return resolvedPath;
}

/** 在同类条目中按 fingerprint 查找匹配项（按需即时计算指纹，不持久化）。 */
function findMatchingConversation(convDir: string, fingerprint: string): any | null {
  if (!fs.existsSync(convDir)) return null;
  const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const conv = parseMdFile(f.replace(".md", ""), fs.readFileSync(path.join(convDir, f), "utf-8"));
    if (conversationSignature(conv).fingerprint === fingerprint) return conv;
  }
  return null;
}

function createConversation(convDir: string, incoming: any): UpsertConversationResult {
  const now = new Date().toISOString();
  const full = normalizeConversation({ ...incoming, updatedAt: incoming.updatedAt ?? now });
  const v1 = initConvVersions(convDir, full.id, conversationToMd(full), "import");
  const conversation = { ...full, currentVersionId: v1.id };
  writeConversationFile(convDir, conversation);
  return { action: "created", id: full.id, title: full.title, conversation };
}

function mergeConversation(convDir: string, existing: any, incoming: any): UpsertConversationResult {
  const now = new Date().toISOString();
  // 降级·历史数据无版本：首次合并时懒补 v1（spec §5）
  if (!hasConvVersions(convDir, existing.id)) {
    initConvVersions(convDir, existing.id, conversationToMd(existing), "import");
  }
  // 1. 先把当前内容存档为 pre-import-overwrite；失败则抛出，中止覆盖（spec §5 异常）
  appendConvVersion(convDir, existing.id, {
    body: conversationToMd(existing),
    type: "pre-import-overwrite",
  });
  // 2. 用新内容覆盖当前；保留已有条目的 id 与 folderId（不被导入项覆盖，spec §5 边界·跨folder）
  const merged = normalizeConversation({ ...incoming, id: existing.id, folderId: existing.folderId, updatedAt: now });
  const v = appendConvVersion(convDir, existing.id, { body: conversationToMd(merged), type: "import" });
  updateConvCurrentPointer(convDir, existing.id, v.id);
  const conversation = { ...merged, currentVersionId: v.id };
  writeConversationFile(convDir, conversation);
  return { action: "merged", id: existing.id, title: merged.title, conversation, mergedIntoExisting: true };
}

/** 导入会话：无匹配→新建 / 完全一致→跳过 / 有差异→合并（spec §4.1）。 */
export function upsertConversation(convDir: string, incoming: any): UpsertConversationResult {
  const normalizedIncoming = normalizeConversation(incoming);
  const sig = conversationSignature(normalizedIncoming);
  if (conversationDedupable(normalizedIncoming)) {
    const existing = findMatchingConversation(convDir, sig.fingerprint);
    if (existing) {
      if (conversationSignature(existing).contentHash === sig.contentHash) {
        return { action: "skipped", id: existing.id, title: existing.title };
      }
      return mergeConversation(convDir, existing, normalizedIncoming);
    }
  }
  return createConversation(convDir, normalizedIncoming);
}

// ── Main entry: handleApiRequest ──────────────────────────────────────────────

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<boolean> {
  setDocsDataDir(ctx.dataDir);
  setAssetsDataDir(ctx.dataDir);

  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const convDir = path.join(ctx.dataDir, "conversations");
  const aiChatsDir = path.join(ctx.dataDir, "ai-chats");
  const foldersFile = path.join(ctx.dataDir, "folders.json");

  // ── GET /api/storage-paths/:type/:id （返回条目实际落盘路径） ───────────────
  if (url.startsWith("/api/storage-paths/") && method === "GET") {
    const parts = url.slice("/api/storage-paths/".length).split("?")[0].split("/");
    const [type, id] = parts;
    const isConversation = type === "conversation";
    const isDocument = type === "document";
    if (!id || (!isConversation && !isDocument)) {
      json(res, 400, { error: "Invalid storage path request" });
      return true;
    }
    if ((isConversation && !CONVERSATION_ID_RE.test(id)) || (isDocument && !DOCUMENT_ID_RE.test(id))) {
      json(res, 400, { error: "Invalid item id" });
      return true;
    }

    const baseDir = isConversation ? convDir : path.join(ctx.dataDir, "documents");
    const filePath = path.resolve(baseDir, `${id}.md`);
    const relative = path.relative(path.resolve(baseDir), filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      json(res, 400, { error: "Path traversal detected" });
      return true;
    }
    if (!fs.existsSync(filePath)) {
      json(res, 404, { error: "Not found" });
      return true;
    }

    json(res, 200, { path: filePath });
    return true;
  }

  // ── /api/search/config （嵌入后端配置，spec hybrid-search §4.7） ──────────
  if (url === "/api/search/config" || url.startsWith("/api/search/config?")) {
    configureSearch(ctx.dataDir);
    // GET：回显配置 + 状态机 phase + 进度；绝不回显明文 apiKey（仅 hasKey）。
    if (method === "GET") {
      try { json(res, 200, getEmbeddingState()); }
      catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }
    // PUT：保存配置并触发重嵌；apiKey 留空表示沿用现有（§4.7 安全契约）。
    if (method === "PUT") {
      try {
        const body = JSON.parse(await readBody(req)) as {
          enabled?: boolean; endpoint?: string; model?: string; apiKey?: string;
        };
        const state = updateEmbeddingConfig({
          enabled: body.enabled,
          endpoint: body.endpoint,
          model: body.model,
          apiKey: body.apiKey,
        });
        json(res, 200, state);
      } catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }
    json(res, 405, { error: "Method not allowed" });
    return true;
  }

  // ── GET /api/search （全文 / 混合检索，spec hybrid-search §4.4/§4.7） ──────
  if ((url === "/api/search" || url.startsWith("/api/search?")) && method === "GET") {
    configureSearch(ctx.dataDir);
    try {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      let q = (params.get("q") ?? "").trim();
      // 空 / 全空白 → 不进引擎；q 最大 200 字符，超出截断（不报错）。
      if (!q) { json(res, 200, { status: "ready", hits: [], mode: "lex", took_ms: 0 }); return true; }
      if (q.length > 200) q = q.slice(0, 200);

      // limit：默认 30，min 1，max 50；越界 clamp；非整数 / 缺省取默认。
      let limit = 30;
      const limitRaw = params.get("limit");
      if (limitRaw !== null) {
        const n = Number(limitRaw);
        if (Number.isInteger(n)) limit = Math.max(1, Math.min(50, n));
      }
      // mode：lex | hybrid；非法值回落 lex（§4.4）。Phase 2 解除「强制 lex」。
      const mode = params.get("mode") === "hybrid" ? "hybrid" : "lex";

      const t0 = Date.now();
      const result = mode === "hybrid" ? await searchHybrid(q, limit) : search(q, limit);
      json(res, 200, {
        status: result.status,
        hits: result.hits,
        mode: result.mode ?? "lex",       // 回显实际生效模式
        degraded: result.degraded,
        partial: result.partial,
        took_ms: Date.now() - t0,
      });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── GET /api/assets/:file （图片资产读取，spec media-assets §4.4 / 边界 4） ──
  if (url.startsWith("/api/assets/") && method === "GET") {
    const file = url.slice("/api/assets/".length).split("?")[0];
    // 文件名严格匹配，杜绝路径穿越（边界 4）
    if (!/^[0-9a-f]{16}\.[a-z0-9]+$/.test(file)) {
      json(res, 400, { error: "Invalid asset file name" });
      return true;
    }
    const filePath = path.join(ctx.dataDir, "assets", file);
    if (!fs.existsSync(filePath)) {
      json(res, 404, { error: "Not found" });
      return true;
    }
    try {
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": EXT_TO_MIME[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": buf.length,
        "Cache-Control": "public, max-age=31536000, immutable", // 内容寻址 → 永不变更（决策 3）
      });
      res.end(buf);
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── POST /api/assets （图片上传落盘，Phase 2 前端 ZIP 导入用，spec §4.4） ──
  if (url === "/api/assets" && method === "POST") {
    try {
      const form = formidable({ maxFileSize: ASSET_MAX_SIZE, maxFiles: 1, uploadDir: tmpdir(), keepExtensions: true });
      const [, formFiles] = await form.parse(req);
      const file = (Object.values(formFiles).flat().filter(Boolean) as formidable.File[])[0];
      if (!file) {
        json(res, 400, { error: "No file uploaded" });
        return true;
      }
      try {
        const buf = fs.readFileSync(file.filepath);
        const ext = resolveAssetExt(buf, file.mimetype, path.extname(file.originalFilename ?? ""));
        if (!ext) {
          json(res, 415, { error: "Unsupported image format" });
          return true;
        }
        // 重复内容由内容寻址天然去重，直接返回已有 URL
        json(res, 200, { url: saveAssetBuffer(buf, ext) });
      } finally {
        try { fs.unlinkSync(file.filepath); } catch {}
      }
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── /api/ai-chats （AI sidebar local sessions, spec ai-sidebar §4.4） ─────
  if ((url === "/api/ai-chats" || url.startsWith("/api/ai-chats?")) && method === "GET") {
    try {
      if (!fs.existsSync(aiChatsDir)) fs.mkdirSync(aiChatsDir, { recursive: true });
      const sessions = fs.readdirSync(aiChatsDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => parseAiChatMd(file.replace(".md", ""), fs.readFileSync(path.join(aiChatsDir, file), "utf-8")))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      json(res, 200, sessions);
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  if (url.startsWith("/api/ai-chats/")) {
    const id = parseId(url, "/api/ai-chats/");
    try {
      const filePath = resolveAiChatPath(aiChatsDir, id ?? "");

      if (method === "GET") {
        if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
        json(res, 200, parseAiChatMd(id!, fs.readFileSync(filePath, "utf-8")));
        return true;
      }

      if (method === "PUT") {
        const body = JSON.parse(await readBody(req));
        if (body.id && body.id !== id) { json(res, 400, { error: "Session id mismatch" }); return true; }
        const now = new Date().toISOString();
        const session = {
          ...body,
          id,
          title: body.title || "New chat",
          messages: Array.isArray(body.messages) ? body.messages : [],
          createdAt: body.createdAt || now,
          updatedAt: body.updatedAt || now,
        };
        // 媒体本地化（spec media-assets §4.4：AI 会话保存不下载远程图片，决策 9）
        await localizeMessages(session.messages, { downloadRemote: false });
        if (!fs.existsSync(aiChatsDir)) fs.mkdirSync(aiChatsDir, { recursive: true });
        fs.writeFileSync(filePath, aiChatSessionToMd(session), "utf-8");
        json(res, 200, { ok: true });
        return true;
      }

      if (method === "DELETE") {
        if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
        fs.unlinkSync(filePath);
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 405, { error: "Method not allowed" });
    } catch (e: any) {
      if (String(e?.message ?? e).includes("Invalid AI chat id") || String(e?.message ?? e).includes("Path traversal")) {
        json(res, 400, { error: String(e?.message ?? e) });
      } else {
        json(res, 500, { error: String(e) });
      }
    }
    return true;
  }

  // ── GET /api/conversations ────────────────────────────────────────────
  if ((url === "/api/conversations" || url.startsWith("/api/conversations?")) && method === "GET") {
    try {
      const meta = isMetaMode(url);
      const files = fs.readdirSync(convDir).filter((f: string) => f.endsWith(".md"));
      const conversations = files.map((filename: string) => {
        const content = fs.readFileSync(path.join(convDir, filename), "utf-8");
        const full = parseMdFile(filename.replace(".md", ""), content);
        return meta ? toConversationMeta(full) : full;
      });
      json(res, 200, conversations);
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── /api/conversations/:id/versions... 与 /rollback（须在通用 :id 路由之前） ──
  if (url.startsWith("/api/conversations/")) {
    const after = url.slice("/api/conversations/".length);
    const parts = after.split("?")[0].split("/");
    const cid = parts[0];
    const sub = parts.slice(1).join("/");

    if (cid && sub) {
      if (!CONV_ID_RE.test(cid)) { json(res, 400, { error: "Invalid conversation id" }); return true; }

      // GET /api/conversations/:id/versions
      if (sub === "versions" && method === "GET") {
        if (!hasConvVersions(convDir, cid)) { json(res, 404, { error: "Versions not found" }); return true; }
        try {
          const index = readConvVersionIndex(convDir, cid);
          json(res, 200, { currentVersionId: index.currentVersionId, versions: index.versions });
        } catch (e) { json(res, 500, { error: String(e) }); }
        return true;
      }

      // GET /api/conversations/:id/versions/:vid
      if (sub.startsWith("versions/") && method === "GET") {
        const vid = sub.slice("versions/".length);
        if (!CVER_ID_RE.test(vid)) { json(res, 400, { error: "Invalid version id" }); return true; }
        try {
          const index = readConvVersionIndex(convDir, cid);
          const entry = index.versions.find((v) => v.id === vid);
          if (!entry) { json(res, 404, { error: "Version not found" }); return true; }
          const parsed = parseMdFile(cid, readConvVersionBody(convDir, cid, entry));
          json(res, 200, { ...entry, convId: cid, title: parsed.title, messages: parsed.messages });
        } catch (e) { json(res, 500, { error: String(e) }); }
        return true;
      }

      // POST /api/conversations/:id/rollback
      if (sub === "rollback" && method === "POST") {
        try {
          const { targetVersionId } = JSON.parse(await readBody(req));
          if (!CVER_ID_RE.test(targetVersionId)) { json(res, 400, { error: "Invalid targetVersionId" }); return true; }
          const index = readConvVersionIndex(convDir, cid);
          const target = index.versions.find((v) => v.id === targetVersionId);
          if (!target) { json(res, 404, { error: "Target version not found" }); return true; }

          const targetConv = parseMdFile(cid, readConvVersionBody(convDir, cid, target));
          const filePath = path.join(convDir, `${cid}.md`);
          if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
          const existing = parseMdFile(cid, fs.readFileSync(filePath, "utf-8"));

          // 当前内容先存为 pre-rollback，再用目标版本覆盖（rolled-back-from）
          appendConvVersion(convDir, cid, { body: conversationToMd(existing), type: "pre-rollback" });
          const merged = { ...targetConv, id: cid, folderId: existing.folderId, updatedAt: new Date().toISOString() };
          const newV = appendConvVersion(convDir, cid, {
            body: conversationToMd(merged),
            type: "rolled-back-from",
            rolledBackFromVersionId: targetVersionId,
          });
          updateConvCurrentPointer(convDir, cid, newV.id);
          writeConversationFile(convDir, { ...merged, currentVersionId: newV.id });
          markStale(); // 索引失效（spec hybrid-search §4.2）
          json(res, 200, { ok: true, version: newV, conversation: { ...merged, currentVersionId: newV.id } });
        } catch (e) { json(res, 500, { error: String(e) }); }
        return true;
      }
    }
  }

  // ── GET /api/conversations/:id ────────────────────────────────────────
  if (url.startsWith("/api/conversations/") && method === "GET") {
    const id = parseId(url, "/api/conversations/");
    if (!id) { json(res, 400, { error: "Missing id" }); return true; }
    const filePath = path.join(convDir, `${id}.md`);
    if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      json(res, 200, parseMdFile(id, content));
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── POST /api/conversations (去重合并三分支) ──────────────────────────
  if (url === "/api/conversations" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      // 媒体本地化（spec media-assets §4.4：对话导入开启远程下载）
      await localizeMessages(body.messages, { downloadRemote: true });
      const result = upsertConversation(convDir, body);
      markStale(); // 索引失效（spec hybrid-search §4.2）
      // 保持向后兼容字段 ok/id，叠加 action（spec §4.4）
      json(res, result.action === "created" ? 201 : 200, { ok: true, ...result });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── PUT /api/conversations/:id ────────────────────────────────────────
  if (url.startsWith("/api/conversations/") && method === "PUT") {
    const id = parseId(url, "/api/conversations/");
    if (!id) { json(res, 400, { error: "Missing id" }); return true; }
    try {
      const body = JSON.parse(await readBody(req));
      const filePath = path.join(convDir, `${id}.md`);
      let existing: any = {};
      if (fs.existsSync(filePath)) {
        existing = parseMdFile(id, fs.readFileSync(filePath, "utf-8"));
      }
      const merged = { ...existing, ...body, id };
      // 媒体本地化（spec media-assets §4.4：编辑保存不下载远程图片，决策 9）
      await localizeMessages(merged.messages, { downloadRemote: false });
      fs.writeFileSync(filePath, conversationToMd(merged), "utf-8");
      markStale(); // 索引失效（spec hybrid-search §4.2）
      json(res, 200, { ok: true });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── DELETE /api/conversations/:id ─────────────────────────────────────
  if (url.startsWith("/api/conversations/") && method === "DELETE") {
    const id = parseId(url, "/api/conversations/");
    if (!id) { json(res, 400, { error: "Missing id" }); return true; }
    const filePath = path.join(convDir, `${id}.md`);
    if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
    try {
      fs.unlinkSync(filePath);
      deleteConvVersions(convDir, id); // 连带清理版本目录（spec §8 风险应对）
      markStale(); // 索引失效（spec hybrid-search §4.2）
      json(res, 200, { ok: true });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── GET /api/folders ──────────────────────────────────────────────────
  if (url === "/api/folders" && method === "GET") {
    try {
      const content = fs.readFileSync(foldersFile, "utf-8");
      json(res, 200, JSON.parse(content));
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── POST /api/folders ─────────────────────────────────────────────────
  if (url === "/api/folders" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      fs.writeFileSync(foldersFile, JSON.stringify(body, null, 2), "utf-8");
      json(res, 200, { ok: true });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── POST /api/import/link ─────────────────────────────────────────────
  if (url === "/api/import/link" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.url) { json(res, 400, { error: "Missing url" }); return true; }

      const { fetchHtmlWithObscura, parseSharedLinkData } = await import("../../vite-plugins/obscura.js");
      const html = await fetchHtmlWithObscura(body.url, {
        binDir: ctx.obscuraBinDir,
        allowDownload: ctx.obscuraAllowDownload,
      });
      const conversations = await parseSharedLinkData(body.url, html);

      // 媒体本地化（spec media-assets §4.4：链接导入开启远程下载；同批共享 urlCache）
      const urlCache = new Map<string, string | null>();
      for (const conv of conversations) {
        await localizeMessages(conv.messages, { downloadRemote: true, urlCache });
      }

      json(res, 200, { ok: true, conversations });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── Documents API ─────────────────────────────────────────────────────
  if (await documentsApiHandler(req, res)) {
    // 文档 upsert/PUT/DELETE/import 成功后令检索索引失效（spec §4.2，集中钩子）。
    if (method !== "GET") markStale();
    return true;
  }

  return false;
}
