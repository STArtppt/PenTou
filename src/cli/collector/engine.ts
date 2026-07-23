import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  CollectorAdapter,
  CollectorConfig,
  CollectorCounts,
  CollectorFileError,
  FileSnapshot,
  IngestItem,
  IngestItemResult,
  PullSummary,
  SessionFile,
} from "./types.js";
import { IngestClient, isAuthIngestError, isRetryableIngestError } from "./ingest-client.js";
import { writeConfig } from "./config.js";
import { isVirtualKey, parseSessionKey } from "./sqlite.js";
import { EmptyPayloadError, parseRawConversations } from "../../shared/raw-dispatch.js";
import { shrinkConversation } from "./shrink.js";

const INGEST_MAX_BODY_BYTES = 10 * 1024 * 1024;
const INGEST_BODY_OVERHEAD_BYTES = 4096;

export interface EngineLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const DEFAULT_LOGGER: EngineLogger = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

export function emptyCounts(): CollectorCounts {
  return { created: 0, merged: 0, skipped: 0, error: 0 };
}

export function addResultCounts(counts: CollectorCounts, results: IngestItemResult[]): void {
  for (const result of results) {
    if (result.error) {
      counts.error += 1;
      continue;
    }
    if (result.skippedReason) counts.skipped += 1;
    for (const conversation of result.conversations) {
      if (conversation.action === "created") counts.created += 1;
      else if (conversation.action === "merged") counts.merged += 1;
      else if (conversation.action === "skipped") counts.skipped += 1;
    }
  }
}

export async function snapshotFile(file: string): Promise<FileSnapshot | null> {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return null;
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function snapshotChanged(previous: FileSnapshot | undefined, next: FileSnapshot | null): boolean {
  if (!next) return false;
  return !previous || previous.mtimeMs !== next.mtimeMs || previous.size !== next.size;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePattern(pattern: string, homeDir: string): string {
  let out = pattern.trim().split(path.sep).join("/");
  if (out === "~") out = homeDir;
  else if (out.startsWith("~/")) out = `${homeDir}/${out.slice(2)}`;
  out = out.replace(/\/+/g, "/");
  if (out.startsWith("/")) return out;
  if (!out.includes("/")) {
    if (!out.includes("*")) return `**/${out}/**`;
    return `**/${out}`;
  }
  return `**/${out}`;
}

function globToRegExp(pattern: string, homeDir: string): RegExp {
  const normalized = normalizePattern(pattern, homeDir);
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (ch === "*") {
      out += "[^/]*";
    } else {
      out += escapeRegex(ch);
    }
  }
  out += "$";
  return new RegExp(out);
}

export function createExcludeMatcher(patterns: string[], homeDir = process.env.HOME || ""): (file: string) => string | null {
  const normalizedHome = homeDir.split(path.sep).join("/");
  const compiled = patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => ({ pattern, re: globToRegExp(pattern, normalizedHome) }));
  return (file: string) => {
    const normalized = path.resolve(file).split(path.sep).join("/");
    for (const item of compiled) {
      if (item.re.test(normalized)) return item.pattern;
    }
    return null;
  };
}

export function backoffDelay(attempt: number, maxMs = 300_000): number {
  const base = 1_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(base, maxMs);
}

/** 查询型虚拟键按其 db 路径参与 watchRoots 前缀匹配 */
function adapterForFile(adapters: CollectorAdapter[], file: string): CollectorAdapter | null {
  const normalized = path.resolve(isVirtualKey(file) ? parseSessionKey(file)?.dbPath ?? file : file);
  let best: { adapter: CollectorAdapter; rootLength: number } | null = null;
  for (const adapter of adapters) {
    for (const root of adapter.watchRoots()) {
      const resolvedRoot = path.resolve(root);
      if (normalized === resolvedRoot || normalized.startsWith(resolvedRoot + path.sep)) {
        if (!best || resolvedRoot.length > best.rootLength) best = { adapter, rootLength: resolvedRoot.length };
      }
    }
  }
  return best?.adapter ?? null;
}

function uniqueFiles(files: SessionFile[]): SessionFile[] {
  const seen = new Set<string>();
  const out: SessionFile[] = [];
  for (const file of files) {
    const resolved = isVirtualKey(file.path) ? file.path : path.resolve(file.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ ...file, path: resolved });
  }
  return out;
}

