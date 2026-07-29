import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import formidable from "formidable";
import {
  DOC_IMPORT_MAX_FILE_SIZE,
  DOC_IMPORT_MAX_FILE_COUNT,
  DOC_IMPORT_MAX_TOTAL_SIZE,
  DOC_IMPORT_SUPPORTED_EXTENSIONS,
  LOCAL_DOC_EXTENSIONS,
  MINERU_DOC_EXTENSIONS,
  getMineruStatus,
  updateMineruConfig,
  setMineruDataDir,
  parseFilesWithMineru,
} from "./mineruPlugin.js";
import { documentSignature, documentDedupable } from "../src/server/dedup.js";
import { localizeMedia } from "../src/server/media-assets.js";

// Module-level state: prod entry / vite plugin should call setDocsDataDir() at startup.
// We use a mutable module variable rather than threading dataDir through ~30 helper
// signatures (architecture §3.1 calls for "dataDir 参数透传"; the single-process,
// startup-time intent is preserved by this setter — see implementation-log).
let DATA_DIR = path.resolve(process.cwd(), "data");
export let DOCS_DIR = path.join(DATA_DIR, "documents");
let DOC_FOLDERS_FILE = path.join(DATA_DIR, "document-folders.json");
let DOC_PROJECTS_FILE = path.join(DATA_DIR, "document-projects.json");

export function setDocsDataDir(dataDir: string): void {
  const resolvedDataDir = path.resolve(dataDir);
  DATA_DIR = resolvedDataDir;
  DOCS_DIR = path.join(resolvedDataDir, "documents");
  DOC_FOLDERS_FILE = path.join(resolvedDataDir, "document-folders.json");
  DOC_PROJECTS_FILE = path.join(resolvedDataDir, "document-projects.json");
  setMineruDataDir(resolvedDataDir);
}

