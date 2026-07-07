import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";

export const DOC_IMPORT_MAX_FILE_SIZE = 30 * 1024 * 1024;
export const DOC_IMPORT_MAX_FILE_COUNT = 30;
export const DOC_IMPORT_MAX_TOTAL_SIZE = 150 * 1024 * 1024;

export const LOCAL_DOC_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".xml"]);
export const MINERU_DOC_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".html",
  ".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp",
]);
export const DOC_IMPORT_SUPPORTED_EXTENSIONS = new Set([
  ...LOCAL_DOC_EXTENSIONS,
  ...MINERU_DOC_EXTENSIONS,
]);

const MINERU_BASE_URL = "https://mineru.net";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

let DATA_DIR = path.resolve(process.cwd(), "data");
let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);
let sleepImpl = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MineruStatus {
  configured: boolean;
  hasKey: boolean;
}

export interface MineruConfigPatch {
  apiToken?: string;
  clear?: boolean;
}

export interface MineruImportFile {
  originalName: string;
  filepath: string;
}

export type MineruParseResult =
  | { originalName: string; success: true; content: string; baseDir: string; cleanup: () => void }
  | { originalName: string; success: false; error: string };

interface BatchFile {
  name: string;
  data_id: string;
  is_ocr: boolean;
}

interface PendingFile {
  file: MineruImportFile;
  dataId: string;
}

export function setMineruDataDir(dataDir: string): void {
  DATA_DIR = path.resolve(dataDir);
}

function configPath(): string {
  return path.join(DATA_DIR, ".config", "mineru.json");
}

function readToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    return typeof raw.apiToken === "string" ? raw.apiToken : "";
  } catch {
    return "";
  }
}

function writeToken(apiToken: string): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ apiToken }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(configPath(), 0o600); } catch {}
}

export function getMineruStatus(): MineruStatus {
  const configured = !!readToken();
  return { configured, hasKey: configured };
}

export function updateMineruConfig(patch: MineruConfigPatch): MineruStatus {
  if (patch.clear) {
    try { fs.unlinkSync(configPath()); } catch {}
    return getMineruStatus();
  }
  const nextToken = typeof patch.apiToken === "string" ? patch.apiToken.trim() : "";
  if (nextToken) writeToken(nextToken);
  return getMineruStatus();
}

function makeDataId(file: MineruImportFile, index: number): string {
  const hash = crypto
    .createHash("sha256")
    .update(file.originalName)
    .update("\0")
    .update(fs.readFileSync(file.filepath))
    .digest("hex")
    .slice(0, 16);
  return `pentou_${index}_${hash}`;
}

function mapMineruError(input: unknown): string {
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  if (raw.includes("A0202") || raw.includes("A0211")) {
    return "Token 无效或已过期，请到 mineru.net「API 管理」重新生成并更新配置";
  }
  if (raw.includes("-60005")) return "文件超过 200MB";
  if (raw.includes("-60006")) return "文档超过 200 页，请拆分后重试";
  return raw || "解析超时或网络异常，请稍后重试";
}

