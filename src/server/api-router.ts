/**
 * api-router.ts
 * 共享的 /api/* 路由层。dev 模式由 pentouServerPlugin 装配为 Vite 中间件；
 * prod 模式由 src/server/index.ts 在 http.createServer 内挂载。
 *
 * 所有目录路径通过 RouterContext.dataDir 传入，避免硬编码 process.cwd()。
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  documentsApiHandler,
  setDocsDataDir,
  ensureDocDirs,
} from "../../vite-plugins/documentsPlugin.js";
import { conversationSignature, conversationDedupable } from "./dedup.js";
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
}

// ── Directory initialization ──────────────────────────────────────────────────

const DEFAULT_FOLDERS = [
  { id: "f1", name: "ChatGPT", platform: "ChatGPT" },
  { id: "f2", name: "DeepSeek", platform: "DeepSeek" },
  { id: "f3", name: "Gemini", platform: "Gemini" },
  { id: "f4", name: "Claude", platform: "Claude" },
];

export function ensureDirs(dataDir: string): void {
  const convDir = path.join(dataDir, "conversations");
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });

  const foldersFile = path.join(dataDir, "folders.json");
  if (!fs.existsSync(foldersFile)) {
    fs.writeFileSync(foldersFile, JSON.stringify(DEFAULT_FOLDERS, null, 2));
  }

  ensureDocDirs(dataDir);
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

export interface UpsertConversationResult {
  action: "created" | "merged" | "skipped";
  id: string;
  title: string;
  mergedIntoExisting?: boolean;
}

function writeConversationFile(convDir: string, conv: any): void {
  fs.writeFileSync(path.join(convDir, `${conv.id}.md`), conversationToMd(conv), "utf-8");
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
  const full = { ...incoming, updatedAt: incoming.updatedAt ?? now };
  const v1 = initConvVersions(convDir, full.id, conversationToMd(full), "import");
  writeConversationFile(convDir, { ...full, currentVersionId: v1.id });
  return { action: "created", id: full.id, title: full.title };
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
  const merged = { ...incoming, id: existing.id, folderId: existing.folderId, updatedAt: now };
  const v = appendConvVersion(convDir, existing.id, { body: conversationToMd(merged), type: "import" });
  updateConvCurrentPointer(convDir, existing.id, v.id);
  writeConversationFile(convDir, { ...merged, currentVersionId: v.id });
  return { action: "merged", id: existing.id, title: merged.title, mergedIntoExisting: true };
}

/** 导入会话：无匹配→新建 / 完全一致→跳过 / 有差异→合并（spec §4.1）。 */
export function upsertConversation(convDir: string, incoming: any): UpsertConversationResult {
  const sig = conversationSignature(incoming);
  if (conversationDedupable(incoming)) {
    const existing = findMatchingConversation(convDir, sig.fingerprint);
    if (existing) {
      if (conversationSignature(existing).contentHash === sig.contentHash) {
        return { action: "skipped", id: existing.id, title: existing.title };
      }
      return mergeConversation(convDir, existing, incoming);
    }
  }
  return createConversation(convDir, incoming);
}

// ── Main entry: handleApiRequest ──────────────────────────────────────────────

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<boolean> {
  setDocsDataDir(ctx.dataDir);

  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const convDir = path.join(ctx.dataDir, "conversations");
  const foldersFile = path.join(ctx.dataDir, "folders.json");

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
      const result = upsertConversation(convDir, body);
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
      fs.writeFileSync(filePath, conversationToMd(merged), "utf-8");
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
      const html = await fetchHtmlWithObscura(body.url);
      const conversations = await parseSharedLinkData(body.url, html);

      json(res, 200, { ok: true, conversations });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── Documents API ─────────────────────────────────────────────────────
  if (await documentsApiHandler(req, res)) return true;

  return false;
}
