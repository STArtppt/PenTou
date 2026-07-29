/**
 * push.ts —— `pentou push docs <目录>`：一次性全量推送（spec collector-docs-push §push docs 一次性命令）。
 *
 * 与 docs adapter 的差异只在外壳：adapter 走引擎（差量快照 + 持久化配置），
 * 本命令**不读写快照、不写配置**——幂等交给服务端的 externalKey（design 决策 11）。
 * 扫描 / 标题 / externalId / 项目映射规则全部来自 docs-scan，两条入口共用一份实现。
 */
import path from "node:path";
import { CONFIG_PATH, normalizeServer, readConfig, resolveUserPath } from "./config.js";
import { createExcludeMatcher, emptyCounts, snapshotFile } from "./engine.js";
import { IngestClient, describeIngestError } from "./ingest-client.js";
import {
  discoverDocs,
  resolveDocsEntry,
  toDocumentItem,
  type DocsDirEntry,
} from "./adapters/docs-scan.js";
import { resolveProjectKey } from "./project-key.js";
import type { CollectorCounts, IngestItem } from "./types.js";

const HELP = `Pentou Push

Usage:
  pentou push docs <dir> [--project <name>] [--server <url>] [--token <token>]
                         [--dry-run] [--verbose] [--config <path>]

Pushes every .md under <dir> to Pentou's document plane in one shot.
Writes no collector config and keeps no snapshot — re-running is safe
(the server dedupes by external key).

Options:
  --project <name>   Project key. Defaults to the git repository root name; if <dir>
                     is not in a git repo you are asked, and Enter takes the directory name
  --server <url>     Pentou URL, default: from the collector config
  --token <token>    Ingest token, default: from the collector config
  --dry-run          List the files and their target project without uploading
  --verbose          Print excluded paths
  --config <path>    Collector config path, default ~/.pentou/collector.json
  --help, -h         Show this help
`;

const BOOLEAN_FLAGS = new Set(["--dry-run", "--verbose", "--help", "-h"]);
const VALUE_FLAGS = new Set(["--project", "--server", "--token", "--config"]);

const INGEST_MAX_BODY_BYTES = 10 * 1024 * 1024;
const INGEST_BODY_OVERHEAD_BYTES = 4096;
const INGEST_MAX_ITEMS = 50;

export interface PushArgs {
  flags: Record<string, string | boolean>;
  rest: string[];
}

export function parsePushArgs(argv: string[]): PushArgs {
  const flags: PushArgs["flags"] = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      rest.push(arg);
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      flags[arg] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith("-")) throw new Error(`missing value for ${arg}`);
    flags[arg] = value;
  }
  return { flags, rest };
}