async function mineruJson(pathname: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetchImpl(`${MINERU_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { msg: text }; }
  if (!res.ok || data.code !== 0) {
    throw new Error(mapMineruError(data?.code ?? data?.msg ?? text ?? res.status));
  }
  return data;
}

async function createBatch(files: MineruImportFile[], token: string): Promise<{ batchId: string; fileUrls: string[]; batchFiles: BatchFile[] }> {
  const batchFiles = files.map((file, index) => ({
    name: file.originalName,
    data_id: makeDataId(file, index),
    is_ocr: true,
  }));
  const data = await mineruJson("/api/v4/file-urls/batch", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enable_formula: true,
      enable_table: true,
      language: "ch",
      files: batchFiles,
    }),
  });
  const batchId = data?.data?.batch_id;
  const fileUrls = data?.data?.file_urls;
  if (!batchId || !Array.isArray(fileUrls) || fileUrls.length !== files.length) {
    throw new Error("MinerU 返回的上传地址异常");
  }
  return { batchId, fileUrls, batchFiles };
}

async function uploadToSignedUrl(file: MineruImportFile, url: string): Promise<void> {
  const res = await fetchImpl(url, {
    method: "PUT",
    body: fs.readFileSync(file.filepath),
  });
  if (!res.ok) throw new Error(`上传失败：HTTP ${res.status}`);
}

function resultKey(result: any): string {
  return String(result?.data_id || result?.file_name || "");
}

async function pollBatch(batchId: string, token: string, pending: PendingFile[]): Promise<Map<string, any>> {
  const wanted = new Map(pending.map((item) => [item.dataId, item]));
  const done = new Map<string, any>();
  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    try {
      const data = await mineruJson(`/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`, token);
      const rows = data?.data?.extract_result;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const key = resultKey(row);
          const byId = wanted.get(key);
          const byName = pending.find((item) => item.file.originalName === row?.file_name);
          const matched = byId ?? byName;
          if (!matched) continue;
          if (row?.state === "done" || row?.state === "failed") done.set(matched.dataId, row);
        }
      }
      if (done.size >= wanted.size) return done;
    } catch {
      // Network blips are tolerated until the overall timeout.
    }
    await sleepImpl(POLL_INTERVAL_MS);
  }

  for (const item of pending) {
    if (!done.has(item.dataId)) done.set(item.dataId, { state: "failed", err_msg: "解析超时" });
  }
  return done;
}

function safeZipPath(root: string, entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/")) return null;
  const full = path.resolve(root, normalized);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

function normalizeHtmlImageRefs(markdown: string): string {
  return markdown.replace(/<img\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*)>/gi, (_match, before, _quote, src, after) => {
    const altMatch = String(`${before} ${after}`).match(/\balt=(["'])(.*?)\1/i);
    const alt = altMatch?.[2] ?? "";
    return `![${alt}](${src})`;
  });
}

async function downloadAndExtractMarkdown(zipUrl: string): Promise<{ content: string; baseDir: string; cleanup: () => void }> {
  const res = await fetchImpl(zipUrl);
  if (!res.ok) throw new Error(`结果下载失败：HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const entries = unzipSync(buf);
  const baseDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-mineru-"));
  let fullMdPath = "";

  try {
    for (const [entryName, bytes] of Object.entries(entries)) {
      const outPath = safeZipPath(baseDir, entryName);
      if (!outPath) continue;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(bytes));
      if (entryName === "full.md" || entryName.endsWith("/full.md")) fullMdPath = outPath;
    }
    if (!fullMdPath || !fs.existsSync(fullMdPath)) throw new Error("解析结果异常：ZIP 中缺少 full.md");
    return {
      content: normalizeHtmlImageRefs(fs.readFileSync(fullMdPath, "utf-8")),
      baseDir,
      cleanup: () => fs.rmSync(baseDir, { recursive: true, force: true }),
    };
  } catch (e) {
    fs.rmSync(baseDir, { recursive: true, force: true });
    throw e;
  }
}

export async function parseFilesWithMineru(files: MineruImportFile[]): Promise<MineruParseResult[]> {
  const token = readToken();
  if (!token) {
    return files.map((file) => ({
      originalName: file.originalName,
      success: false,
      error: "需配置 MinerU Token 后才能导入该格式，请在导入抽屉中完成配置",
    }));
  }

  const results = new Map<string, MineruParseResult>();
  try {
    const batch = await createBatch(files, token);
    const pending: PendingFile[] = [];

    await Promise.all(files.map(async (file, index) => {
      const dataId = batch.batchFiles[index].data_id;
      try {
        await uploadToSignedUrl(file, batch.fileUrls[index]);
        pending.push({ file, dataId });
      } catch (e: any) {
        results.set(dataId, { originalName: file.originalName, success: false, error: String(e?.message ?? e) });
      }
    }));

    if (pending.length > 0) {
      const polled = await pollBatch(batch.batchId, token, pending);
      await Promise.all(pending.map(async (item) => {
        const row = polled.get(item.dataId);
        if (!row || row.state !== "done") {
          results.set(item.dataId, {
            originalName: item.file.originalName,
            success: false,
            error: row?.err_msg ? `解析失败：${mapMineruError(row.err_msg)}` : "解析超时或网络异常，请稍后重试",
          });
          return;
        }
        try {
          const extracted = await downloadAndExtractMarkdown(row.full_zip_url);
          results.set(item.dataId, { originalName: item.file.originalName, success: true, ...extracted });
        } catch (e: any) {
          results.set(item.dataId, { originalName: item.file.originalName, success: false, error: String(e?.message ?? e) });
        }
      }));
    }

    return files.map((file, index) => {
      const dataId = batch.batchFiles[index].data_id;
      return results.get(dataId) ?? { originalName: file.originalName, success: false, error: "解析超时" };
    });
  } catch (e: any) {
    const message = mapMineruError(e?.message ?? e);
    return files.map((file) => ({ originalName: file.originalName, success: false, error: message }));
  }
}

export function __setMineruFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

export function __setMineruSleepForTests(fn: ((ms: number) => Promise<unknown>) | null): void {
  sleepImpl = fn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
}
