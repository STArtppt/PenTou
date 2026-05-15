import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import formidable from "formidable";
import {
  getMarkitdownStatusCached,
  convertFileToMarkdownWithMarkitdown,
  DOC_IMPORT_MAX_FILE_SIZE,
  DOC_IMPORT_MAX_FILE_COUNT,
  DOC_IMPORT_MAX_TOTAL_SIZE,
  DOC_IMPORT_SUPPORTED_EXTENSIONS,
} from "./markitdownPlugin.js";

// Module-level state: prod entry / vite plugin should call setDocsDataDir() at startup.
// We use a mutable module variable rather than threading dataDir through ~30 helper
// signatures (architecture §3.1 calls for "dataDir 参数透传"; the single-process,
// startup-time intent is preserved by this setter — see implementation-log).
let DATA_DIR = path.resolve(process.cwd(), "data");
export let DOCS_DIR = path.join(DATA_DIR, "documents");
let DOC_FOLDERS_FILE = path.join(DATA_DIR, "document-folders.json");

export function setDocsDataDir(dataDir: string): void {
  const resolvedDataDir = path.resolve(dataDir);
  DATA_DIR = resolvedDataDir;
  DOCS_DIR = path.join(resolvedDataDir, "documents");
  DOC_FOLDERS_FILE = path.join(resolvedDataDir, "document-folders.json");
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
  return data.filter((folder: any) => folder?.id !== "df_default");
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
  if (doc.sourceConversationId) lines.push(`sourceConversationId: ${escapeFrontmatterValue(doc.sourceConversationId)}`);
  if (doc.sourcePlatform) lines.push(`sourcePlatform: ${escapeFrontmatterValue(doc.sourcePlatform)}`);
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
    sourceConversationId: meta.sourceConversationId || undefined,
    sourcePlatform: meta.sourcePlatform || undefined,
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

  // ── GET /api/markitdown/status ─────────────────────────────────────────────
  if (url.startsWith("/api/markitdown/status") && method === "GET") {
    const force = url.includes("force=true");
    json(res, 200, getMarkitdownStatusCached(force));
    return true;
  }

  // ── GET /api/document-folders ──────────────────────────────────────────────
  if (url === "/api/document-folders" && method === "GET") {
    try {
      const raw = fs.existsSync(DOC_FOLDERS_FILE)
        ? JSON.parse(fs.readFileSync(DOC_FOLDERS_FILE, "utf-8"))
        : [];
      const data = normalizeDocumentFolders(raw);
      json(res, 200, data);
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return true;
  }

  // ── POST /api/document-folders ─────────────────────────────────────────────
  if (url === "/api/document-folders" && method === "POST") {
    try {
      const body = normalizeDocumentFolders(JSON.parse(await readBody(req)));
      fs.writeFileSync(DOC_FOLDERS_FILE, JSON.stringify(body, null, 2), "utf-8");
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
      createDocWithV1(body);
      const saved = parseDocumentMd(body.id, fs.readFileSync(docPath, "utf-8"));
      json(res, 201, { ok: true, id: body.id, document: saved });
    } catch (e: any) {
      if (e.message?.includes("Invalid document id")) {
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
    } catch (e) { json(res, 500, { error: String(e) }); }
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
      const { body, type, sourceAnnotationIds, rolledBackFromVersionId } = JSON.parse(await readBody(req));
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

  const markitdownStatus = getMarkitdownStatusCached();
  const results: any[] = [];

  for (const file of files) {
    const originalName = file.originalFilename ?? file.newFilename ?? "unknown";
    const ext = path.extname(originalName).toLowerCase();

    if (!DOC_IMPORT_SUPPORTED_EXTENSIONS.has(ext)) {
      results.push({ originalName, success: false, error: `Unsupported file extension: ${ext}` });
      try { fs.unlinkSync(file.filepath); } catch {}
      continue;
    }

    try {
      let mdContent = "";

      if (ext === ".md") {
        mdContent = fs.readFileSync(file.filepath, "utf-8");
      } else if (ext === ".txt") {
        const text = fs.readFileSync(file.filepath, "utf-8");
        mdContent = `---\nSource: ${originalName}\n---\n\n${text}`;
      } else if (ext === ".json") {
        const text = fs.readFileSync(file.filepath, "utf-8");
        mdContent = `\`\`\`json\n${text}\n\`\`\``;
      } else if (!markitdownStatus.installed) {
        results.push({
          originalName,
          success: false,
          error: `该格式需要 markitdown，请按引导安装后重试。${markitdownStatus.error}`,
        });
        try { fs.unlinkSync(file.filepath); } catch {}
        continue;
      } else {
        const converted = convertFileToMarkdownWithMarkitdown({
          command: markitdownStatus.command!,
          args: markitdownStatus.args ?? [],
          sourcePath: file.filepath,
        });
        if (converted.success === false) {
          results.push({ originalName, success: false, error: converted.error });
          try { fs.unlinkSync(file.filepath); } catch {}
          continue;
        }
        mdContent = converted.content;
      }

      // Generate doc id and save
      const docId = `doc_${Date.now()}_${nanoid5()}`;
      const title = originalName.replace(/\.[^.]+$/, "");
      const now = new Date().toISOString();

      createDocWithV1({
        id: docId,
        title,
        folderId: null,
        createdAt: now,
        updatedAt: now,
        body: mdContent,
        importedFrom: originalName,
        importedAt: now,
        versionType: "import",
      });

      const savedDoc = parseDocumentMd(docId, fs.readFileSync(path.join(DOCS_DIR, `${docId}.md`), "utf-8"));
      results.push({ originalName, success: true, document: savedDoc });
    } catch (e: any) {
      results.push({ originalName, success: false, error: String(e) });
    } finally {
      try { fs.unlinkSync(file.filepath); } catch {}
    }
  }

  const successCount = results.filter((r) => r.success).length;
  json(res, 200, {
    success: successCount > 0,
    successCount,
    failedCount: results.length - successCount,
    results,
  });
}