/** 单 adapter 的 discover 失败（如 db 被锁）只隔离该源，不影响其余（spec §5 异常 1） */
export async function discoverAll(
  adapters: CollectorAdapter[],
  onError?: (platform: string, message: string) => void,
): Promise<SessionFile[]> {
  const all: SessionFile[] = [];
  for (const adapter of adapters) {
    try {
      all.push(...await adapter.discover());
    } catch (error: any) {
      onError?.(adapter.platform, error?.message ?? String(error));
    }
  }
  return uniqueFiles(all).sort((a, b) => a.path.localeCompare(b.path));
}

interface PreparedItem {
  file: string;
  item: IngestItem;
  snapshot: FileSnapshot;
}

function estimateIngestBodyBytes(items: IngestItem[]): number {
  return Buffer.byteLength(JSON.stringify({ source: "cli", items }), "utf-8");
}

function itemTooLarge(item: IngestItem): boolean {
  return estimateIngestBodyBytes([item]) > INGEST_MAX_BODY_BYTES;
}

function canAppendToBatch(batch: PreparedItem[], item: PreparedItem): boolean {
  if (batch.length >= 50) return false;
  return estimateIngestBodyBytes([...batch, item].map((entry) => entry.item)) <= INGEST_MAX_BODY_BYTES - INGEST_BODY_OVERHEAD_BYTES;
}

// 单 item 预算：可单独成批发送；再留 1KB 给 item 信封（platform/externalId/format 等字段）
const SHRINK_BUDGET_BYTES = INGEST_MAX_BODY_BYTES - INGEST_BODY_OVERHEAD_BYTES - 1024;

export interface DegradeResult {
  entries: PreparedItem[];
  /** 被瘦身（有信息损失）上报的会话数 */
  truncated: number;
  /** 瘦身后仍超预算的会话（理论不可达，spec §5 异常 2） */
  oversizeErrors: string[];
}

/**
 * 超限降级（spec collector-oversize-ingest US-01）：raw 超限 item 本地解析为
 * conversation item(s)。与服务端共用 raw 两级派发；解析失败以 Error 抛出。
 * externalId 仅单会话结果保留（多会话时 index 不稳定，挂 externalKey 有错配
 * 覆盖风险，与服务端 raw 多会话行为对齐，§4.5 决策 3）。
 */
export function degradeOversizeItem(entry: PreparedItem): DegradeResult {
  if (entry.item.format !== "raw" || typeof entry.item.data !== "string") {
    throw new Error("oversize item is not raw");
  }
  const conversations = parseRawConversations(entry.item.platform, entry.item.data, entry.item.filename);
  const result: DegradeResult = { entries: [], truncated: 0, oversizeErrors: [] };
  for (const conversation of conversations) {
    const item: IngestItem = {
      platform: entry.item.platform,
      ...(conversations.length === 1 && entry.item.externalId ? { externalId: entry.item.externalId } : {}),
      format: "conversation",
      data: conversation,
    };
    if (itemTooLarge(item)) {
      const shrunk = shrinkConversation(conversation, SHRINK_BUDGET_BYTES);
      item.data = shrunk.conversation;
      if (itemTooLarge(item)) {
        result.oversizeErrors.push("conversation exceeds ingest limit after shrink");
        continue;
      }
      result.truncated += 1;
    }
    result.entries.push({ file: entry.file, item, snapshot: entry.snapshot });
  }
  return result;
}

async function prepareItems(
  files: SessionFile[],
  adapters: CollectorAdapter[],
  exclude: (file: string) => string | null,
  options: { onlyChanged: boolean; snapshots: Record<string, FileSnapshot>; verbose?: boolean; logger?: EngineLogger },
): Promise<{ items: PreparedItem[]; skippedByExclude: number; errors: CollectorFileError[] }> {
  const items: PreparedItem[] = [];
  const errors: CollectorFileError[] = [];
  let skippedByExclude = 0;
  const logger = options.logger ?? DEFAULT_LOGGER;

  for (const file of files) {
    // exclude 是文件路径黑名单；查询型虚拟键无路径语义，不参与（spec §4.3）
    const excludedBy = isVirtualKey(file.path) ? null : exclude(file.path);
    if (excludedBy) {
      skippedByExclude += 1;
      if (options.verbose) logger.log(`skip ${file.path} (exclude: ${excludedBy})`);
      continue;
    }
    // discover 产物自带 platform，优先精确匹配；watch 事件路径回退前缀匹配
    const adapter = adapters.find((a) => a.platform === file.platform) ?? adapterForFile(adapters, file.path);
    if (!adapter) continue;
    try {
      const nextSnapshot = adapter.snapshot ? await adapter.snapshot(file.path) : await snapshotFile(file.path);
      if (!snapshotChanged(options.onlyChanged ? options.snapshots[file.path] : undefined, nextSnapshot)) continue;
      if (!nextSnapshot) continue;
      const item = await adapter.toItem(file.path);
      if (!item) continue;
      items.push({ file: file.path, item, snapshot: nextSnapshot });
    } catch (error: any) {
      errors.push({ file: file.path, error: error?.message ?? String(error) });
    }
  }

  return { items, skippedByExclude, errors };
}