export function ensureDocDirs(dataDir?: string): void {
  if (dataDir) setDocsDataDir(dataDir);
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  if (!fs.existsSync(DOC_FOLDERS_FILE)) {
    fs.writeFileSync(DOC_FOLDERS_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function normalizeDocumentFolders(data: unknown): any[] {
  if (!Array.isArray(data)) return [];
  // projectId 是文档文件夹的归属维度（spec document-projects）；对话文件夹的
  // platform 维度绝不进这里，两个平面显式隔离。
  return data
    .filter((folder: any) => folder?.id !== "df_default")
    .map((folder: any) => ({
      ...folder,
      ...(folder?.projectId ? { projectId: String(folder.projectId) } : {}),
    }));
}

function readDocumentFolders(): any[] {
  try {
    if (!fs.existsSync(DOC_FOLDERS_FILE)) return [];
    return normalizeDocumentFolders(JSON.parse(fs.readFileSync(DOC_FOLDERS_FILE, "utf-8")));
  } catch {
    return [];
  }
}

function writeDocumentFolders(folders: any[]): void {
  fs.writeFileSync(DOC_FOLDERS_FILE, JSON.stringify(normalizeDocumentFolders(folders), null, 2), "utf-8");
}

// ── Document projects（spec document-projects：文件夹之上的分组维度）──────────

/** 内置默认目录：不落盘为可写条目，沿用 df_default 的过滤约定。 */
export const DEFAULT_PROJECT_ID = "dp_default";
const PROJECT_ID_RE = /^dp_[a-zA-Z0-9_]+$/;

function normalizeDocumentProjects(data: unknown): any[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((project: any) => project && typeof project.id === "string" && project.id !== DEFAULT_PROJECT_ID)
    .map((project: any) => ({
      id: String(project.id),
      name: typeof project.name === "string" ? project.name : String(project.sourceKey ?? project.id),
      description: typeof project.description === "string" ? project.description : "",
      sourceKey: typeof project.sourceKey === "string" ? project.sourceKey : "",
      createdAt: typeof project.createdAt === "string" ? project.createdAt : new Date().toISOString(),
    }));
}

export function readDocumentProjects(): any[] {
  try {
    if (!fs.existsSync(DOC_PROJECTS_FILE)) return [];
    return normalizeDocumentProjects(JSON.parse(fs.readFileSync(DOC_PROJECTS_FILE, "utf-8")));
  } catch {
    return [];
  }
}

function writeDocumentProjects(projects: any[]): void {
  fs.writeFileSync(DOC_PROJECTS_FILE, JSON.stringify(normalizeDocumentProjects(projects), null, 2), "utf-8");
}

/**
 * 按不可变身份键 sourceKey 复用或创建项目（spec document-projects §项目重命名与身份稳定性）。
 * 命中时**不回写** name / description —— 载荷里的展示字段只在创建那一刻被消费，
 * 否则用户改过的名字与描述会被下一次推送覆盖回去。
 */
export function findOrCreateProjectByKey(
  sourceKey: string,
  meta: { name?: string; rootPath?: string } = {},
): any {
  const key = String(sourceKey ?? "").trim();
  if (!key) throw new Error("project sourceKey is required");
  const projects = readDocumentProjects();
  const existing = projects.find((project) => project.sourceKey === key);
  if (existing) return existing;
  const project = {
    id: `dp_${Date.now()}_${nanoid5()}`,
    name: (meta.name ?? "").trim() || key,
    // 描述初值取本地根路径：此刻唯一确定且对用户有意义的信息（design 决策 5）
    description: (meta.rootPath ?? "").trim(),
    sourceKey: key,
    createdAt: new Date().toISOString(),
  };
  writeDocumentProjects([...projects, project]);
  return project;
}

/**
 * 归属不变量（design 决策 8）：folderId 非空时，其文件夹的 projectId 必须与文档一致，
 * 杜绝"属于项目 A 却在项目 B 的文件夹里"的幽灵状态。文件夹不存在时不拦（存量数据兼容）。
 */
function assertDocumentOwnership(doc: any): void {
  if (!doc?.folderId) return;
  const folder = readDocumentFolders().find((item: any) => item.id === doc.folderId);
  if (!folder) return;
  const folderProject = folder.projectId ?? null;
  const docProject = doc.projectId ?? null;
  if (folderProject !== docProject) {
    throw new Error(
      `document project mismatch: folder "${doc.folderId}" belongs to ${folderProject ?? "default"}, document to ${docProject ?? "default"}`,
    );
  }
}

function parseDocId(url: string, prefix: string): string | null {
  const rest = url.slice(prefix.length);
  const id = rest.split(/[/?]/)[0];
  return id || null;
}

const DOC_ID_RE = /^doc_[a-zA-Z0-9_]+$/;
const VER_ID_RE = /^ver_[a-zA-Z0-9_]+$/;

function assertValidDocId(id: string | null): asserts id is string {
  if (!id || !DOC_ID_RE.test(id)) throw new Error(`Invalid document id: "${id}"`);
}

function assertValidVersionId(id: string | null): asserts id is string {
  if (!id || !VER_ID_RE.test(id)) throw new Error(`Invalid version id: "${id}"`);
}

function nanoid5(): string {
  return Math.random().toString(36).slice(2, 7);
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function csvToMarkdownTable(input: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((part) => part.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((part) => part.trim() !== "")) rows.push(row);
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => Array.from({ length: width }, (_, i) => escapeMarkdownTableCell(r[i] ?? "")));
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function localFileToMarkdown(ext: string, originalName: string, filepath: string): string {
  const text = fs.readFileSync(filepath, "utf-8");
  if (ext === ".md") return text;
  if (ext === ".txt") return `---\nSource: ${originalName}\n---\n\n${text}`;
  if (ext === ".json") return `\`\`\`json\n${text}\n\`\`\``;
  if (ext === ".csv") return csvToMarkdownTable(text);
  if (ext === ".xml") return `\`\`\`xml\n${text}\n\`\`\``;
  throw new Error(`Unsupported local extension: ${ext}`);
}

// Escape frontmatter values (reuse pattern from pentouServerPlugin.ts)
function escapeFrontmatterValue(val: string): string {
  if (!val) return '""';
  if (val.includes('"') || val.includes("\n") || val.includes(":")) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

function documentToMd(doc: any): string {
  const lines = ["---"];
  lines.push(`id: ${escapeFrontmatterValue(doc.id)}`);
  lines.push(`title: ${escapeFrontmatterValue(doc.title ?? "Untitled")}`);
  lines.push(`folderId: ${doc.folderId ? escapeFrontmatterValue(doc.folderId) : "null"}`);
  lines.push(`createdAt: ${escapeFrontmatterValue(doc.createdAt ?? new Date().toISOString())}`);
  lines.push(`updatedAt: ${escapeFrontmatterValue(doc.updatedAt ?? new Date().toISOString())}`);
  lines.push(`currentVersionId: ${escapeFrontmatterValue(doc.currentVersionId ?? "")}`);
  // 项目归属与 ingest 身份映射（spec document-projects / document-ingest）：
  // externalKey 为 upsert 一级查找依据，ingestSource 仅溯源不参与匹配。
  if (doc.projectId) lines.push(`projectId: ${escapeFrontmatterValue(doc.projectId)}`);
  if (doc.externalKey) lines.push(`externalKey: ${escapeFrontmatterValue(doc.externalKey)}`);
  if (doc.ingestSource) lines.push(`ingestSource: ${escapeFrontmatterValue(doc.ingestSource)}`);
  if (doc.sourceConversationId) lines.push(`sourceConversationId: ${escapeFrontmatterValue(doc.sourceConversationId)}`);
  if (doc.sourcePlatform) lines.push(`sourcePlatform: ${escapeFrontmatterValue(doc.sourcePlatform)}`);
  if (doc.sourceAiChatId) lines.push(`sourceAiChatId: ${escapeFrontmatterValue(doc.sourceAiChatId)}`);
  if (doc.generatedBy) lines.push(`generatedBy: ${escapeFrontmatterValue(doc.generatedBy)}`);
  if (doc.generatedAt) lines.push(`generatedAt: ${escapeFrontmatterValue(doc.generatedAt)}`);
  if (doc.importedFrom) lines.push(`importedFrom: ${escapeFrontmatterValue(doc.importedFrom)}`);
  if (doc.importedAt) lines.push(`importedAt: ${escapeFrontmatterValue(doc.importedAt)}`);
  lines.push("---");
  lines.push("");
  lines.push(doc.body ?? "");
  return lines.join("\n");
}

function parseDocumentMd(id: string, content: string): any {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return {
      id,
      title: id,
      folderId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentVersionId: "",
      body: content.trim(),
    };
  }
  const [, fmRaw, body] = fmMatch;
  const meta: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      meta[m[1]] = val;
    }
  }
  return {
    id: meta.id ?? id,
    title: meta.title ?? id,
    folderId: meta.folderId === "null" ? null : (meta.folderId || null),
    createdAt: meta.createdAt ?? new Date().toISOString(),
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
    currentVersionId: meta.currentVersionId ?? "",
    body: body.replace(/^\n/, ""),
    projectId: meta.projectId || undefined,
    externalKey: meta.externalKey || undefined,
    ingestSource: meta.ingestSource || undefined,
    sourceConversationId: meta.sourceConversationId || undefined,
    sourcePlatform: meta.sourcePlatform || undefined,
    sourceAiChatId: meta.sourceAiChatId || undefined,
    generatedBy: meta.generatedBy || undefined,
    generatedAt: meta.generatedAt || undefined,
    importedFrom: meta.importedFrom || undefined,
    importedAt: meta.importedAt || undefined,
  };
}

interface VersionIndexEntry {
  id: string;
  version: number;
  type: string;
  createdAt: string;
  fileName: string;
  sourceAnnotationIds?: string[];
  rolledBackFromVersionId?: string;
}

interface VersionIndex {
  version: number;
  currentVersionId: string;
  versions: VersionIndexEntry[];
}

function readVersionIndex(docId: string): VersionIndex {
  const indexPath = path.join(DOCS_DIR, `${docId}.versions`, "index.json");
  return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

function writeVersionIndex(docId: string, index: VersionIndex): void {
  const indexPath = path.join(DOCS_DIR, `${docId}.versions`, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

function appendVersion(params: {
  docId: string;
  body: string;
  type: string;
  sourceAnnotationIds?: string[];
  rolledBackFromVersionId?: string;
}): { id: string; version: number; type: string; createdAt: string } {
  const index = readVersionIndex(params.docId);
  const nextVersionNum = (index.versions.at(-1)?.version ?? 0) + 1;
  const id = `ver_${Date.now()}_${nanoid5()}`;
  const createdAt = new Date().toISOString();
  const fileName = `v${nextVersionNum}.md`;

  fs.writeFileSync(
    path.join(DOCS_DIR, `${params.docId}.versions`, fileName),
    params.body,
    "utf-8",
  );

  const entry: VersionIndexEntry = {
    id,
    version: nextVersionNum,
    type: params.type,
    createdAt,
    fileName,
  };
  if (params.sourceAnnotationIds?.length) entry.sourceAnnotationIds = params.sourceAnnotationIds;
  if (params.rolledBackFromVersionId) entry.rolledBackFromVersionId = params.rolledBackFromVersionId;

  index.versions.push(entry);
  writeVersionIndex(params.docId, index);
  return { id, version: nextVersionNum, type: params.type, createdAt };
}

function updateCurrentVersionPointer(docId: string, versionId: string): void {
  const index = readVersionIndex(docId);
  index.currentVersionId = versionId;
  writeVersionIndex(docId, index);
}

function createDocWithV1(doc: any): void {
  assertValidDocId(doc.id);
  assertDocumentOwnership(doc);
  const versionsDir = path.join(DOCS_DIR, `${doc.id}.versions`);
  fs.mkdirSync(versionsDir, { recursive: true });

  const v1Id = `ver_${Date.now()}_${nanoid5()}`;
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(versionsDir, "v1.md"), doc.body ?? "", "utf-8");

  const index: VersionIndex = {
    version: 1,
    currentVersionId: v1Id,
    versions: [
      {
        id: v1Id,
        version: 1,
        type: doc.versionType ?? "import",
        createdAt: now,
        fileName: "v1.md",
      },
    ],
  };
  fs.writeFileSync(path.join(versionsDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");

  const fullDoc = { ...doc, currentVersionId: v1Id };
  fs.writeFileSync(path.join(DOCS_DIR, `${doc.id}.md`), documentToMd(fullDoc), "utf-8");
}

// ── Document dedup / merge（spec import-dedup-versioning US-02） ──────────────

interface UpsertDocumentResult {
  action: "created" | "merged" | "skipped";
  id: string;
  title: string;
  document: any;
  mergedIntoExisting?: boolean;
}

function readAllDocuments(): any[] {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs.readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseDocumentMd(f.replace(".md", ""), fs.readFileSync(path.join(DOCS_DIR, f), "utf-8")));
}

/**
 * 一次请求内共用的查找索引（design 决策 14）：findMatchingDocument 是全量读盘扫描，
 * 批量推送 200 份文档时逐条全量扫描是 O(n²) 读盘。批量入口构建一次，批内共用。
 */
export interface DocumentUpsertIndex {
  byExternalKey: Map<string, any>;
  byFingerprint: Map<string, any>;
  /** 文档当前占用的指纹键，落库后用于回收失效条目，避免命中已被覆盖的旧内容。 */
  fingerprintByDocId: Map<string, string>;
}

export function buildDocumentUpsertIndex(): DocumentUpsertIndex {
  const index: DocumentUpsertIndex = {
    byExternalKey: new Map(),
    byFingerprint: new Map(),
    fingerprintByDocId: new Map(),
  };
  for (const doc of readAllDocuments()) indexDocument(index, doc);
  return index;
}

function indexDocument(index: DocumentUpsertIndex, doc: any): void {
  if (doc.externalKey) index.byExternalKey.set(doc.externalKey, doc);
  const previous = index.fingerprintByDocId.get(doc.id);
  if (previous && index.byFingerprint.get(previous)?.id === doc.id) index.byFingerprint.delete(previous);
  const fingerprint = documentSignature(doc).fingerprint;
  const prior = index.byFingerprint.get(fingerprint);
  // 全量构建时先扫到的文档赢（与全量扫描的顺序语义一致）；同一文档更新时就地刷新
  if (!prior || prior.id === doc.id) index.byFingerprint.set(fingerprint, doc);
  index.fingerprintByDocId.set(doc.id, fingerprint);
}

/** 按 frontmatter externalKey 精确匹配（整串比较、不折叠大小写）。 */
function findDocumentByExternalKey(externalKey: string, index?: DocumentUpsertIndex): any | null {
  if (index) return index.byExternalKey.get(externalKey) ?? null;
  for (const doc of readAllDocuments()) {
    if (doc.externalKey === externalKey) return doc;
  }
  return null;
}

function findMatchingDocument(fingerprint: string, index?: DocumentUpsertIndex): any | null {
  if (index) return index.byFingerprint.get(fingerprint) ?? null;
  for (const doc of readAllDocuments()) {
    if (documentSignature(doc).fingerprint === fingerprint) return doc;
  }
  return null;
}

/**
 * 认领"无归属"的已有文档（spec document-projects §删除后重新推送重建项目）。
 *
 * 只在 `projectId` 与 `folderId` **都为空**时才认领：那说明文档停在默认目录的未分类，
 * 没有任何用户手动归类可言（典型来源是项目被删过、或首次被指纹兜底命中的历史文档），
 * 此时推送带来的项目归属是纯增量信息。用户一旦归过类，这里就一律不动
 * （§覆盖不影响批注与归属）。
 */
function shouldAdoptProject(existing: any, incoming: any): boolean {
  return Boolean(incoming?.projectId) && !existing?.projectId && !existing?.folderId;
}

function mergeDocument(existing: any, incoming: any): UpsertDocumentResult {
  // 1. 当前正文存档为 pre-import-overwrite；失败则抛出，中止覆盖（spec §5 异常·版本写入失败）
  appendVersion({ docId: existing.id, body: existing.body, type: "pre-import-overwrite" });
  // 2. 用新内容生成当前版本（import），保留 D 的 id / folderId / 批注
  const v = appendVersion({ docId: existing.id, body: incoming.body, type: "import" });
  updateCurrentVersionPointer(existing.id, v.id);
  const updated = {
    ...existing,
    title: incoming.title ?? existing.title,
    body: incoming.body,
    // 归属是用户的：手动归类过的文档不得被推送打回未分类（spec document-ingest §覆盖不影响批注与归属）。
    // projectId / folderId 一律沿用 existing（上面的展开已保证），此处不接受 incoming 的值；
    // 唯一例外是完全无归属的孤儿文档，见 shouldAdoptProject。
    ...(shouldAdoptProject(existing, incoming) ? { projectId: incoming.projectId } : {}),
    // 指纹命中的老文档没有 externalKey，合并时补写，此后走一级查找。
    externalKey: existing.externalKey ?? incoming.externalKey,
    ingestSource: incoming.ingestSource ?? existing.ingestSource,
    currentVersionId: v.id,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DOCS_DIR, `${existing.id}.md`), documentToMd(updated), "utf-8");
  return { action: "merged", id: existing.id, title: updated.title, document: updated, mergedIntoExisting: true };
}

export interface UpsertDocumentOptions {
  /** 批量调用时传入一次性索引，避免逐条全量读盘（design 决策 14）。 */
  index?: DocumentUpsertIndex;
}

/**
 * 导入文档：无匹配→新建 / 完全一致→跳过 / 有差异→合并（spec §4.1）。
 * 查找顺序为 externalKey（一级）→ 正文指纹（二级兜底）→ 新建
 * （spec document-ingest §文档级 externalKey 幂等 upsert）。
 */
export function upsertDocument(incoming: any, opts: UpsertDocumentOptions = {}): UpsertDocumentResult {
  const index = opts.index;
  const sig = documentSignature(incoming);

  const resolveExisting = (): any | null => {
    if (incoming.externalKey) {
      const hit = findDocumentByExternalKey(incoming.externalKey, index);
      if (hit) return hit;
    }
    if (documentDedupable(incoming)) return findMatchingDocument(sig.fingerprint, index);
    return null;
  };

  const existing = resolveExisting();
  if (existing) {
    if (documentSignature(existing).contentHash === sig.contentHash) {
      // 内容未变但归属可认领：只改 frontmatter 的 projectId，不追加版本、不改 updatedAt
      if (shouldAdoptProject(existing, incoming)) {
        const adopted = { ...existing, projectId: incoming.projectId };
        fs.writeFileSync(path.join(DOCS_DIR, `${existing.id}.md`), documentToMd(adopted), "utf-8");
        if (index) indexDocument(index, adopted);
        return { action: "skipped", id: existing.id, title: existing.title, document: adopted };
      }
      return { action: "skipped", id: existing.id, title: existing.title, document: existing };
    }
    const merged = mergeDocument(existing, incoming);
    if (index) indexDocument(index, merged.document);
    return merged;
  }

  createDocWithV1(incoming);
  const saved = parseDocumentMd(incoming.id, fs.readFileSync(path.join(DOCS_DIR, `${incoming.id}.md`), "utf-8"));
  if (index) indexDocument(index, saved);
  return { action: "created", id: incoming.id, title: saved.title, document: saved };
}

function deleteDocFiles(id: string): void {
  const docPath = path.join(DOCS_DIR, `${id}.md`);
  const annoPath = path.join(DOCS_DIR, `${id}.annotations.json`);
  const versionsDir = path.join(DOCS_DIR, `${id}.versions`);
  if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
  if (fs.existsSync(annoPath)) fs.unlinkSync(annoPath);
  if (fs.existsSync(versionsDir)) fs.rmSync(versionsDir, { recursive: true, force: true });
}

function readVersionBody(docId: string, entry: VersionIndexEntry): string {
  const filePath = path.join(DOCS_DIR, `${docId}.versions`, entry.fileName);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function documentsApiHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "GET";

  // ── GET /api/mineru/status ────────────────────────────────────────────────
  if (url === "/api/mineru/status" && method === "GET") {
    json(res, 200, getMineruStatus());
    return true;
  }

  // ── POST /api/mineru/config ───────────────────────────────────────────────
  if (url === "/api/mineru/config" && method === "POST") {
    try {
      json(res, 200, updateMineruConfig(JSON.parse(await readBody(req))));
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── GET /api/document-folders ──────────────────────────────────────────────
  if (url === "/api/document-folders" && method === "GET") {
    try {
      json(res, 200, readDocumentFolders());
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── POST /api/document-folders ─────────────────────────────────────────────
  if (url === "/api/document-folders" && method === "POST") {
    try {
      writeDocumentFolders(JSON.parse(await readBody(req)));
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── GET /api/document-projects （spec document-projects §项目管理 API）─────
  if (url === "/api/document-projects" && method === "GET") {
    try {
      json(res, 200, readDocumentProjects());
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── POST /api/document-projects （spec document-projects §手动新建项目）────
  // 手动建的项目与 CLI 推送出来的项目共用同一张表：`sourceKey` 取项目名，
  // 这样日后用同名 `--doc-project` 推送时 findOrCreateProjectByKey 命中的正是
  // 这个项目，而不是再建一个同名副本。同名冲突直接 409，不做静默复用。
  if (url === "/api/document-projects" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        json(res, 400, { error: "Project name is required" });
        return true;
      }
      const projects = readDocumentProjects();
      if (projects.some((project) => project.sourceKey === name || project.name === name)) {
        json(res, 409, { error: `Project already exists: "${name}"` });
        return true;
      }
      const project = {
        id: `dp_${Date.now()}_${nanoid5()}`,
        name,
        description: typeof body?.description === "string" ? body.description.trim() : "",
        sourceKey: name,
        createdAt: new Date().toISOString(),
      };
      writeDocumentProjects([...projects, project]);
      json(res, 201, { ok: true, project });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── PATCH / DELETE /api/document-projects/:id ─────────────────────────────
  if (url.startsWith("/api/document-projects/") && (method === "PATCH" || method === "DELETE")) {
    const projectId = parseDocId(url, "/api/document-projects/");
    // 默认目录是内置条目，不可改名/改描述/删除（spec §默认目录）
    if (projectId === DEFAULT_PROJECT_ID) {
      json(res, 400, { error: "Default project cannot be modified" });
      return true;
    }
    if (!projectId || !PROJECT_ID_RE.test(projectId)) {
      json(res, 400, { error: `Invalid project id: "${projectId}"` });
      return true;
    }
    try {
      const projects = readDocumentProjects();
      const target = projects.find((project) => project.id === projectId);
      if (!target) { json(res, 404, { error: "Not found" }); return true; }

      if (method === "PATCH") {
        // 只改展示字段；载荷里的 sourceKey / id / createdAt 一律忽略，
        // 否则改一次名就会让全部文档失去身份（design 决策 5）。
        const body = JSON.parse(await readBody(req));
        const updated = {
          ...target,
          ...(typeof body?.name === "string" ? { name: body.name } : {}),
          ...(typeof body?.description === "string" ? { description: body.description } : {}),
        };
        writeDocumentProjects(projects.map((project) => (project.id === projectId ? updated : project)));
        json(res, 200, { ok: true, project: updated });
        return true;
      }

      // DELETE：删文件夹、不删文档（design 决策 6）。受影响文档落默认目录的未分类。
      const folders = readDocumentFolders();
      const removedFolderIds = new Set(
        folders.filter((folder: any) => folder.projectId === projectId).map((folder: any) => folder.id),
      );
      for (const doc of readAllDocuments()) {
        if (doc.projectId !== projectId && !removedFolderIds.has(doc.folderId)) continue;
        const updated = { ...doc, projectId: undefined, folderId: null, updatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(DOCS_DIR, `${doc.id}.md`), documentToMd(updated), "utf-8");
      }
      writeDocumentFolders(folders.filter((folder: any) => folder.projectId !== projectId));
      writeDocumentProjects(projects.filter((project) => project.id !== projectId));
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── GET /api/documents ─────────────────────────────────────────────────────
  if ((url === "/api/documents" || url.startsWith("/api/documents?")) && method === "GET") {
    try {
      const meta = /[?&]fields=meta(\b|&|$)/.test(url);
      const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
      const docs = files.map((fname) => {
        const id = fname.replace(".md", "");
        const content = fs.readFileSync(path.join(DOCS_DIR, fname), "utf-8");
        const full = parseDocumentMd(id, content);
        return meta ? { ...full, body: "" } : full;
      });
      json(res, 200, docs);
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── POST /api/documents ────────────────────────────────────────────────────
  if (url === "/api/documents" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      assertValidDocId(body.id);
      const docPath = path.join(DOCS_DIR, `${body.id}.md`);
      if (fs.existsSync(docPath)) {
        json(res, 409, { error: "Document already exists" });
        return true;
      }
      // 媒体本地化（spec media-assets §4.4：新建文档不下载远程图片，决策 9）
      if (typeof body.body === "string") body.body = await localizeMedia(body.body, { downloadRemote: false });
      createDocWithV1(body);
      const saved = parseDocumentMd(body.id, fs.readFileSync(docPath, "utf-8"));
      json(res, 201, { ok: true, id: body.id, document: saved });
    } catch (e: any) {
      if (e.message?.includes("Invalid document id") || e.message?.includes("project mismatch")) {
        json(res, 400, { error: e.message });
      } else {
        json(res, 500, { error: String(e) });
      }
    }
    return true;
  }

  // ── Routes with :id ───────────────────────────────────────────────────────

  // ── POST /api/import/document ──────────────────────────────────────────────
  if (url === "/api/import/document" && method === "POST") {
    await handleDocumentImport(req, res);
    return true;
  }

  // ── /api/documents/:id/... ─────────────────────────────────────────────────
  if (!url.startsWith("/api/documents/")) return false;

  const afterPrefix = url.slice("/api/documents/".length);
  const parts = afterPrefix.split("?")[0].split("/");
  const docId = parts[0];

  if (!docId) return false;

  // Validate doc id early (path traversal protection)
  if (!DOC_ID_RE.test(docId)) {
    json(res, 400, { error: `Invalid document id: "${docId}"` });
    return true;
  }

  // Ensure resolved path is within DOCS_DIR
  const resolvedDocsDir = path.resolve(DOCS_DIR);
  const resolvedBase = path.resolve(resolvedDocsDir, docId + ".md");
  const relativeBase = path.relative(resolvedDocsDir, resolvedBase);
  if (relativeBase.startsWith("..") || path.isAbsolute(relativeBase)) {
    json(res, 400, { error: "Path traversal detected" });
    return true;
  }

  const sub = parts.slice(1).join("/");

  // ── GET /api/documents/:id ─────────────────────────────────────────────────
  if (!sub && method === "GET") {
    const docPath = path.join(DOCS_DIR, `${docId}.md`);
    if (!fs.existsSync(docPath)) { json(res, 404, { error: "Not found" }); return true; }
    try {
      json(res, 200, parseDocumentMd(docId, fs.readFileSync(docPath, "utf-8")));
    } catch (e) { json(res, 500, { error: String(e) }); }
    return true;
  }

  // ── PUT /api/documents/:id ─────────────────────────────────────────────────
  if (!sub && method === "PUT") {
    const docPath = path.join(DOCS_DIR, `${docId}.md`);
    if (!fs.existsSync(docPath)) { json(res, 404, { error: "Not found" }); return true; }
    try {
      const body = JSON.parse(await readBody(req));
      const existing = parseDocumentMd(docId, fs.readFileSync(docPath, "utf-8"));
      let nextVersion: any = undefined;

      // 归属不变量先于任何写入校验（design 决策 8）：拒绝时磁盘必须零变更，
      // 不能留下一个已追加的版本。
      assertDocumentOwnership({ ...existing, ...body, id: docId });

      // 媒体本地化（spec media-assets §4.4：编辑保存不下载远程图片，决策 9）
      if (typeof body.body === "string") body.body = await localizeMedia(body.body, { downloadRemote: false });

      if (body.body !== undefined && body.body !== existing.body) {
        const v = appendVersion({ docId, body: body.body, type: "manual-edit" });
        updateCurrentVersionPointer(docId, v.id);
        body.currentVersionId = v.id;
        nextVersion = { ...v, docId, body: body.body };
      }

      const merged = {
        ...existing,
        ...body,
        id: docId,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(docPath, documentToMd(merged), "utf-8");
      json(res, 200, { ok: true, version: nextVersion });
    } catch (e: any) {
      if (e?.message?.includes("project mismatch")) json(res, 400, { error: e.message });
      else json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── DELETE /api/documents/:id ──────────────────────────────────────────────
  if (!sub && method === "DELETE") {
    const docPath = path.join(DOCS_DIR, `${docId}.md`);
    if (!fs.existsSync(docPath)) { json(res, 404, { error: "Not found" }); return true; }
    try {
      deleteDocFiles(docId);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: String(e) }); }
    return true;
  }

  // ── Annotations ────────────────────────────────────────────────────────────
  if (sub === "annotations") {
    const annoPath = path.join(DOCS_DIR, `${docId}.annotations.json`);

    if (method === "GET") {
      try {
        const data = fs.existsSync(annoPath)
          ? JSON.parse(fs.readFileSync(annoPath, "utf-8"))
          : { version: 1, annotations: [] };
        json(res, 200, data);
      } catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }

    if (method === "PUT") {
      try {
        const body = JSON.parse(await readBody(req));
        fs.writeFileSync(annoPath, JSON.stringify({ version: 1, annotations: body.annotations ?? [] }, null, 2), "utf-8");
        json(res, 200, { ok: true });
      } catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }
  }

  // ── Versions ───────────────────────────────────────────────────────────────
  if (sub === "versions" && method === "GET") {
    const versionsDir = path.join(DOCS_DIR, `${docId}.versions`);
    if (!fs.existsSync(versionsDir)) { json(res, 404, { error: "Versions not found" }); return true; }
    try {
      const index = readVersionIndex(docId);
      json(res, 200, { currentVersionId: index.currentVersionId, versions: index.versions });
    } catch (e) { json(res, 500, { error: String(e) }); }
    return true;
  }

  // ── GET/DELETE /api/documents/:id/versions/:vid ────────────────────────────
  if (sub.startsWith("versions/")) {
    const vid = sub.slice("versions/".length);
    if (!VER_ID_RE.test(vid)) { json(res, 400, { error: "Invalid version id" }); return true; }

    if (method === "GET") {
      try {
        const index = readVersionIndex(docId);
        const entry = index.versions.find((v) => v.id === vid);
        if (!entry) { json(res, 404, { error: "Version not found" }); return true; }
        const body = readVersionBody(docId, entry);
        json(res, 200, { ...entry, docId, body });
      } catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }

    if (method === "DELETE") {
      try {
        const index = readVersionIndex(docId);
        if (index.currentVersionId === vid) {
          json(res, 400, { error: "Cannot delete current version" });
          return true;
        }
        const entry = index.versions.find((v) => v.id === vid);
        if (!entry) { json(res, 404, { error: "Version not found" }); return true; }
        const filePath = path.join(DOCS_DIR, `${docId}.versions`, entry.fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        index.versions = index.versions.filter((v) => v.id !== vid);
        writeVersionIndex(docId, index);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 500, { error: String(e) }); }
      return true;
    }
  }

  // ── POST /api/documents/:id/commit-version ─────────────────────────────────
  if (sub === "commit-version" && method === "POST") {
    try {
      const parsed = JSON.parse(await readBody(req));
      const { type, sourceAnnotationIds, rolledBackFromVersionId } = parsed;
      // 媒体本地化（spec media-assets §4.4：commit-version 不下载远程图片，决策 9）
      const body = typeof parsed.body === "string"
        ? await localizeMedia(parsed.body, { downloadRemote: false })
        : parsed.body;
      const v = appendVersion({ docId, body, type, sourceAnnotationIds, rolledBackFromVersionId });

      const SWITCH_CURRENT: string[] = ["llm-rewrite", "manual-edit", "conversation-excerpt", "rolled-back-from"];
      if (SWITCH_CURRENT.includes(type)) {
        updateCurrentVersionPointer(docId, v.id);
        // Update main .md body + currentVersionId
        const docPath = path.join(DOCS_DIR, `${docId}.md`);
        if (fs.existsSync(docPath)) {
          const existing = parseDocumentMd(docId, fs.readFileSync(docPath, "utf-8"));
          const updated = { ...existing, body, currentVersionId: v.id, updatedAt: new Date().toISOString() };
          fs.writeFileSync(docPath, documentToMd(updated), "utf-8");
        }
      }

      json(res, 200, { ok: true, version: { ...v, docId, body } });
    } catch (e) { json(res, 500, { error: String(e) }); }
    return true;
  }

  // ── POST /api/documents/:id/rollback ──────────────────────────────────────
  if (sub === "rollback" && method === "POST") {
    try {
      const { targetVersionId } = JSON.parse(await readBody(req));
      if (!VER_ID_RE.test(targetVersionId)) {
        json(res, 400, { error: "Invalid targetVersionId" });
        return true;
      }

      const index = readVersionIndex(docId);
      const targetEntry = index.versions.find((v) => v.id === targetVersionId);
      if (!targetEntry) { json(res, 404, { error: "Target version not found" }); return true; }

      const targetBody = readVersionBody(docId, targetEntry);

      // Read current version body
      const currentEntry = index.versions.find((v) => v.id === index.currentVersionId);
      const currentBody = currentEntry ? readVersionBody(docId, currentEntry) : "";

      // Append pre-rollback snapshot
      appendVersion({ docId, body: currentBody, type: "pre-rollback" });

      // Append rolled-back-from version
      const newV = appendVersion({
        docId,
        body: targetBody,
        type: "rolled-back-from",
        rolledBackFromVersionId: targetVersionId,
      });

      updateCurrentVersionPointer(docId, newV.id);

      // Update main .md
      const docPath = path.join(DOCS_DIR, `${docId}.md`);
      if (fs.existsSync(docPath)) {
        const existing = parseDocumentMd(docId, fs.readFileSync(docPath, "utf-8"));
        const updated = { ...existing, body: targetBody, currentVersionId: newV.id, updatedAt: new Date().toISOString() };
        fs.writeFileSync(docPath, documentToMd(updated), "utf-8");
      }

      json(res, 200, { ok: true, version: { ...newV, docId, body: targetBody } });
    } catch (e) { json(res, 500, { error: String(e) }); }
    return true;
  }

  // ── POST /api/documents/:id/upload-update ──────────────────────────────────
  if (sub === "upload-update" && method === "POST") {
    if (!fs.existsSync(path.join(DOCS_DIR, `${docId}.md`))) {
      json(res, 404, { error: "Not found" });
      return true;
    }
    await handleDocumentUploadUpdate(req, res, docId);
    return true;
  }

  return false;
}

// ── Document Import (multipart) ───────────────────────────────────────────────

async function handleDocumentImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = formidable({
    maxFileSize: DOC_IMPORT_MAX_FILE_SIZE,
    maxFiles: DOC_IMPORT_MAX_FILE_COUNT,
    uploadDir: tmpdir(),
    keepExtensions: true,
  });

  let files: formidable.File[];
  try {
    const [, formFiles] = await form.parse(req);
    files = Object.values(formFiles).flat().filter(Boolean) as formidable.File[];
  } catch (e: any) {
    if (e.message?.includes("maxFiles")) {
      json(res, 413, { error: `Too many files. Maximum ${DOC_IMPORT_MAX_FILE_COUNT} files per import.` });
    } else if (e.message?.includes("maxFileSize") || e.message?.includes("maxTotalFileSize")) {
      json(res, 413, { error: `File too large. Maximum ${DOC_IMPORT_MAX_FILE_SIZE / 1024 / 1024}MB per file.` });
    } else {
      json(res, 400, { error: String(e) });
    }
    return;
  }

  // Check total size
  const totalSize = files.reduce((acc, f) => acc + (f.size ?? 0), 0);
  if (totalSize > DOC_IMPORT_MAX_TOTAL_SIZE) {
    files.forEach((f) => { try { fs.unlinkSync(f.filepath); } catch {} });
    json(res, 413, { error: `Total payload too large. Maximum ${DOC_IMPORT_MAX_TOTAL_SIZE / 1024 / 1024}MB.` });
    return;
  }

  const results: any[] = Array.from({ length: files.length });
  const mineruFiles: Array<{ index: number; originalName: string; filepath: string }> = [];

  const saveImportedDocument = async (params: {
    index: number;
    originalName: string;
    mdContent: string;
    baseDir: string;
  }) => {
    let mdContent = await localizeMedia(params.mdContent, {
      downloadRemote: true,
      baseDir: params.baseDir,
    });

    const docId = `doc_${Date.now()}_${nanoid5()}`;
    const title = params.originalName.replace(/\.[^.]+$/, "");
    const now = new Date().toISOString();

    const upserted = upsertDocument({
      id: docId,
      title,
      folderId: null,
      createdAt: now,
      updatedAt: now,
      body: mdContent,
      importedFrom: params.originalName,
      importedAt: now,
      versionType: "import",
    });

    results[params.index] = {
      originalName: params.originalName,
      success: true,
      action: upserted.action,
      mergedIntoExisting: upserted.mergedIntoExisting,
      document: upserted.document,
    };
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const originalName = file.originalFilename ?? file.newFilename ?? "unknown";
    const ext = path.extname(originalName).toLowerCase();

    if (!DOC_IMPORT_SUPPORTED_EXTENSIONS.has(ext)) {
      results[i] = { originalName, success: false, error: `Unsupported file extension: ${ext}` };
      try { fs.unlinkSync(file.filepath); } catch {}
      continue;
    }

    try {
      if (LOCAL_DOC_EXTENSIONS.has(ext)) {
        await saveImportedDocument({
          index: i,
          originalName,
          mdContent: localFileToMarkdown(ext, originalName, file.filepath),
          baseDir: path.dirname(file.filepath),
        });
        try { fs.unlinkSync(file.filepath); } catch {}
      } else if (MINERU_DOC_EXTENSIONS.has(ext)) {
        mineruFiles.push({ index: i, originalName, filepath: file.filepath });
      }
    } catch (e: any) {
      results[i] = { originalName, success: false, error: String(e) };
      try { fs.unlinkSync(file.filepath); } catch {}
    }
  }

  if (mineruFiles.length > 0) {
    const parsed = await parseFilesWithMineru(mineruFiles.map((item) => ({
      originalName: item.originalName,
      filepath: item.filepath,
    })));
    for (let i = 0; i < mineruFiles.length; i++) {
      const item = mineruFiles[i];
      const parsedItem = parsed[i];
      try {
        if (parsedItem.success === false) {
          results[item.index] = { originalName: item.originalName, success: false, error: parsedItem.error };
        } else {
          await saveImportedDocument({
            index: item.index,
            originalName: item.originalName,
            mdContent: parsedItem.content,
            baseDir: parsedItem.baseDir,
          });
        }
      } catch (e: any) {
        results[item.index] = { originalName: item.originalName, success: false, error: String(e) };
      } finally {
        if (parsedItem.success) parsedItem.cleanup();
        try { fs.unlinkSync(item.filepath); } catch {}
      }
    }
  }

  const compactResults = results.filter(Boolean);
  const successCount = compactResults.filter((r) => r.success).length;
  json(res, 200, {
    success: successCount > 0,
    successCount,
    failedCount: compactResults.length - successCount,
    results: compactResults,
  });
}

// ── Document Upload Update (multipart, spec doc-upload-update) ────────────────

/** 上传 .md 覆盖指定文档正文：绕过指纹去重，目标由 :id 显式指定（spec §4.1）。 */
async function handleDocumentUploadUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  docId: string,
): Promise<void> {
  const form = formidable({
    maxFileSize: DOC_IMPORT_MAX_FILE_SIZE,
    maxFiles: 1,
    uploadDir: tmpdir(),
    keepExtensions: true,
  });

  let file: formidable.File | undefined;
  try {
    const [, formFiles] = await form.parse(req);
    file = (Object.values(formFiles).flat().filter(Boolean) as formidable.File[])[0];
  } catch (e: any) {
    if (e.message?.includes("maxFileSize") || e.message?.includes("maxTotalFileSize")) {
      json(res, 413, { error: `File too large. Maximum ${DOC_IMPORT_MAX_FILE_SIZE / 1024 / 1024}MB per file.` });
    } else {
      json(res, 400, { error: String(e) });
    }
    return;
  }

  if (!file) {
    json(res, 400, { error: "No file uploaded" });
    return;
  }

  const originalName = file.originalFilename ?? file.newFilename ?? "unknown";
  try {
    if (path.extname(originalName).toLowerCase() !== ".md") {
      json(res, 400, { error: "Unsupported file extension: only .md is accepted" });
      return;
    }
    const raw = fs.readFileSync(file.filepath, "utf-8");
    const body = await localizeMedia(raw, {
      downloadRemote: true,
      baseDir: path.dirname(file.filepath),
    });
    const docPath = path.join(DOCS_DIR, `${docId}.md`);
    const existing = parseDocumentMd(docId, fs.readFileSync(docPath, "utf-8"));
    if (existing.body === body) {
      json(res, 200, { ok: true, action: "skipped", document: existing });
      return;
    }
    // 复用 mergeDocument：pre-import-overwrite 存档 + import 新版本；不传 title 保留原标题（spec 决策 3）
    const result = mergeDocument(existing, { body });
    json(res, 200, { ok: true, action: result.action, document: result.document });
  } catch (e) {
    json(res, 500, { error: String(e) });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
}
