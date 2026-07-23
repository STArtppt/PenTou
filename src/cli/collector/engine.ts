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
    counts: emptyCounts(),
    errors: [...prepared.errors],
  };
  summary.counts.error += prepared.errors.length;

  if (options.dryRun) {
    for (const item of prepared.items) logger.log(item.file);
    return summary;
  }

  const client = options.client ?? new IngestClient({ server: config.server, token: config.token });
  const unsent: PreparedItem[] = [];
  let batch: PreparedItem[] = [];
  const sendBatch = async (current: PreparedItem[]): Promise<boolean> => {
    if (current.length === 0) return true;
    try {
      summary.sent += current.length;
      const response = await client.ingest(current.map((entry) => entry.item));
      addResultCounts(summary.counts, response.results);
      for (const result of response.results) {
        const file = current[result.itemIndex]?.file ?? "(unknown)";
        if (result.error) summary.errors.push({ file, error: result.error });
        else if (current[result.itemIndex]) config.snapshots[file] = current[result.itemIndex].snapshot;
      }
      return true;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      for (const entry of current) summary.errors.push({ file: entry.file, error: message });
      summary.counts.error += current.length;
      if (isAuthIngestError(error)) {
        return false;
      }
      return true;
    }
  };

  for (let index = 0; index < prepared.items.length; index++) {
    const entry = prepared.items[index];
    if (itemTooLarge(entry.item)) {
      summary.errors.push({ file: entry.file, error: "file exceeds ingest 10MB limit" });
      summary.counts.error += 1;
      continue;
    }
    if (!canAppendToBatch(batch, entry)) {
      const ok = await sendBatch(batch);
      if (!ok) {
        unsent.push(entry, ...prepared.items.slice(index + 1));
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
      for (const entry of prepared.items) {
        if (!sentOrErrored.has(entry.file) && !config.snapshots[entry.file]) unsent.push(entry);
      }
    }
  }
  for (const entry of unsent) {
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
    try {
      const response = await this.client.ingest([entry.item]);
      const result = response.results[0];
      if (result?.error) {
        this.logger.warn(`ingest error ${entry.file}: ${result.error}`);
        return true;
      }
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