export interface PullOptions {
  dryRun?: boolean;
  adapterName?: string;
  verbose?: boolean;
  configPath?: string;
  client?: IngestClient;
  logger?: EngineLogger;
}

export async function pullOnce(
  config: CollectorConfig,
  adapters: CollectorAdapter[],
  options: PullOptions = {},
): Promise<PullSummary> {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const selectedAdapters = options.adapterName
    ? adapters.filter((adapter) => adapter.platform === options.adapterName)
    : adapters;
  if (options.adapterName && selectedAdapters.length === 0) {
    throw new Error(`unknown or disabled adapter: ${options.adapterName}`);
  }

  const discoverErrors: CollectorFileError[] = [];
  const files = await discoverAll(selectedAdapters, (platform, message) =>
    discoverErrors.push({ file: `adapter:${platform}`, error: message }),
  );
  const exclude = createExcludeMatcher(config.exclude);
  const prepared = await prepareItems(files, selectedAdapters, exclude, {
    onlyChanged: false,
    snapshots: config.snapshots,
    verbose: options.verbose,
    logger,
  });
  prepared.errors.unshift(...discoverErrors);

  const summary: PullSummary = {
    scanned: files.length,
    sent: 0,
    skippedByExclude: prepared.skippedByExclude,
    truncated: 0,
    counts: emptyCounts(),
    errors: [...prepared.errors],
  };
  summary.counts.error += prepared.errors.length;

  if (options.dryRun) {
    for (const item of prepared.items) {
      logger.log(itemTooLarge(item.item) ? `${item.file} (oversize: local parse fallback)` : item.file);
    }
    return summary;
  }

  // ── 超限降级（spec collector-oversize-ingest US-01）────────────────────────
  const sendItems: PreparedItem[] = [];
  for (const entry of prepared.items) {
    if (!itemTooLarge(entry.item)) {
      sendItems.push(entry);
      continue;
    }
    try {
      const degraded = degradeOversizeItem(entry);
      summary.truncated += degraded.truncated;
      for (const error of degraded.oversizeErrors) {
        summary.errors.push({ file: entry.file, error });
        summary.counts.error += 1;
      }
      if (options.verbose) {
        const shrunk = degraded.truncated ? `, ${degraded.truncated} shrunk` : "";
        logger.log(`oversize ${entry.file}: local parse -> ${degraded.entries.length} conversation(s)${shrunk}`);
      }
      sendItems.push(...degraded.entries);
    } catch (error: any) {
      if (error instanceof EmptyPayloadError) {
        // 空会话不算失败：计 skipped 并推进快照（与服务端 skippedReason 语义一致）
        summary.counts.skipped += 1;
        config.snapshots[entry.file] = entry.snapshot;
        if (options.verbose) logger.log(`skip ${entry.file} (empty session)`);
        continue;
      }
      summary.errors.push({ file: entry.file, error: error?.message ?? String(error) });
      summary.counts.error += 1;
    }
  }

  const client = options.client ?? new IngestClient({ server: config.server, token: config.token });
  // 降级后同一文件可对应多个 item：全部成功才推进快照，避免部分失败被误标已同步
  const pendingByFile = new Map<string, number>();
  for (const entry of sendItems) pendingByFile.set(entry.file, (pendingByFile.get(entry.file) ?? 0) + 1);
  const failedFiles = new Set<string>();
  const unsent: PreparedItem[] = [];
  let batch: PreparedItem[] = [];
  const sendBatch = async (current: PreparedItem[]): Promise<boolean> => {
    if (current.length === 0) return true;
    try {
      summary.sent += current.length;
      const response = await client.ingest(current.map((entry) => entry.item));
      addResultCounts(summary.counts, response.results);
      for (const result of response.results) {
        const entry = current[result.itemIndex];
        if (result.error) {
          summary.errors.push({ file: entry?.file ?? "(unknown)", error: result.error });
          if (entry) failedFiles.add(entry.file);
        } else if (entry) {
          const left = (pendingByFile.get(entry.file) ?? 1) - 1;
          pendingByFile.set(entry.file, left);
          if (left <= 0 && !failedFiles.has(entry.file)) config.snapshots[entry.file] = entry.snapshot;
        }
      }
      return true;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      for (const entry of current) {
        summary.errors.push({ file: entry.file, error: message });
        failedFiles.add(entry.file);
      }
      summary.counts.error += current.length;
      if (isAuthIngestError(error)) {
        return false;
      }
      return true;
    }
  };

  for (let index = 0; index < sendItems.length; index++) {
    const entry = sendItems[index];
    if (!canAppendToBatch(batch, entry)) {
      const ok = await sendBatch(batch);
      if (!ok) {
        unsent.push(entry, ...sendItems.slice(index + 1));
        batch = [];
        break;
      }
      batch = [];
    }
    batch.push(entry);
  }
  if (batch.length) {
    const ok = await sendBatch(batch);
    if (!ok) {
      const sentOrErrored = new Set(summary.errors.map((error) => error.file));
      for (const entry of sendItems) {
        if (!sentOrErrored.has(entry.file) && !config.snapshots[entry.file]) unsent.push(entry);
      }
    }
  }
  const unsentFiles = new Set<string>();
  for (const entry of unsent) {
    if (unsentFiles.has(entry.file)) continue;
    unsentFiles.add(entry.file);
    summary.errors.push({ file: entry.file, error: "not sent after auth failure" });
    summary.counts.error += 1;
  }

  if (options.configPath) writeConfig(config, options.configPath);
  return summary;
}

