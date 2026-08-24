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
  upsertDocument,
  buildDocumentUpsertIndex,
  findOrCreateProjectByKey,
  type DocumentUpsertIndex,
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
import { AGENT_TOOLS } from "../shared/agent-tools.js";
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
import {
  normalizeConversationFolders,
  resolveAutoFolderId,
  writeConversationFolders,
} from "./conversation-folders.js";
import {
  backfillConversationProjects,
  readConversationProjectsMarker,
} from "./conversation-projects.js";
import { log } from "./logger.js";
import {
  extractReasoningFromBody,
  formatReasoningForMd,
  mergeReasoning,
} from "../shared/reasoning.js";
import { EmptyPayloadError, parseRawConversations } from "../shared/raw-dispatch.js";
import { favoriteOnlyMode } from "../shared/attention.js";
import {
  DOCS_PLATFORM,
  deriveDocsPathTitleFromExternalId,
} from "../cli/collector/adapters/docs-scan.js";
import { redactText } from "./redact.js";
import {
  getIngestToken,
  rotateIngestToken,
  verifyIngestToken,
  readIngestConfig,
  writeIngestConfig,
} from "./ingest-token.js";
import { clientIp, isLimited, recordFail } from "./auth.js";
import { createMigrationManifest, readManifestFile } from "./migrate/manifest.js";
import { readFolderBundle } from "./migrate/merge-folders.js";
import { cleanupMigrationTmp, finalizeMigrationReceiver, mergeMigrationFolders, receiveMigrationFile } from "./migrate/receiver.js";
import { createMigrationPlan, getMigrationProgress, runMigration, testMigrationPeer } from "./migrate/orchestrator.js";
import { detectVaults, exportNoteToVault, validateVaultPath, ObsidianExportError } from "./obsidian-export.js";

export interface RouterContext {
  dataDir: string;
  /**
   * obscura 二进制所在目录。npx 本地模式传 `<dataDir>/bin` 并允许惰性下载；
   * Docker / dev 不传，沿用 `<cwd>/bin`（spec npx-launcher §4.5 决策 5）。
   */
  obscuraBinDir?: string;
  /** 缺失时是否惰性下载 obscura（仅 npx 本地模式开启）。 */
  obscuraAllowDownload?: boolean;
  /** ingest 限速器取真实 IP 用；prod 传 Docker env 值，dev / 测试缺省 false。 */
  trustProxy?: boolean;
  /** 当前应用版本，供迁移 manifest/兼容性检查展示。 */
  version?: string;
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

  // 存量对话按 sourceProject 一次性归集：必须在对外提供服务之前完成，
  // 避免"刷新一次分组变一次"。失败不阻断启动（spec conversation-projects）。
  try {
    backfillConversationProjects(dataDir);
  } catch (error) {
    log.warn(`conversation-projects backfill failed: ${String(error)}`);
  }

  // 迁移中断残留的任务级临时目录永不进入 manifest，启动时顺手清理。
  cleanupMigrationTmp(dataDir);

  // 检索索引：设定数据目录并后台预热（spec hybrid-search §4.5 决策7）。
  configureSearch(dataDir);
}

// ── Generic helpers ───────────────────────────────────────────────────────────

// 必须整体聚合 Buffer 再解码：逐 chunk 隐式 toString 会把跨 chunk 边界的
// 多字节 UTF-8 字符打碎成 U+FFFD（debugging/2026-07-13-readbody-utf8-chunk-split.md）
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, statusCode: number, data: unknown, extraHeaders?: Record<string, string>): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...(extraHeaders ?? {}),
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
    ingestSource: conv.ingestSource,
    // 顶栏项目徽章消费（spec content-topbar-attribution）：与完整会话一致，无需水合消息体
    sourceProject: conv.sourceProject,
    // 侧栏项目分组指针（spec conversation-projects）：缺键即默认目录
    projectId: conv.projectId,
    // 侧栏置顶与顶栏星标都读它（spec content-favorites），meta 模式必须带上
    favorite: conv.favorite,
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

// 每条消息的原始时间以注释行落盘（spec conversation-time-and-sort §4.3）：
// 紧随角色标题，读回时剥离；非法/缺失时间不写，读回回退 frontmatter date。
const MSG_TS_RE = /^<!--\s*msg-ts:\s*([^>]*?)\s*-->\s*/;

