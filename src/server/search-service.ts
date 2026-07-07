/**
 * search-service.ts — 全文检索 + 混合检索引擎（spec hybrid-search §4.1/§4.2/§4.7）。
 *
 * Phase 1：better-sqlite3 直连 SQLite FTS5 + BM25（v0.4 由 qmd 改为自建，见 spec §4.1）。
 * Phase 2：在 FTS5 之上叠加在线 embedding 向量层（纯 JS 暴力余弦）+ RRF 融合（spec §4.7）。
 *   - 嵌入配置服务端持久化（DATA_DIR/.config/embedding.json，env 可覆盖），默认关。
 *   - 背景分批限流嵌入；FTS 与向量解耦：FTS 即时全量，向量异步补齐。
 *   - 状态机 disabled/configuring/embedding/partial/ready/error 厘清 degraded(本应语义却退字面) vs partial(语义在建)。
 *
 * 索引数据源复用落盘的 DATA_DIR/{conversations,documents}/*.md，是只读派生物，删库可重建。
 * 索引 SQLite 持久化到 DATA_DIR/.qmd/index.db。
 *
 * 单向依赖：api-router → searchService（configure/markStale/search/searchHybrid/config），本模块**不**反向 import handler。
 *
 * CJK 召回：FTS5 unicode61 把整段中文当一个 token、trigram 又要 query≥3 字，2 字中文词会漏召回。
 * 故索引/查询都把 CJK 逐字切分为单字 token、用短语查询保证相邻匹配（spike 已验证）。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { embed as providerEmbed, EmbeddingError } from "./embedding-provider.js";
import type { EmbeddingConfig } from "./embedding-provider.js";

export type SearchMode = "lex" | "hybrid";
export type MatchReason = "lex" | "semantic" | "both";
export type EmbeddingPhase = "disabled" | "configuring" | "embedding" | "partial" | "ready" | "error";

/** 服务端归一化后的检索结果（前后端共享形状，spec §4.3）。 */
export interface SearchHit {
  type: "conversation" | "document";
  id: string;
  title: string;
  date?: string;
  snippetParts: Array<{ text: string; matched: boolean }>;
  snippetText: string;
  score: number;
  // Phase 2：命中来源。缺省（Phase 1 / lex 路径）视作 "lex"，不破坏现有形状（spec §4.3/§4.7）。
  matchReason?: MatchReason;
}

export interface SearchResult {
  status: "ready" | "building";
  hits: SearchHit[];
  mode?: SearchMode;     // 实际生效模式（§4.7 出参回显）
  degraded?: boolean;    // 本应语义却退回字面（§4.7）
  partial?: boolean;     // 语义索引在建、结果可能不全（§4.7）
}

/** 嵌入子系统对外状态（供 /api/search/config 与 getStatus 扩展，绝不含明文 key）。 */
export interface EmbeddingState {
  enabled: boolean;
  endpoint: string;
  model: string;
  dim?: number;
  phase: EmbeddingPhase;
  hasKey: boolean;
  embedding: { done: number; total: number };
  error?: string;
}

// ── 模块级状态 ────────────────────────────────────────────────────────────────

let dataDir = "";
let db: Database.Database | null = null;
let built = false;        // 至少完成过一次全量构建
let building = false;     // 后台预热构建进行中
let stale = false;        // 有 .md 写入，下次检索前需增量刷新

// 嵌入子系统状态（§4.7）
let embConfig: EmbeddingConfig = { enabled: false, endpoint: "", model: "", apiKey: "" };
let embPhase: EmbeddingPhase = "disabled";
let embError = "";
let embDim = 0;            // 当前生效维度（首次成功嵌入自适应、持久化）
let embedRunning = false;  // 背景嵌入任务进行中
let keyFromEnv = false;    // key 来自环境变量 → 不落文件（§4.7 安全契约）
let manualConfigApplied = false; // 运行时已调 updateEmbeddingConfig → 启动预热不再覆盖其 phase

// 测试可注入 embed 实现，避免真实网络（§6 Phase 2 单测）。
let embedFn: typeof providerEmbed = providerEmbed;

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
// 切分用：连续 CJK 视作一个「词」（→ 单字短语），连续字母数字视作一个词。
const TOKEN_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+|[a-zA-Z0-9]+/g;