function flagString(flags: PushArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export interface PushCredentials {
  server: string;
  token: string;
}

export const MISSING_CREDENTIALS_HINT =
  'no Pentou server/token available. Run "pentou collect init --server <url> --token <token>" first, ' +
  "or pass --server/--token explicitly. The ingest token lives in Settings -> Collector.";

/** `--server` / `--token` 缺省回落采集器配置文件；都取不到则以可行动提示失败。 */
export function resolvePushCredentials(
  flags: PushArgs["flags"],
  readConfigImpl: (file: string) => { server: string; token: string } = readConfig,
): PushCredentials {
  let server = flagString(flags, "--server");
  let token = flagString(flags, "--token");
  if (!server || !token) {
    try {
      const cfg = readConfigImpl(flagString(flags, "--config") || CONFIG_PATH);
      server = server || cfg.server;
      token = token || cfg.token;
    } catch {
      // 配置缺失/损坏都归到同一条可行动提示，不要抛原始 IO 错误吓用户
    }
  }
  if (!server || !token) throw new Error(MISSING_CREDENTIALS_HINT);
  return { server: normalizeServer(server), token };
}

export interface PushSummary {
  scanned: number;
  sent: number;
  excluded: number;
  counts: CollectorCounts;
  errors: Array<{ file: string; error: string }>;
}

export interface PushDocsOptions {
  dir: string;
  project?: string;
  exclude?: string[];
  dryRun?: boolean;
  verbose?: boolean;
  client?: IngestClient;
  logger?: { log(message: string): void; warn(message: string): void };
}

function estimateBytes(items: IngestItem[]): number {
  return Buffer.byteLength(JSON.stringify({ source: "cli", items }), "utf-8");
}

export async function pushDocs(options: PushDocsOptions): Promise<PushSummary> {
  const logger = options.logger ?? console;
  const entry: DocsDirEntry = {
    path: options.dir,
    ...(options.project ? { project: options.project } : {}),
  };
  const { root, projectKey } = resolveDocsEntry(entry);
  const files = await discoverDocs([entry]);
  const exclude = createExcludeMatcher(options.exclude ?? []);

  const summary: PushSummary = { scanned: files.length, sent: 0, excluded: 0, counts: emptyCounts(), errors: [] };
  const prepared: Array<{ file: string; item: IngestItem }> = [];

  for (const file of files) {
    const excludedBy = exclude(file.path);
    if (excludedBy) {
      summary.excluded += 1;
      if (options.verbose) logger.log(`skip ${file.path} (exclude: ${excludedBy})`);
      continue;
    }
    try {
      const item = await toDocumentItem(file.path, entry);
      if (!item) continue;
      // 文档超限直接失败，绝不截断上报（design 决策 12）
      if (estimateBytes([item]) > INGEST_MAX_BODY_BYTES) {
        const stat = await snapshotFile(file.path);
        summary.errors.push({
          file: file.path,
          error: `document exceeds the 10MB ingest limit (${stat ? Math.round(stat.size / 1024 / 1024) : "?"}MB); not truncated`,
        });
        summary.counts.error += 1;
        continue;
      }
      prepared.push({ file: file.path, item });
    } catch (error: any) {
      summary.errors.push({ file: file.path, error: error?.message ?? String(error) });
      summary.counts.error += 1;
    }
  }

  if (options.dryRun) {
    for (const item of prepared) {
      logger.log(`${path.relative(root, item.file) || path.basename(item.file)} -> project "${projectKey}"`);
    }
    return summary;
  }

  const client = options.client ?? null;
  if (!client) throw new Error("push client is required");

  // 批量分包与 pullOnce 同口径：50 items / 10MB 上限，留出信封余量
  let batch: Array<{ file: string; item: IngestItem }> = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    summary.sent += current.length;
    try {
      const response = await client.ingest(current.map((one) => one.item));
      for (const result of response.results) {
        const owner = current[result.itemIndex];
        if (result.error) {
          summary.errors.push({ file: owner?.file ?? "(unknown)", error: result.error });
          summary.counts.error += 1;
          continue;
        }
        if (result.skippedReason) summary.counts.skipped += 1;
        for (const doc of result.documents ?? []) {
          if (doc.action === "created") summary.counts.created += 1;
          else if (doc.action === "merged") summary.counts.merged += 1;
          else summary.counts.skipped += 1;
        }
      }
    } catch (error: any) {
      const message = describeIngestError(error);
      for (const one of current) {
        summary.errors.push({ file: one.file, error: message });
        summary.counts.error += 1;
      }
    }
  };

  for (const one of prepared) {
    const next = [...batch, one];
    if (batch.length >= INGEST_MAX_ITEMS
      || estimateBytes(next.map((x) => x.item)) > INGEST_MAX_BODY_BYTES - INGEST_BODY_OVERHEAD_BYTES) {
      await flush();
    }
    batch.push(one);
  }
  await flush();

  return summary;
}

export async function runPushCommand(argv: string[]): Promise<void> {
  const target = argv[0];
  if (!target || target === "--help" || target === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (target !== "docs") throw new Error(`unknown push target: ${target}`);

  const parsed = parsePushArgs(argv.slice(1));
  if (parsed.flags["--help"] || parsed.flags["-h"]) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.rest.length === 0) throw new Error("push docs requires a directory: pentou push docs <dir>");
  if (parsed.rest.length > 1) throw new Error(`unknown positional arguments: ${parsed.rest.slice(1).join(" ")}`);

  const dir = resolveUserPath(parsed.rest[0]);
  const dryRun = parsed.flags["--dry-run"] === true;
  // 项目 key 在推送这一刻解析一次（git 根目录名 > 手动输入 > 目录名），
  // 与 `collect init --docs-dir` 同一套规则
  const project = await resolveProjectKey(dir, {
    explicit: flagString(parsed.flags, "--project"),
    log: (message) => console.log(message),
  });

  // 沿用配置里的 exclude；配置不可用时不影响 --dry-run 与显式凭据的推送
  let exclude: string[] = [];
  try {
    exclude = readConfig(flagString(parsed.flags, "--config") || CONFIG_PATH).exclude;
  } catch {
    exclude = [];
  }

  let client: IngestClient | undefined;
  if (!dryRun) {
    const credentials = resolvePushCredentials(parsed.flags);
    client = new IngestClient(credentials);
  }

  const summary = await pushDocs({
    dir,
    project,
    exclude,
    dryRun,
    verbose: parsed.flags["--verbose"] === true,
    client,
  });

  console.log(`scanned=${summary.scanned} sent=${summary.sent} excluded=${summary.excluded}`);
  if (!dryRun) {
    console.log(`created=${summary.counts.created} merged=${summary.counts.merged} skipped=${summary.counts.skipped} error=${summary.counts.error}`);
  }
  if (summary.errors.length) {
    for (const error of summary.errors) console.error(`  ${error.file}: ${error.error}`);
    process.exitCode = 1;
  }
}