function msgTsLine(timestamp: unknown): string {
  if (typeof timestamp !== "string" || !timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `<!-- msg-ts: ${date.toISOString()} -->\n`;
}

export function conversationToMd(conv: any): string {
  const messages: any[] = conv.messages ?? [];
  const msgBlock = messages
    .map((m: any) => {
      const role = m.role === "user" ? "## User" : `## ${conv.platform ?? "AI"}`;
      // reasoning 落在 msg-ts 之后、正文之前；段为空整块不写（spec message-reasoning）
      const reasoning = formatReasoningForMd(m.reasoning);
      // 无 reasoning 时保留 msg-ts 与正文之间的空行（存量格式）
      const spacer = reasoning ? "" : "\n";
      return `${role}\n${msgTsLine(m.timestamp)}${reasoning}${spacer}${m.content}\n`;
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
  // ingest 身份映射（spec ingest-gateway §4.3）：externalKey 为 upsert 一级查找依据，
  // ingestSource 仅溯源不参与匹配。
  if (conv.externalKey) fmLines.push(`externalKey: ${escapeFrontmatterValue(conv.externalKey)}`);
  if (conv.ingestSource) fmLines.push(`ingestSource: ${escapeFrontmatterValue(conv.ingestSource)}`);
  // 来源项目（spec conversation-project-attribution）：仅数据层，判定不了就不写
  if (conv.sourceProject) fmLines.push(`sourceProject: ${escapeFrontmatterValue(conv.sourceProject)}`);
  // 项目归属（spec conversation-projects）：真值才写键，缺键即默认目录，存量文件零迁移。
  if (conv.projectId) fmLines.push(`projectId: ${escapeFrontmatterValue(conv.projectId)}`);
  // 收藏（spec content-favorites）：真值才写键，缺键即未收藏 —— 存量文件零迁移。
  if (conv.favorite) fmLines.push(`favorite: true`);

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
      // reasoning 按段以空行拼接（spec message-reasoning 决策 6）
      const reasoning = mergeReasoning(previous.reasoning, message.reasoning);
      if (reasoning) previous.reasoning = reasoning;
      else delete previous.reasoning;
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

      // 提取消息级时间标记；无标记（存量文件）回退 frontmatter date（spec §5）
      let timestamp = meta.date ?? new Date().toISOString();
      const tsMatch = content.match(MSG_TS_RE);
      if (tsMatch) {
        content = content.slice(tsMatch[0].length).trim();
        if (tsMatch[1]) timestamp = tsMatch[1];
      }

      // 剥离 reasoning 注释块还原 structured field（spec message-reasoning）
      const extracted = extractReasoningFromBody(content);
      content = extracted.content;
      const reasoning = extracted.reasoning;

      // content 为空不因 reasoning 复活（spec message-reasoning）
      if (!content) continue;

      messages.push({
        id: `${id}_m${msgIndex++}`,
        role,
        content,
        timestamp,
        ...(reasoning ? { reasoning } : {}),
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
    externalKey: meta.externalKey || undefined,
    ingestSource: meta.ingestSource || undefined,
    sourceProject: meta.sourceProject || undefined,
    projectId: meta.projectId && meta.projectId !== "null" ? meta.projectId : undefined,
    // 仅 "true" 视作已收藏；其余（含缺键与脏值）一律未收藏且不报错（spec content-favorites）
    favorite: meta.favorite === "true" ? true : undefined,
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
  if (session.kind === "run" || session.kind === "chat") {
    lines.push(`kind: ${escapeFrontmatterValue(session.kind)}`);
  }
  lines.push("---", "");

  for (const message of session.messages ?? []) {
    const attrs = [
      `role=${message.role === "user" ? "user" : "assistant"}`,
      `id=${escapeAttr(message.id ?? "")}`,
      `status=${message.status ?? "done"}`,
      message.error ? `error="${escapeAttr(message.error)}"` : "",
      message.contextLabel ? `contextLabel="${escapeAttr(message.contextLabel)}"` : "",
      message.runSkillId ? `runSkillId="${escapeAttr(message.runSkillId)}"` : "",
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
      runSkillId: attrs.runSkillId || undefined,
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
    kind: meta.kind === "run" || meta.kind === "chat" ? meta.kind : undefined,
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

/**
 * 按 frontmatter externalKey 精确匹配（编码后整串比较、不折叠大小写，
 * spec ingest-gateway §4.3）。沿用指纹查找的全量扫描模式（§4.5 决策 2）。
 */
function findConversationByExternalKey(convDir: string, externalKey: string): any | null {
  if (!fs.existsSync(convDir)) return null;
  const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const conv = parseMdFile(f.replace(".md", ""), fs.readFileSync(path.join(convDir, f), "utf-8"));
    if (conv.externalKey === externalKey) return conv;
  }
  return null;
}

/** 仅当已有对话的 projectId 与 folderId 都为空时才接受载荷项目（照抄文档 shouldAdoptProject）。 */
function shouldAdoptConversationProject(existing: any, incoming: any): boolean {
  return Boolean(incoming?.projectId) && !existing?.projectId && !existing?.folderId;
}

function createConversation(convDir: string, incoming: any): UpsertConversationResult {
  const now = new Date().toISOString();
  const full = normalizeConversation({ ...incoming, updatedAt: incoming.updatedAt ?? now });
  // 仅新建分支归类；merge 保留已有 folderId（spec import-auto-classify §4.5 决策 2）
  // 归类作用域是所属项目：同一平台在不同项目下各有一个文件夹
  if (!full.folderId) full.folderId = resolveAutoFolderId(convDir, full.platform, full.projectId);
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
  // 2. 用新内容覆盖当前；保留已有条目的 id 与 folderId（不被导入项覆盖，spec §5 边界·跨folder）。
  //    externalKey / ingestSource：导入项未携带时保留已有值，避免手动导入合并把身份键抹掉
  //    （spec ingest-gateway §4.3）。
  //    项目认领：仅当 projectId 与 folderId 都为空时才接受载荷项目（spec conversation-projects）。
  const adopt = shouldAdoptConversationProject(existing, incoming);
  const adoptedFolderId = adopt
    ? resolveAutoFolderId(convDir, incoming.platform ?? existing.platform, incoming.projectId)
    : existing.folderId;
  const merged = normalizeConversation({
    ...incoming,
    id: existing.id,
    folderId: adoptedFolderId,
    projectId: adopt ? incoming.projectId : existing.projectId,
    externalKey: incoming.externalKey ?? existing.externalKey,
    ingestSource: incoming.ingestSource ?? existing.ingestSource,
    sourceProject: incoming.sourceProject ?? existing.sourceProject,
    // 收藏是用户的关注标记，采集端从不携带它 —— 合并 MUST NOT 把它抹掉（spec content-favorites）
    favorite: existing.favorite,
    updatedAt: now,
  });
  const v = appendConvVersion(convDir, existing.id, { body: conversationToMd(merged), type: "import" });
  updateConvCurrentPointer(convDir, existing.id, v.id);
  const conversation = { ...merged, currentVersionId: v.id };
  writeConversationFile(convDir, conversation);
  return { action: "merged", id: existing.id, title: merged.title, conversation, mergedIntoExisting: true };
}

export interface UpsertConversationOptions {
  /** `<platform>:<encodeURIComponent(externalId)>`，ingest 上报时的第一身份键。 */
  externalKey?: string;
  /** 采集端标识（extension / cli / …），仅溯源。 */
  ingestSource?: string;
}

/**
 * 导入会话：无匹配→新建 / 完全一致→跳过 / 有差异→合并（spec import-dedup-versioning §4.1）。
 * 携带 externalKey 时先走一级查找（spec ingest-gateway §4.1）：命中直接进 skip/merge 判定，
 * 未命中降级指纹路径；无 externalKey 的入口行为完全不变。
 */
function earliestMessageTime(messages: any[]): string | null {
  let min: number = Infinity;
  let minTs: string | null = null;
  for (const m of messages ?? []) {
    if (typeof m?.timestamp !== "string" || !m.timestamp) continue;
    const t = new Date(m.timestamp).getTime();
    if (Number.isNaN(t) || t >= min) continue;
    min = t;
    minTs = m.timestamp;
  }
  return minTs;
}

export function upsertConversation(
  convDir: string,
  incoming: any,
  opts: UpsertConversationOptions = {},
): UpsertConversationResult {
  const normalizedIncoming = normalizeConversation({
    ...incoming,
    ...(opts.externalKey ? { externalKey: opts.externalKey } : {}),
    ...(opts.ingestSource ? { ingestSource: opts.ingestSource } : {}),
  });
  // date = 原平台最早发起时间（spec conversation-time-and-sort US-02）：解析器以导入
  // 时刻兜底 date 时（如 CLI 采集落 pull 时间），用最早消息时间纠正；早于消息的
  // 源创建时间（如 ChatGPT create_time）保留；完全无消息时间则维持现状兜底。
  // dateFromSource（解析源自带会话创建时间）时跳过纠正："优先用之"，且个别消息可能带
  // 平台侧的过期时间戳，纠正会把会话日期拖到会话创建之前。flag 只存在于导入项，
  // normalizeConversation 走 md 往返会丢弃，故从 incoming 读取。
  const earliest = earliestMessageTime(normalizedIncoming.messages);
  const dateMs = new Date(normalizedIncoming.date ?? "").getTime();
  if (incoming?.dateFromSource !== true && earliest && (Number.isNaN(dateMs) || dateMs > new Date(earliest).getTime())) {
    normalizedIncoming.date = earliest;
  }
  const sig = conversationSignature(normalizedIncoming);
  const skipOrMerge = (existing: any): UpsertConversationResult => {
    if (conversationSignature(existing).contentHash === sig.contentHash) {
      if (shouldAdoptConversationProject(existing, normalizedIncoming)) {
        const folderId = resolveAutoFolderId(
          convDir,
          existing.platform ?? normalizedIncoming.platform,
          normalizedIncoming.projectId,
        );
        const next = normalizeConversation({
          ...existing,
          projectId: normalizedIncoming.projectId,
          folderId,
        });
        writeConversationFile(convDir, next);
        return { action: "skipped", id: existing.id, title: next.title, conversation: next };
      }
      return { action: "skipped", id: existing.id, title: existing.title };
    }
    return mergeConversation(convDir, existing, normalizedIncoming);
  };

  if (opts.externalKey) {
    const existing = findConversationByExternalKey(convDir, opts.externalKey);
    if (existing) return skipOrMerge(existing);
  }
  if (conversationDedupable(normalizedIncoming)) {
    const existing = findMatchingConversation(convDir, sig.fingerprint);
    if (existing) return skipOrMerge(existing);
  }
  return createConversation(convDir, normalizedIncoming);
}

// ── Ingest gateway（spec ingest-gateway §4.1 / §4.4）──────────────────────────

const INGEST_MAX_ITEMS = 50;                       // §4.5 决策 7
const INGEST_MAX_BODY_BYTES = 10 * 1024 * 1024;    // 10MB
const PLATFORM_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;   // §4.3
const EXTERNAL_ID_MAX_LEN = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

// CORS：`*` 仅作用于 /api/ingest 与 /api/ingest/ping，安全边界由 token 承担（§4.5 决策 4）。
const INGEST_CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*" };

/** 带体积上限读取请求体；超限返回 null（整体 413，不部分落库）。 */
function readBodyLimited(req: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflowed = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > maxBytes) {
        overflowed = true;
        resolve(null);
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

/** `format: "conversation"` 的结构校验（§5 边界 5）；返回补全 id 的副本。 */
function validateConversationPayload(data: unknown): any {
  const conv: any = data;
  const invalid = () => new Error("invalid conversation payload");
  if (!conv || typeof conv !== "object" || Array.isArray(conv)) throw invalid();
  if (!Array.isArray(conv.messages) || conv.messages.length === 0) throw invalid();
  for (const m of conv.messages) {
    if (!m || typeof m !== "object") throw invalid();
    if (m.role !== "user" && m.role !== "ai") throw invalid();
    if (typeof m.content !== "string") throw invalid();
  }
  // id 缺失或含非法字符（会成为落盘文件名）时重新生成
  const id = typeof conv.id === "string" && CONV_ID_RE.test(conv.id)
    ? conv.id
    : `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return { ...conv, id, folderId: conv.folderId ?? null };
}

/**
 * `format: "document"` 的结构校验（spec document-ingest §ingest 网关接受文档载荷）。
 * 文档没有指纹以外的天然身份，externalId 必填——缺它就无法做幂等 upsert。
 */
/** ingest item 上的 `project` 载荷：命中已有项目不回写 name/description。非法则抛错（该条失败）。 */
function resolveIngestProject(project: unknown): { id: string } | null {
  if (project === undefined || project === null) return null;
  if (typeof project !== "object" || Array.isArray(project)) throw new Error("invalid project payload");
  const key = typeof (project as any).key === "string" ? (project as any).key.trim() : "";
  if (!key) throw new Error("invalid project payload");
  return findOrCreateProjectByKey(key, {
    name: typeof (project as any).name === "string" ? (project as any).name : undefined,
    rootPath: typeof (project as any).rootPath === "string" ? (project as any).rootPath : undefined,
  });
}

function validateDocumentPayload(data: unknown): { title: string; body: string; project?: any } {
  const doc: any = data;
  const invalid = () => new Error("invalid document payload");
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw invalid();
  if (typeof doc.title !== "string" || typeof doc.body !== "string") throw invalid();
  if (doc.project !== undefined) {
    if (!doc.project || typeof doc.project !== "object" || Array.isArray(doc.project)) throw invalid();
    if (typeof doc.project.key !== "string" || !doc.project.key.trim()) throw invalid();
  }
  return { title: doc.title, body: doc.body, project: doc.project };
}

/** 校验 item.externalId：trim 后非空才生效；超长 / 控制字符 → 该 item error（§4.3）。 */
function normalizeExternalId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error("invalid externalId");
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > EXTERNAL_ID_MAX_LEN || CONTROL_CHAR_RE.test(trimmed)) {
    throw new Error("invalid externalId");
  }
  return trimmed;
}

async function handleIngestRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
  convDir: string,
): Promise<boolean> {
  const pathOnly = (req.url ?? "").split("?")[0];
  const method = req.method ?? "GET";

  // ── CORS 预检（US-04 AC1）────────────────────────────────────────────────
  if ((pathOnly === "/api/ingest" || pathOnly === "/api/ingest/ping") && method === "OPTIONS") {
    res.writeHead(204, {
      ...INGEST_CORS,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, GET",
    });
    res.end();
    return true;
  }

  // ── 同源管理端点：不带 CORS、不接受 ingest token（US-03 AC4；Docker 走 authGuard）──
  if (pathOnly === "/api/ingest/config") {
    if (method === "GET") {
      json(res, 200, { token: getIngestToken(ctx.dataDir), redact: readIngestConfig(ctx.dataDir).redact });
      return true;
    }
    if (method === "PUT") {
      try {
        const body = JSON.parse(await readBody(req));
        const config = writeIngestConfig(ctx.dataDir, { redact: body?.redact !== false });
        json(res, 200, { ok: true, redact: config.redact });
      } catch (e) {
        json(res, 400, { error: String(e) });
      }
      return true;
    }
    json(res, 405, { error: "Method not allowed" });
    return true;
  }
  if (pathOnly === "/api/ingest/token/rotate") {
    if (method !== "POST") { json(res, 405, { error: "Method not allowed" }); return true; }
    json(res, 200, { token: rotateIngestToken(ctx.dataDir) });
    return true;
  }

  const isPing = pathOnly === "/api/ingest/ping";
  const isReport = pathOnly === "/api/ingest";
  if (!isPing && !isReport) { json(res, 404, { error: "Not found" }); return true; }
  if ((isPing && method !== "GET") || (isReport && method !== "POST")) {
    json(res, 405, { error: "Method not allowed" }, INGEST_CORS);
    return true;
  }

  // ── Token 闸门（US-03；dev 与 Docker 一致）。401 也带 CORS 头（US-04 AC2）──
  const ip = clientIp(req, ctx.trustProxy ?? false);
  const limit = isLimited(ip);
  if (limit.limited) {
    json(res, 429, { error: "too_many_attempts", retryAfterSec: limit.retryAfterSec }, {
      ...INGEST_CORS,
      "Retry-After": String(limit.retryAfterSec),
    });
    return true;
  }
  const auth = req.headers["authorization"];
  const presented = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!presented || !verifyIngestToken(ctx.dataDir, presented)) {
    recordFail(ip); // 错误尝试计入现有 IP 限速器（US-03 AC2 / AC5）
    json(res, 401, { error: "invalid_token" }, INGEST_CORS);
    return true;
  }

  // ── GET /api/ingest/ping：只验证不落库，无任何副作用（§4.5 决策 9）──────
  if (isPing) {
    json(res, 200, { ok: true }, INGEST_CORS);
    return true;
  }

  // ── 体积 / items 上限：超限整体拒绝 413（§4.5 决策 7）────────────────────
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (declaredLength > INGEST_MAX_BODY_BYTES) {
    json(res, 413, { error: "body too large" }, INGEST_CORS);
    return true;
  }
  let raw: string | null;
  try {
    raw = await readBodyLimited(req, INGEST_MAX_BODY_BYTES);
  } catch (e) {
    json(res, 500, { error: String(e) }, INGEST_CORS);
    return true;
  }
  if (raw === null) {
    json(res, 413, { error: "body too large" }, INGEST_CORS);
    return true;
  }

  // ── 请求体结构校验 → 400（§4.3：platform slug 不符整体 400）──────────────
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "invalid JSON body" }, INGEST_CORS);
    return true;
  }
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  if (!source || !Array.isArray(body.items) || body.items.length === 0) {
    json(res, 400, { error: "source and non-empty items are required" }, INGEST_CORS);
    return true;
  }
  const items: any[] = body.items;
  if (items.length > INGEST_MAX_ITEMS) {
    json(res, 413, { error: `too many items (max ${INGEST_MAX_ITEMS})` }, INGEST_CORS);
    return true;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object" || typeof item.platform !== "string" || !PLATFORM_SLUG_RE.test(item.platform)) {
      json(res, 400, { error: `items[${i}]: invalid platform slug` }, INGEST_CORS);
      return true;
    }
    if (item.format !== "conversation" && item.format !== "raw" && item.format !== "document") {
      json(res, 400, { error: `items[${i}]: invalid format` }, INGEST_CORS);
      return true;
    }
    // 文档载荷的结构与 externalId 是整批前置校验（非法则该批全部不落库）
    if (item.format === "document") {
      try {
        validateDocumentPayload(item.data);
      } catch (e: any) {
        json(res, 400, { error: `items[${i}]: ${e?.message ?? e}` }, INGEST_CORS);
        return true;
      }
      let externalId: string | undefined;
      try {
        externalId = normalizeExternalId(item.externalId);
      } catch {
        json(res, 400, { error: `items[${i}]: invalid externalId` }, INGEST_CORS);
        return true;
      }
      if (!externalId) {
        json(res, 400, { error: `items[${i}]: document items require a non-empty externalId` }, INGEST_CORS);
        return true;
      }
    }
  }

  // ── 逐 item 串行处理：单条失败不影响其余（US-02 AC1）─────────────────────
  const config = readIngestConfig(ctx.dataDir);
  const urlCache = new Map<string, string | null>(); // 同批共享媒体下载缓存
  // 文档 upsert 的查找索引：批内构建一次共用，避免逐条全量读盘（design 决策 14）。
  // 只在真的出现文档 item 时才构建，纯对话批次零额外开销。
  let docIndex: DocumentUpsertIndex | null = null;
  const results: any[] = [];
  let changed = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result: any = { itemIndex: i, conversations: [] };
    try {
      const externalId = normalizeExternalId(item.externalId);
      // cli 源细化到形态粒度（"cli:<form-slug>"），供顶栏形态徽章消费
      // （spec collector-source-expansion §4.4 / US-07）；文档为 "cli:docs"。
      const ingestSource = source === "cli" ? `cli:${item.platform}` : source;

      if (item.format === "document") {
        // ── 文档分支（spec document-ingest）：脱敏 → 媒体本地化 → 项目解析 → upsert ──
        result.documents = [];
        const payload = validateDocumentPayload(item.data);
        let title = payload.title;
        let body = payload.body;
        // docs 平台路径文档：按 externalId 重算侧栏标题，覆盖客户端 stale title
        // （spec docs-path-title · design 决策 7：platform=docs + 含 `/` + 末段 .md）
        if (item.platform === DOCS_PLATFORM && externalId) {
          const pathTitle = deriveDocsPathTitleFromExternalId(externalId);
          if (pathTitle) title = pathTitle;
        }
        let redactions = 0;
        if (config.redact) {
          const redactedTitle = redactText(title);
          title = redactedTitle.text;
          redactions += redactedTitle.count;
          const redactedBody = redactText(body);
          body = redactedBody.text;
          redactions += redactedBody.count;
        }
        if (!body.trim()) {
          // 空正文不是失败：客户端据此推进快照，不重复重试（与空会话同构）
          result.skippedReason = "empty document body";
        } else {
          body = await localizeMedia(body, { downloadRemote: true, urlCache });
          // 项目按不可变 sourceKey 复用；命中时不回写用户改过的 name / description
          const project = payload.project
            ? findOrCreateProjectByKey(payload.project.key, {
                name: payload.project.name,
                rootPath: payload.project.rootPath,
              })
            : null;
          if (!docIndex) docIndex = buildDocumentUpsertIndex();
          const now = new Date().toISOString();
          const upserted = upsertDocument({
            id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim() || "Untitled",
            // 推送一律落所属项目的未分类，服务端不从载荷创建任何文件夹
            folderId: null,
            projectId: project?.id,
            createdAt: now,
            updatedAt: now,
            body,
            externalKey: `docs:${encodeURIComponent(externalId!)}`,
            ingestSource,
            versionType: "import",
          }, { index: docIndex });
          if (upserted.action !== "skipped") changed = true;
          result.documents.push({ action: upserted.action, id: upserted.id, title: upserted.title });
        }
        if (redactions > 0) result.redactions = redactions;
        results.push(result);
        continue;
      }

      // 1. 解析（raw 两级派发 / conversation 结构校验）
      let conversations: any[];
      if (item.format === "raw") {
        if (typeof item.data !== "string") throw new Error("raw data must be a string");
        conversations = parseRawConversations(item.platform, item.data, item.filename);
      } else {
        conversations = [validateConversationPayload(item.data)];
      }

      // 2. 脱敏（版本存档之前，US-06 AC1；关闭时原样保留 AC2）。
      //    title 一并处理：JSONL 等解析器会用首条用户消息生成标题，密钥可能随标题落 frontmatter。
      let redactions = 0;
      if (config.redact) {
        for (const conv of conversations) {
          if (typeof conv.title === "string") {
            const redactedTitle = redactText(conv.title);
            conv.title = redactedTitle.text;
            redactions += redactedTitle.count;
          }
          for (const message of conv.messages ?? []) {
            if (typeof message.content !== "string") continue;
            const redacted = redactText(message.content);
            message.content = redacted.text;
            redactions += redacted.count;
          }
        }
      }

      // 3. 媒体本地化 → externalId 优先 upsert。raw 解析出多条对话时 externalId
      //    无法对应单条，仅单对话结果挂 externalKey，多对话走指纹降级。
      const externalKey = externalId && conversations.length === 1
        ? `${item.platform}:${encodeURIComponent(externalId)}`
        : undefined;
      // CLI 侧 git 仓库根经 item.project 上送；与文档推送走同一条 findOrCreateProjectByKey
      const ingestProject = resolveIngestProject(item.project);
      for (const conv of conversations) {
        await localizeMessages(conv.messages, { downloadRemote: true, urlCache });
        if (ingestProject) conv.projectId = ingestProject.id;
        const upserted = upsertConversation(convDir, conv, { externalKey, ingestSource });
        if (upserted.action !== "skipped") changed = true;
        result.conversations.push({ action: upserted.action, id: upserted.id, title: upserted.title });
      }
      if (redactions > 0) result.redactions = redactions;
    } catch (e: any) {
      result.conversations = []; // error / 空会话时 conversations 为空数组（§4.3）
      if (item.format === "document") result.documents = [];
      // 空会话（如只跑了 /exit 的 CLI 会话）不是失败：归 skipped，客户端可推进快照（边界 3）
      if (e instanceof EmptyPayloadError) result.skippedReason = String(e.message);
      else result.error = String(e?.message ?? e);
    }
    results.push(result);
  }

  if (changed) markStale(); // 索引失效（spec hybrid-search §4.2）
  json(res, 200, { ok: results.every((r) => !r.error), results }, INGEST_CORS);
  return true;
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

  const pathOnly = url.split("?")[0];

  // ── GET /api/health （plane B 探活；无副作用、无鉴权，spec skill-runtime） ──
  if (pathOnly === "/api/health" && method === "GET") {
    json(res, 200, { status: "ok", service: "pentou", version: ctx.version ?? "0.0.0" });
    return true;
  }

  // ── GET /api/tools （手写 agent 工具目录；只读、无副作用，spec skill-runtime）──
  // 内部 runner 与外部 agent（含 MCP）消费同一份目录；目录本体在 src/shared/agent-tools.ts。
  if (pathOnly === "/api/tools" && method === "GET") {
    json(res, 200, { tools: AGENT_TOOLS });
    return true;
  }

  // ── /api/ingest 族（spec ingest-gateway；token 闸门与 CORS 在处理器内部）──
  if (pathOnly === "/api/ingest" || pathOnly.startsWith("/api/ingest/")) {
    return handleIngestRequest(req, res, ctx, convDir);
  }

  // ── /api/migrate 族（一键迁移；server-to-server 文件级同步）──────────────
  if (pathOnly === "/api/migrate/manifest" && method === "GET") {
    try {
      json(res, 200, createMigrationManifest(ctx.dataDir, ctx.version ?? "0.0.0"));
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/folders" && method === "GET") {
    json(res, 200, readFolderBundle(ctx.dataDir));
    return true;
  }

  if (pathOnly === "/api/migrate/files" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const taskId = typeof body?.taskId === "string" ? body.taskId : `remote-${Date.now()}`;
      const files = Array.isArray(body?.files) ? body.files : [];
      const results = files.map((file: any) => receiveMigrationFile(ctx.dataDir, taskId, {
        path: String(file?.path ?? ""),
        expectedHash: String(file?.hash ?? ""),
        data: Buffer.from(String(file?.data ?? ""), "base64"),
      }));
      json(res, 200, { results });
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/files/download" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const paths = Array.isArray(body?.paths) ? body.paths.map(String) : [];
      const files: any[] = [];
      const failures: any[] = [];
      for (const relativePath of paths) {
        try {
          const { buffer, entry } = readManifestFile(ctx.dataDir, relativePath);
          files.push({ path: entry.path, hash: entry.hash, data: buffer.toString("base64") });
        } catch (e: any) {
          failures.push({ path: relativePath, reason: String(e?.message ?? e) });
        }
      }
      json(res, 200, { files, failures });
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/merge-folders" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, { ok: true, result: mergeMigrationFolders(ctx.dataDir, {
        folders: Array.isArray(body?.folders) ? body.folders : [],
        documentFolders: Array.isArray(body?.documentFolders) ? body.documentFolders : [],
        // 旧版本对端不带这个字段，缺省空清单 → 目标端项目原样保留
        documentProjects: Array.isArray(body?.documentProjects) ? body.documentProjects : [],
      }) });
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/finalize" && method === "POST") {
    try {
      json(res, 200, finalizeMigrationReceiver(ctx.dataDir));
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/test" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, await testMigrationPeer(ctx.dataDir, body, ctx.version ?? "0.0.0"));
    } catch (e) {
      json(res, 400, { ok: false, error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/plan" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, await createMigrationPlan(ctx.dataDir, body, ctx.version ?? "0.0.0"));
    } catch (e) {
      json(res, 400, { error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/run" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, await runMigration(ctx.dataDir, body, ctx.version ?? "0.0.0"));
    } catch (e) {
      json(res, 400, { ok: false, error: String(e) });
    }
    return true;
  }

  if (pathOnly === "/api/migrate/progress" && method === "GET") {
    json(res, 200, getMigrationProgress());
    return true;
  }

  // ── /api/obsidian 族（vault 直写导出；spec obsidian-vault-export §4.4）────
  if (pathOnly === "/api/obsidian/vaults" && method === "GET") {
    json(res, 200, { vaults: detectVaults() });
    return true;
  }

  if (pathOnly === "/api/obsidian/export" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, exportNoteToVault(String(body?.vaultPath ?? ""), String(body?.title ?? ""), String(body?.content ?? "")));
    } catch (e) {
      const status = e instanceof ObsidianExportError ? e.status : 400;
      json(res, status, { error: String((e as Error)?.message ?? e) });
    }
    return true;
  }

  if (pathOnly === "/api/obsidian/validate-vault" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      json(res, 200, validateVaultPath(String(body?.vaultPath ?? "")));
    } catch (e) {
      const status = e instanceof ObsidianExportError ? e.status : 400;
      json(res, status, { error: String((e as Error)?.message ?? e) });
    }
    return true;
  }

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

      // favorite=1：只在收藏范围内检索（spec content-favorites）。缺省时行为不变。
      const opts = { favoriteOnly: favoriteOnlyMode(url) };

      const t0 = Date.now();
      const result = mode === "hybrid" ? await searchHybrid(q, limit, opts) : search(q, limit, opts);
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
      const favoriteOnly = favoriteOnlyMode(url); // spec content-favorites：技能可只取收藏的这批
      const files = fs.readdirSync(convDir).filter((f: string) => f.endsWith(".md"));
      const conversations = files
        .map((filename: string) => {
          const content = fs.readFileSync(path.join(convDir, filename), "utf-8");
          return parseMdFile(filename.replace(".md", ""), content);
        })
        .filter((full: any) => !favoriteOnly || full.favorite === true)
        .map((full: any) => (meta ? toConversationMeta(full) : full));
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

      // PUT /api/conversations/:id/favorite（spec content-favorites D3）
      // 专用端点而非通用 PUT：收藏是旁路的元数据动作 —— 不动 updatedAt、不建版本、不碰正文。
      if (sub === "favorite" && method === "PUT") {
        const filePath = path.join(convDir, `${cid}.md`);
        if (!fs.existsSync(filePath)) { json(res, 404, { error: "Not found" }); return true; }
        try {
          const { favorite } = JSON.parse(await readBody(req));
          if (typeof favorite !== "boolean") {
            json(res, 400, { error: "favorite must be a boolean" }); // 磁盘零变更
            return true;
          }
          const existing = parseMdFile(cid, fs.readFileSync(filePath, "utf-8"));
          writeConversationFile(convDir, { ...existing, favorite: favorite || undefined });
          markStale(); // 索引失效：收藏参与检索加权（spec content-favorites）
          json(res, 200, { ok: true, favorite });
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
          // favorite 显式沿用现状（spec content-favorites）：回滚的是内容，不是用户的关注标记
          const merged = { ...targetConv, id: cid, folderId: existing.folderId, projectId: existing.projectId, favorite: existing.favorite, updatedAt: new Date().toISOString() };
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
      json(res, 200, normalizeConversationFolders(JSON.parse(content)));
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
      if (!Array.isArray(body)) {
        json(res, 400, { error: "folders must be an array" });
        return true;
      }
      writeConversationFolders(ctx.dataDir, body);
      json(res, 200, { ok: true });
      return true;
    } catch (e) {
      json(res, 500, { error: String(e) });
      return true;
    }
  }

  // ── GET /api/migrations/conversation-projects（存量归集结果，供一次性提示）──
  if (pathOnly === "/api/migrations/conversation-projects" && method === "GET") {
    json(res, 200, readConversationProjectsMarker(ctx.dataDir) ?? { processed: 0, projects: 0 });
    return true;
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