export interface WatchOptions {
  verbose?: boolean;
  configPath?: string;
  client?: IngestClient;
  logger?: EngineLogger;
}

interface QueueEntry {
  file: string;
  adapter: CollectorAdapter;
}

export class CollectorWatchEngine {
  private config: CollectorConfig;
  private adapters: CollectorAdapter[];
  private client: IngestClient;
  private logger: EngineLogger;
  private configPath?: string;
  private verbose: boolean;
  private exclude: (file: string) => string | null;
  private timers = new Map<string, NodeJS.Timeout>();
  private watchers: fs.FSWatcher[] = [];
  private queue = new Map<string, QueueEntry>();
  private retryTimer: NodeJS.Timeout | null = null;
  private retryAttempt = 0;
  private retryState = "";

  constructor(config: CollectorConfig, adapters: CollectorAdapter[], options: WatchOptions = {}) {
    this.config = config;
    this.adapters = adapters;
    this.client = options.client ?? new IngestClient({ server: config.server, token: config.token });
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.configPath = options.configPath;
    this.verbose = options.verbose ?? false;
    this.exclude = createExcludeMatcher(config.exclude);
  }

  async start(): Promise<void> {
    await this.backfill();
    for (const adapter of this.adapters) {
      for (const root of adapter.watchRoots()) {
        this.watchRoot(root);
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  async backfill(): Promise<void> {
    await this.syncAdapters(this.adapters);
  }

  /** 差量同步一组 adapter：discover → 快照对比 → 逐条上报（backfill 与查询型 watch 共用） */
  private async syncAdapters(adapters: CollectorAdapter[]): Promise<void> {
    const files = await discoverAll(adapters, (platform, message) =>
      this.logger.warn(`discover failed ${platform}: ${message}`),
    );
    const prepared = await prepareItems(files, adapters, this.exclude, {
      onlyChanged: true,
      snapshots: this.config.snapshots,
      verbose: this.verbose,
      logger: this.logger,
    });
    for (const error of prepared.errors) this.logger.warn(`read failed ${error.file}: ${error.error}`);
    for (const entry of prepared.items) {
      await this.sendPrepared(entry);
    }
  }

  schedule(file: string): void {
    const resolved = path.resolve(file);
    const adapter = adapterForFile(this.adapters, resolved);
    if (!adapter) return;
    // 查询型：db/-wal 的任意写入事件聚合为一次该源的差量拉取（spec US-03 AC2）
    if (adapter.kind === "query") {
      this.scheduleTimer(`query:${adapter.platform}`, () =>
        this.syncAdapters([adapter]).catch((error) => this.logger.error(error?.message ?? String(error))),
      );
      return;
    }
    const excludedBy = this.exclude(resolved);
    if (excludedBy) {
      if (this.verbose) this.logger.log(`skip ${resolved} (exclude: ${excludedBy})`);
      return;
    }
    this.scheduleTimer(resolved, () =>
      this.sendFile(resolved, adapter).catch((error) => this.logger.error(error?.message ?? String(error))),
    );
  }

  private scheduleTimer(key: string, fire: () => void): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      fire();
    }, this.config.debounceMs));
  }

  private watchRoot(root: string): void {
    if (!fs.existsSync(root)) {
      if (this.verbose) this.logger.log(`watch root not found: ${root}`);
      return;
    }
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        this.schedule(path.join(root, filename.toString()));
      });
      this.watchers.push(watcher);
      if (this.verbose) this.logger.log(`watching ${root}`);
    } catch (error: any) {
      this.logger.warn(`watch failed ${root}: ${error?.message ?? error}`);
    }
  }

  private async sendFile(file: string, adapter: CollectorAdapter): Promise<boolean> {
    const snapshot = adapter.snapshot ? await adapter.snapshot(file) : await snapshotFile(file);
    if (!snapshot) return true;
    const item = await adapter.toItem(file);
    if (!item) return true;
    return await this.sendPrepared({ file, item, snapshot });
  }

  private async sendPrepared(entry: PreparedItem): Promise<boolean> {
    // 超限降级（spec collector-oversize-ingest US-01；与 pullOnce 同一降级器）
    let entries: PreparedItem[] = [entry];
    let degradeError = false;
    if (itemTooLarge(entry.item)) {
      try {
        const degraded = degradeOversizeItem(entry);
        for (const error of degraded.oversizeErrors) this.logger.warn(`ingest error ${entry.file}: ${error}`);
        if (this.verbose) {
          const shrunk = degraded.truncated ? `, ${degraded.truncated} shrunk` : "";
          this.logger.log(`oversize ${entry.file}: local parse -> ${degraded.entries.length} conversation(s)${shrunk}`);
        }
        entries = degraded.entries;
        degradeError = degraded.oversizeErrors.length > 0;
        if (entries.length === 0) return true;
      } catch (error: any) {
        if (error instanceof EmptyPayloadError) {
          this.config.snapshots[entry.file] = entry.snapshot;
          this.persistConfig();
          if (this.verbose) this.logger.log(`skip ${entry.file} (empty session)`);
          return true;
        }
        this.logger.warn(`local parse failed ${entry.file}: ${error?.message ?? error}`);
        return true;
      }
    }
    try {
      let anyError = degradeError;
      for (const one of entries) {
        const response = await this.client.ingest([one.item]);
        const result = response.results[0];
        if (result?.error) {
          this.logger.warn(`ingest error ${one.file}: ${result.error}`);
          anyError = true;
        }
      }
      // 任一会话失败则不推进快照，下次变化整文件重试（服务端 merge/skip 幂等）
      if (anyError) return true;
      this.config.snapshots[entry.file] = entry.snapshot;
      this.persistConfig();
      if (this.verbose) this.logger.log(`synced ${entry.file}`);
      return true;
    } catch (error: any) {
      if (isAuthIngestError(error)) {
        this.logger.error(`ingest auth failed (401). Check token in Settings -> Collector: ${error.message}`);
        return false;
      }
      const adapter = adapterForFile(this.adapters, entry.file);
      if (!adapter) {
        this.logger.error(`ingest retry skipped ${entry.file}: no adapter found`);
        return true;
      }
      if (isRetryableIngestError(error)) {
        this.queue.set(entry.file, {
          file: entry.file,
          adapter,
        });
        this.scheduleRetry();
        return false;
      }
      this.logger.error(`ingest failed ${entry.file}: ${error?.message ?? error}`);
      return true;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = backoffDelay(this.retryAttempt);
    const state = `${this.queue.size}:${delay}`;
    if (state !== this.retryState) {
      this.retryState = state;
      this.logger.warn(`collector retry queued=${this.queue.size}, next=${Math.round(delay / 1000)}s`);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushQueue().catch((error) => this.logger.error(error?.message ?? String(error)));
    }, delay);
  }

  private async flushQueue(): Promise<void> {
    const entries = [...this.queue.values()];
    if (entries.length === 0) {
      this.retryAttempt = 0;
      return;
    }
    for (const queued of entries) {
      try {
        const ok = await this.sendFile(queued.file, queued.adapter);
        if (ok) this.queue.delete(queued.file);
      } catch {
        this.logger.error(`retry failed ${queued.file}`);
      }
    }
    if (this.queue.size === 0) {
      this.retryAttempt = 0;
      this.retryState = "";
      this.logger.log("collector retry queue flushed");
    } else {
      this.scheduleRetry();
    }
  }

  private persistConfig(): void {
    if (this.configPath) writeConfig(this.config, this.configPath);
  }
}