// 向量层常量（§4.7）
const CHUNK_SIZE = 400;       // ~300–500 字窗口
const CHUNK_OVERLAP = 60;     // ~15% 重叠
const SEM_SNIPPET = 140;      // 纯语义命中取 chunk 前 N 字
const EMBED_BATCH = 16;       // 分批限流
const EMBED_PAUSE_MS = 50;    // 批间停顿（限流）
const RRF_K = 60;
const RRF_TOPN = 50;

/** CJK 逐字加空格，拉丁/数字保持成串 —— 喂给 unicode61 后 CJK 成单字 token。 */
function segment(text: string): string {
  return text.replace(CJK, (c) => ` ${c} `);
}

function tokens(q: string): string[] {
  return [...q.matchAll(TOKEN_RE)].map((m) => m[0]).filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 公共 API ─────────────────────────────────────────────────────────────────

/** 由 api-router.ensureDirs 在 dev/prod 启动时调用：设定数据目录并后台预热索引。 */
export function configureSearch(dir: string): void {
  const resolved = path.resolve(dir);
  if (resolved === dataDir && db) return; // 幂等
  dataDir = resolved;
  // dataDir 变更（如测试）→ 丢弃旧连接与状态
  if (db) { try { db.close(); } catch { /* noop */ } db = null; }
  built = false;
  building = false;
  stale = false;
  resetEmbeddingState();
  loadEmbeddingConfig();
  // 后台预热：不阻塞启动（spec §4.5 决策7）。预热窗口内 search 返回 building。
  building = true;
  const target = resolved;
  setImmediate(() => {
    if (dataDir !== target) return; // 期间数据目录已变（如测试切换）→ 放弃这次预热
    try {
      refreshNow();
      // 嵌入启用 → 补齐向量（断点续嵌）；首次启用但无 chunk 时全量分块（§4.7 索引生命周期）。
      // 若运行时已手动改过配置（updateEmbeddingConfig），由它驱动 phase，预热不覆盖。
      if (embConfig.enabled && !manualConfigApplied) {
        if (chunkCount() === 0) rechunkAll();
        embPhase = derivePhase();
        kickEmbed();
      }
    } catch (e) {
      console.error({ module: "searchService", op: "prewarm", err: String(e) });
    } finally { if (dataDir === target) building = false; }
  });
}

/** 对话/文档 .md 写入后调用：标记索引失效，下次检索前增量刷新（spec §4.2）。 */
export function markStale(): void {
  stale = true;
}

/** 索引状态（spec §4.4）。预热完成前为 building，之后为 ready。 */
export function getStatus(): "ready" | "building" {
  return built ? "ready" : "building";
}

/**
 * 全文检索（lex）。q 已由路由层做空/截断处理。
 * - 索引未就绪（首次预热未完成）→ {status:"building", hits:[]}，前端轮询。
 * - 就绪 → 若 stale 先增量刷新，再查询，返回 ready + hits。
 */
export function search(q: string, limit: number): SearchResult {
  const match = buildMatch(q);
  if (!match) return { status: "ready", hits: [], mode: "lex" };

  const status = ensureFresh();
  if (status === "building") return { status, hits: [], mode: "lex" };

  return { status: "ready", hits: lexHits(match, q, limit), mode: "lex" };
}

/**
 * 混合检索（spec §4.7）。按嵌入子系统状态机分流：
 * - disabled → 纯 lex，无 degraded（用户没要语义）。
 * - configuring / error → lex + degraded:true（本应语义却退字面）。
 * - embedding / partial / ready → FTS ∪ 向量 RRF 融合；非 ready 时 partial:true。
 * - 查询期 provider 失败 → 降级 lex + degraded:true。
 */
export async function searchHybrid(q: string, limit: number): Promise<SearchResult> {
  const match = buildMatch(q);
  if (!match) return { status: "ready", hits: [], mode: "lex" };

  const status = ensureFresh();
  if (status === "building") return { status, hits: [], mode: "lex" };

  if (embPhase === "disabled") {
    return { status: "ready", hits: lexHits(match, q, limit), mode: "lex" };
  }
  if (embPhase === "configuring" || embPhase === "error") {
    return { status: "ready", hits: lexHits(match, q, limit), mode: "lex", degraded: true };
  }

  // embedding / partial / ready → 混合
  try {
    const hits = await hybridHits(match, q, limit);
    return {
      status: "ready",
      hits,
      mode: "hybrid",
      partial: embPhase !== "ready" ? true : undefined,
    };
  } catch (e) {
    embPhase = "error";
    embError = e instanceof Error ? e.message : String(e);
    return { status: "ready", hits: lexHits(match, q, limit), mode: "lex", degraded: true };
  }
}

/** 嵌入子系统对外状态（§4.4/§4.7）。绝不返回明文 apiKey。 */
export function getEmbeddingState(): EmbeddingState {
  const { done, total } = embedCounts();
  return {
    enabled: embConfig.enabled,
    endpoint: embConfig.endpoint,
    model: embConfig.model,
    dim: embDim || undefined,
    phase: embPhase,
    hasKey: !!embConfig.apiKey,
    embedding: { done, total },
    error: embPhase === "error" ? embError : undefined,
  };
}

/**
 * 读写嵌入配置（spec §4.7 / 安全契约）。
 * - apiKey 省略 / 空串 → 沿用现有（PUT 留空表示不改 key）。
 * - enabled:false → 停任务、清向量/分块、删 key 字段、phase=disabled。
 * - 首次启用或 model 变化 → 清向量全量重嵌（维度可能变）。
 */
export function updateEmbeddingConfig(patch: {
  enabled?: boolean;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}): EmbeddingState {
  manualConfigApplied = true;
  const wasEnabled = embConfig.enabled;
  const prevModel = embConfig.model;

  if (patch.endpoint !== undefined) embConfig.endpoint = patch.endpoint.trim();
  if (patch.model !== undefined) embConfig.model = patch.model.trim();
  if (patch.apiKey) { embConfig.apiKey = patch.apiKey; keyFromEnv = false; }
  if (patch.enabled !== undefined) embConfig.enabled = patch.enabled;

  if (!embConfig.enabled) {
    // 关闭 / 清除（§4.7 安全契约）：停任务、清向量、删 key（非仅置空）。
    embConfig.apiKey = "";
    embConfig.dim = undefined;
    embDim = 0;
    embPhase = "disabled";
    embError = "";
    clearVectorsAndChunks();
    saveEmbeddingConfig();
    return getEmbeddingState();
  }

  const modelChanged = embConfig.model !== prevModel;
  saveEmbeddingConfig();
  if (!wasEnabled || modelChanged) {
    // 维度可能随 model 变 → 拒绝混合旧维度，清空全量重嵌（§4.7）。
    embConfig.dim = undefined;
    embDim = 0;
    clearVectorsAndChunks();
    rechunkAll();
  }
  embPhase = "configuring";
  embError = "";
  kickEmbed();
  return getEmbeddingState();
}

// ── 索引刷新（FTS + 分块） ──────────────────────────────────────────────────

/** 同步全量/增量刷新索引（mtime 比对）。供启动预热与测试直接调用。 */
export function refreshNow(): void {
  if (!dataDir) return; // 未配置数据目录 → 不建索引（避免在 cwd 误建 .qmd）
  const conn = openDb();
  const scanned = scanFiles();
  const seen = new Set<string>();
  const chunkEnabled = embConfig.enabled;

  const getFile = conn.prepare("SELECT mtime, rowref FROM files WHERE path = ?");
  const delDoc = conn.prepare("DELETE FROM docs WHERE rowid = ?");
  const insDoc = conn.prepare(
    "INSERT INTO docs(seg_title, seg_body, type, docid, title, body, date) VALUES (?,?,?,?,?,?,?)",
  );
  const upFile = conn.prepare(
    "INSERT INTO files(path, mtime, rowref) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, rowref=excluded.rowref",
  );

  let chunksChanged = false;
  const tx = conn.transaction(() => {
    for (const f of scanned) {
      seen.add(f.path);
      const prev = getFile.get(f.path) as { mtime: number; rowref: number } | undefined;
      if (prev && prev.mtime === f.mtime) continue; // 未变，跳过
      if (prev) delDoc.run(prev.rowref);
      const raw = fs.readFileSync(f.path, "utf-8");
      const { title, date, body } = readMd(raw, f.type);
      const info = insDoc.run(segment(title), segment(body), f.type, f.docid, title, body, date);
      upFile.run(f.path, f.mtime, info.lastInsertRowid);
      if (chunkEnabled) { rechunkDoc(conn, f.docid, f.type, body, f.mtime); chunksChanged = true; }
    }
    // 已删除的文件：清理索引行（及其分块/向量）
    const all = conn.prepare("SELECT path, rowref FROM files").all() as Array<{ path: string; rowref: number }>;
    const delFile = conn.prepare("DELETE FROM files WHERE path = ?");
    for (const row of all) {
      if (!seen.has(row.path)) {
        const docid = path.basename(row.path).slice(0, -3);
        delDoc.run(row.rowref);
        delFile.run(row.path);
        if (chunkEnabled) { deleteChunksForDoc(conn, docid); chunksChanged = true; }
      }
    }
  });
  tx();

  built = true;
  stale = false;
  if (chunkEnabled && chunksChanged) kickEmbed(); // 新/变 chunk 异步补嵌
}

// ── 内部实现：FTS 查询 ───────────────────────────────────────────────────────

/** 保证索引就绪：未构建→触发懒构建并返回 building；stale→同步增量刷新。 */
function ensureFresh(): "ready" | "building" {
  if (!built) {
    if (!building) {
      building = true;
      const target = dataDir;
      setImmediate(() => {
        if (dataDir !== target) return;
        try { refreshNow(); } catch (e) { console.error({ module: "searchService", op: "lazyBuild", err: String(e) }); }
        finally { if (dataDir === target) building = false; }
      });
    }
    return "building";
  }
  if (stale) refreshNow();
  return "ready";
}

interface DocRow { type: SearchHit["type"]; docid: string; title: string; body: string; date: string; }

function lexHits(match: string, q: string, limit: number): SearchHit[] {
  const conn = openDb();
  const runs = tokens(q);
  const rows = conn
    .prepare(
      `SELECT type, docid, title, body, date, bm25(docs, 10.0, 1.0) AS score
       FROM docs WHERE docs MATCH ? ORDER BY score LIMIT ?`,
    )
    .all(match, limit) as Array<DocRow & { score: number }>;

  return rows.map((r) => {
    const snippet = buildSnippet(r.body || r.title, runs);
    return {
      type: r.type,
      id: r.docid,
      title: r.title || r.docid,
      date: r.date || undefined,
      snippetParts: snippet.parts,
      snippetText: snippet.text,
      score: r.score,
    };
  });
}

// ── 内部实现：混合检索（RRF） ────────────────────────────────────────────────

async function hybridHits(match: string, q: string, limit: number): Promise<SearchHit[]> {
  const conn = openDb();
  const runs = tokens(q);

  // rankA：FTS BM25 取 topN（spec §4.7 查询流程）
  const lexRows = conn
    .prepare(
      `SELECT type, docid, title, body, date, bm25(docs, 10.0, 1.0) AS score
       FROM docs WHERE docs MATCH ? ORDER BY score LIMIT ?`,
    )
    .all(match, RRF_TOPN) as Array<DocRow & { score: number }>;
  const rankA = new Map<string, number>();
  lexRows.forEach((r, i) => rankA.set(r.docid, i));

  // rankB：查询向量 → 已嵌向量暴力余弦，按 docid 取最优 chunk
  const qvec = (await embedFn(embConfig, [q]))[0];
  const semList = vectorRankDocids(conn, qvec, RRF_TOPN);
  const rankB = new Map<string, number>();
  semList.forEach((d, i) => rankB.set(d.docid, i));

  // RRF 融合：score = Σ 1/(k + rank)
  const lexById = new Map(lexRows.map((r) => [r.docid, r]));
  const semById = new Map(semList.map((d) => [d.docid, d]));
  const docids = new Set<string>([...rankA.keys(), ...rankB.keys()]);
  const fused = [...docids]
    .map((docid) => {
      let score = 0;
      if (rankA.has(docid)) score += 1 / (RRF_K + rankA.get(docid)!);
      if (rankB.has(docid)) score += 1 / (RRF_K + rankB.get(docid)!);
      return { docid, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const hits: SearchHit[] = [];
  for (const { docid, score } of fused) {
    const inA = rankA.has(docid);
    const inB = rankB.has(docid);
    const reason: MatchReason = inA && inB ? "both" : inA ? "lex" : "semantic";
    const row = lexById.get(docid) ?? getDocRow(conn, docid);
    if (!row) continue; // 索引滞后：docs 行已删

    let parts: SearchHit["snippetParts"];
    let text: string;
    if (reason === "semantic") {
      // 纯语义命中（字面无 query 词）：取命中 chunk 前 N 字，全 matched:false（§4.7 Finding 3）。
      const raw = (semById.get(docid)?.chunkText || row.body || "").replace(/\s+/g, " ").trim();
      text = raw.slice(0, SEM_SNIPPET);
      if (raw.length > SEM_SNIPPET) text += "…";
      parts = [{ text, matched: false }];
    } else {
      const snippet = buildSnippet(row.body || row.title, runs);
      parts = snippet.parts;
      text = snippet.text;
    }
    hits.push({
      type: row.type,
      id: docid,
      title: row.title || docid,
      date: row.date || undefined,
      snippetParts: parts,
      snippetText: text,
      score,
      matchReason: reason,
    });
  }
  return hits;
}

interface SemHit { docid: string; sim: number; chunkText: string; off: number; }

/** 对已嵌向量（dim 一致）暴力余弦，按 docid 取最优 chunk，降序返回 topN。 */
function vectorRankDocids(conn: Database.Database, qvec: number[], topN: number): SemHit[] {
  if (!embDim) return [];
  const rows = conn
    .prepare(
      `SELECT c.docid AS docid, c.text AS text, c.char_off AS off, v.vec AS vec
       FROM vectors v JOIN chunks c ON c.chunk_id = v.chunk_id WHERE v.dim = ?`,
    )
    .all(embDim) as Array<{ docid: string; text: string; off: number; vec: Buffer }>;
  if (rows.length === 0) return [];

  const qNorm = norm(qvec) || 1;
  const best = new Map<string, SemHit>();
  for (const r of rows) {
    const vec = blobToFloat32(r.vec);
    const sim = dot(qvec, vec) / (qNorm * (norm(vec) || 1));
    const cur = best.get(r.docid);
    if (!cur || sim > cur.sim) best.set(r.docid, { docid: r.docid, sim, chunkText: r.text, off: r.off });
  }
  return [...best.values()].sort((a, b) => b.sim - a.sim).slice(0, topN);
}

function getDocRow(conn: Database.Database, docid: string): DocRow | undefined {
  return conn
    .prepare("SELECT type, docid, title, body, date FROM docs WHERE docid = ?")
    .get(docid) as DocRow | undefined;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function norm(a: ArrayLike<number>): number {
  return Math.sqrt(dot(a, a));
}
function blobToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
function float32ToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

// ── 内部实现：分块与嵌入 ─────────────────────────────────────────────────────

/** CJK 感知（按字符窗口，CJK 单字本身即语义单元）切分，~400 字窗口 ~15% 重叠，记 char_off。 */
function chunkText(text: string): Array<{ text: string; off: number }> {
  if (!text) return [];
  const out: Array<{ text: string; off: number }> = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let i = 0; i < text.length; i += step) {
    const slice = text.slice(i, i + CHUNK_SIZE);
    if (slice.trim()) out.push({ text: slice, off: i });
    if (i + CHUNK_SIZE >= text.length) break;
  }
  return out;
}

function deleteChunksForDoc(conn: Database.Database, docid: string): void {
  conn.prepare("DELETE FROM vectors WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE docid = ?)").run(docid);
  conn.prepare("DELETE FROM chunks WHERE docid = ?").run(docid);
}

function rechunkDoc(conn: Database.Database, docid: string, type: string, body: string, mtime: number): void {
  deleteChunksForDoc(conn, docid);
  const ins = conn.prepare(
    "INSERT INTO chunks(docid, type, ord, text, char_off, file_mtime) VALUES (?,?,?,?,?,?)",
  );
  chunkText(body).forEach((c, i) => ins.run(docid, type, i, c.text, c.off, mtime));
}

/** 全量重分块（清空 chunks/vectors 后从 docs 表重建）。用于首次启用 / model 变化（§4.7）。 */
function rechunkAll(): void {
  if (!dataDir) return;
  const conn = openDb();
  if (!built) refreshNow();
  conn.exec("DELETE FROM vectors; DELETE FROM chunks;");
  const docs = conn.prepare("SELECT type, docid, body FROM docs").all() as Array<{ type: string; docid: string; body: string }>;
  const ins = conn.prepare(
    "INSERT INTO chunks(docid, type, ord, text, char_off, file_mtime) VALUES (?,?,?,?,?,?)",
  );
  const tx = conn.transaction(() => {
    for (const d of docs) chunkText(d.body || "").forEach((c, i) => ins.run(d.docid, d.type, i, c.text, c.off, 0));
  });
  tx();
}

function clearVectorsAndChunks(): void {
  if (!dataDir) return;
  try {
    const conn = openDb();
    conn.exec("DELETE FROM vectors; DELETE FROM chunks;");
  } catch { /* db 未建则无需清 */ }
}

function chunkCount(): number {
  if (!dataDir) return 0;
  const conn = openDb();
  return (conn.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
}

function embedCounts(): { done: number; total: number } {
  if (!dataDir || !db) return { done: 0, total: 0 };
  const total = (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  const done = (db.prepare("SELECT COUNT(*) AS n FROM vectors").get() as { n: number }).n;
  return { done, total };
}

function derivePhase(): EmbeddingPhase {
  const { done, total } = embedCounts();
  if (total === 0) return "ready";
  if (done >= total) return "ready";
  if (done > 0) return "partial";
  return "embedding";
}

/** 触发背景嵌入任务（幂等：已在跑则不重入）。 */
function kickEmbed(): void {
  if (!embConfig.enabled || embedRunning) return;
  setImmediate(() => { runEmbed().catch(() => { /* 已在 runEmbed 内置错 */ }); });
}

/** 背景分批限流嵌入未嵌的 chunk（带 model/dim 校验）。 */
async function runEmbed(): Promise<void> {
  if (embedRunning || !embConfig.enabled) return;
  embedRunning = true;
  const conn = openDb();
  const insVec = conn.prepare("INSERT OR REPLACE INTO vectors(chunk_id, dim, vec) VALUES (?,?,?)");
  try {
    while (embConfig.enabled) {
      const pending = conn
        .prepare(
          "SELECT chunk_id, text FROM chunks WHERE chunk_id NOT IN (SELECT chunk_id FROM vectors) ORDER BY chunk_id LIMIT ?",
        )
        .all(EMBED_BATCH) as Array<{ chunk_id: number; text: string }>;
      if (pending.length === 0) break;

      const vecs = await embedFn(embConfig, pending.map((p) => p.text));
      const dim = vecs[0].length;
      if (embDim === 0) {
        embDim = dim;
        embConfig.dim = dim;
        saveEmbeddingConfig();
      } else if (dim !== embDim) {
        throw new EmbeddingError("embedding dimension changed mid-run", 0);
      }

      const tx = conn.transaction(() => {
        pending.forEach((p, i) => insVec.run(p.chunk_id, dim, float32ToBlob(vecs[i])));
      });
      tx();

      embPhase = derivePhase(); // embedding / partial / ready（随 done/total 推进）
      await sleep(EMBED_PAUSE_MS);
    }
    if (embConfig.enabled) embPhase = derivePhase();
  } catch (e) {
    embPhase = "error";
    embError = e instanceof Error ? e.message : String(e);
  } finally {
    embedRunning = false;
  }
  // 期间可能新增 chunk（markStale）→ 仍有待嵌且未出错则再踢一轮
  if (embConfig.enabled && embPhase !== "error") {
    const { done, total } = embedCounts();
    if (done < total) kickEmbed();
  }
}

// ── 嵌入配置持久化（§4.7 安全契约） ─────────────────────────────────────────

function configPath(): string {
  return path.join(dataDir, ".config", "embedding.json");
}

function loadEmbeddingConfig(): void {
  let fileCfg: Partial<EmbeddingConfig> = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  } catch { /* 无配置文件 → 默认关 */ }

  const envEndpoint = process.env.PENTOU_EMBED_ENDPOINT;
  const envModel = process.env.PENTOU_EMBED_MODEL;
  const envKey = process.env.PENTOU_EMBED_API_KEY;
  keyFromEnv = !!envKey;

  embConfig = {
    enabled: fileCfg.enabled ?? false,
    endpoint: envEndpoint ?? fileCfg.endpoint ?? "",
    model: envModel ?? fileCfg.model ?? "",
    apiKey: envKey ?? fileCfg.apiKey ?? "",
    dim: fileCfg.dim,
  };
  embDim = fileCfg.dim ?? 0;
  embPhase = embConfig.enabled ? "configuring" : "disabled";
  embError = "";
}

function saveEmbeddingConfig(): void {
  if (!dataDir) return;
  const dir = path.join(dataDir, ".config");
  fs.mkdirSync(dir, { recursive: true });
  // endpoint/model/dim 非敏感始终写；apiKey 仅在非 env 来源且存在时写（§4.7 env 注入不落 key）。
  const body: Record<string, unknown> = {
    enabled: embConfig.enabled,
    endpoint: embConfig.endpoint,
    model: embConfig.model,
  };
  if (embDim) body.dim = embDim;
  if (!keyFromEnv && embConfig.apiKey) body.apiKey = embConfig.apiKey;
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(body, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* 某些 FS 不支持 */ }
}

function resetEmbeddingState(): void {
  embConfig = { enabled: false, endpoint: "", model: "", apiKey: "" };
  embPhase = "disabled";
  embError = "";
  embDim = 0;
  embedRunning = false;
  keyFromEnv = false;
  manualConfigApplied = false;
}

// ── 内部实现：DB / 扫描 / 解析 / 片段 ────────────────────────────────────────

function openDb(): Database.Database {
  if (db) return db;
  const dir = path.join(dataDir, ".qmd");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "index.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      rowref INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
      seg_title, seg_body,
      type UNINDEXED, docid UNINDEXED, title UNINDEXED, body UNINDEXED, date UNINDEXED,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id INTEGER PRIMARY KEY,
      docid TEXT NOT NULL,
      type TEXT NOT NULL,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL,
      char_off INTEGER NOT NULL,
      file_mtime INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_docid ON chunks(docid);
    CREATE TABLE IF NOT EXISTS vectors (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(chunk_id),
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );
  `);
  return db;
}

interface ScannedFile { path: string; docid: string; type: "conversation" | "document"; mtime: number; }

function scanFiles(): ScannedFile[] {
  const out: ScannedFile[] = [];
  const dirs: Array<[string, "conversation" | "document"]> = [
    [path.join(dataDir, "conversations"), "conversation"],
    [path.join(dataDir, "documents"), "document"],
  ];
  for (const [dir, type] of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      out.push({ path: full, docid: name.slice(0, -3), type, mtime: stat.mtimeMs });
    }
  }
  return out;
}

function pickMeta(meta: string, key: string): string {
  const m = meta.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
  return v === "null" ? "" : v;
}

/** 最小 .md 读取：取 title/date 与正文（剥离 frontmatter 与 `---` 分隔行）。 */
function readMd(raw: string, type: "conversation" | "document"): { title: string; date: string; body: string } {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let title = "";
  let date = "";
  let body = raw;
  if (fm) {
    const meta = fm[1];
    title = pickMeta(meta, "title");
    date = type === "conversation"
      ? pickMeta(meta, "date")
      : (pickMeta(meta, "updatedAt") || pickMeta(meta, "createdAt"));
    body = fm[2];
  }
  if (type === "conversation") {
    // 剥离 conversationToMd 写入的角色标题行（## User / ## <Platform>），仅留正文，让片段干净。
    // Platform 为固定枚举，此列表已全覆盖（data.tsx Platform）。
    body = body.replace(
      /^##\s+(user|ai|assistant|human|you|chatgpt|claude|deepseek|gemini|cli|cursor|copilot|codex)\s*$/gim,
      "",
    );
  }
  body = body.replace(/^---\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { title, date, body };
}

/**
 * 把查询拆成 FTS5 MATCH 表达式：
 * - 连续 CJK 词 → 单字短语 "检 索"（保证相邻），保中文 2 字词召回；
 * - 连续字母数字 → bareword；
 * - 多词以空格连接（FTS5 隐式 AND）。
 * 全空白 / 纯标点 → null（不进引擎）。
 */
function buildMatch(q: string): string | null {
  const parts: string[] = [];
  for (const m of q.matchAll(TOKEN_RE)) {
    const run = m[0];
    if (/[a-zA-Z0-9]/.test(run[0])) parts.push(run.toLowerCase());
    else parts.push(`"${run.split("").join(" ")}"`);
  }
  return parts.length ? parts.join(" ") : null;
}

const SNIPPET_WINDOW = 140;
const SNIPPET_LEAD = 40;

/**
 * 用查询词在原文上构建命中片段（spec §4.3 / 决策6）：
 * 不走 FTS5 snippet()/innerHTML，输出 {text,matched}[]，前端按 matched 加粗高亮。
 */
function buildSnippet(
  rawText: string,
  terms: string[],
): { parts: Array<{ text: string; matched: boolean }>; text: string } {
  const text = rawText.replace(/\s+/g, " ").trim();
  const lowerTerms = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const hay = text.toLowerCase();

  let first = -1;
  for (const t of lowerTerms) {
    const i = hay.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }

  if (first < 0) {
    const head = text.slice(0, SNIPPET_WINDOW);
    const parts = [{ text: head, matched: false }];
    if (text.length > SNIPPET_WINDOW) parts.push({ text: "…", matched: false });
    return { parts, text: parts.map((p) => p.text).join("") };
  }

  const start = Math.max(0, first - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_WINDOW);
  const slice = text.slice(start, end);

  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // 长词优先，避免短词抢先切断
  const parts: Array<{ text: string; matched: boolean }> = [];
  if (start > 0) parts.push({ text: "…", matched: false });

  if (escaped.length === 0) {
    parts.push({ text: slice, matched: false });
  } else {
    const re = new RegExp(`(${escaped.join("|")})`, "gi");
    let last = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(slice)) !== null) {
      if (mm.index > last) parts.push({ text: slice.slice(last, mm.index), matched: false });
      parts.push({ text: mm[0], matched: true });
      last = mm.index + mm[0].length;
      if (mm.index === re.lastIndex) re.lastIndex++;
    }
    if (last < slice.length) parts.push({ text: slice.slice(last), matched: false });
  }

  if (end < text.length) parts.push({ text: "…", matched: false });
  return { parts, text: parts.map((p) => p.text).join("") };
}

// ── 测试辅助 ─────────────────────────────────────────────────────────────────

/** 测试辅助：重置模块状态。 */
export function _resetForTest(): void {
  if (db) { try { db.close(); } catch { /* noop */ } }
  db = null;
  dataDir = "";
  built = false;
  building = false;
  stale = false;
  resetEmbeddingState();
  embedFn = providerEmbed;
}

/** 测试辅助：注入 embed 实现，避免真实网络。 */
export function _setEmbedFnForTest(fn: typeof providerEmbed): void {
  embedFn = fn;
}

/** 测试辅助：等待背景嵌入任务跑完（轮询 phase + 待嵌计数，规避 setImmediate 尚未起跑的竞态）。 */
export async function _waitEmbedIdleForTest(timeoutMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!embedRunning) {
      if (embPhase === "error" || embPhase === "disabled") return;
      const { done, total } = embedCounts();
      if (done >= total) return; // 全部已嵌（或无可嵌）
    }
    await sleep(10);
  }
}
