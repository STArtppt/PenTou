import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defaultConfig, normalizeServer, readConfig, resolveUserPath, writeConfig, CONFIG_PATH } from "./config.js";
import { createAdapters } from "./adapters/index.js";
import { IngestClient } from "./ingest-client.js";
import { CollectorWatchEngine, pullOnce } from "./engine.js";
import type { CollectorConfig } from "./types.js";

const HELP = `Pentou Collector

Usage:
  pentou collect init [--server <url>] [--token <token>] [--waylog-dir <path>] [--exclude <glob>]
  pentou collect pull [--dry-run] [--adapter <name>] [--verbose]
  pentou collect watch [--verbose]

Options:
  --server <url>       Pentou URL, default http://localhost:5173
  --token <token>      Ingest token from Settings -> Collector
  --claude-root <path> Claude Code projects root, default ~/.claude/projects
  --waylog-dir <path>  Register a .waylog directory or its parent project directory (repeatable)
  --exclude <glob>     Exclude path pattern (repeatable)
  --debounce-ms <n>    Watch debounce window, default 15000
  --adapter <name>     Limit pull to one adapter: claude-code, waylog, codex,
                       grok-cli, copilot, copilot-vscode, opencode, hermes, cursor
  --dry-run            List files without uploading
  --config <path>      Collector config path, default ~/.pentou/collector.json
  --verbose            Print skipped paths and watch roots
  --help, -h           Show this help
`;

interface ParsedArgs {
  flags: Record<string, string | boolean | string[]>;
  rest: string[];
}

const COMMON_VALUE_FLAGS = new Set(["--config"]);
const COMMAND_FLAGS: Record<string, { boolean: Set<string>; value: Set<string>; repeatable: Set<string> }> = {
  init: {
    boolean: new Set(["--help", "-h"]),
    value: new Set(["--server", "--token", "--claude-root", "--debounce-ms", ...COMMON_VALUE_FLAGS]),
    repeatable: new Set(["--waylog-dir", "--exclude"]),
  },
  pull: {
    boolean: new Set(["--dry-run", "--verbose", "--help", "-h"]),
    value: new Set(["--adapter", ...COMMON_VALUE_FLAGS]),
    repeatable: new Set(),
  },
  watch: {
    boolean: new Set(["--verbose", "--help", "-h"]),
    value: new Set(COMMON_VALUE_FLAGS),
    repeatable: new Set(),
  },
};

function parse(command: string, argv: string[]): ParsedArgs {
  const spec = COMMAND_FLAGS[command];
  if (!spec) throw new Error(`unknown collect command: ${command}`);
  const flags: ParsedArgs["flags"] = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      rest.push(arg);
      continue;
    }
    if (spec.boolean.has(arg)) {
      flags[arg] = true;
      continue;
    }
    if (!spec.value.has(arg) && !spec.repeatable.has(arg)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (!value) throw new Error(`missing value for ${arg}`);
    if (value.startsWith("-")) throw new Error(`missing value for ${arg}`);
    if (spec.repeatable.has(arg)) {
      const arr = Array.isArray(flags[arg]) ? flags[arg] as string[] : [];
      arr.push(value);
      flags[arg] = arr;
    } else {
      flags[arg] = value;
    }
  }
  const debounce = flagString(flags, "--debounce-ms");
  if (debounce !== undefined && (!Number.isFinite(Number(debounce)) || Number(debounce) <= 0)) {
    throw new Error(`invalid --debounce-ms: ${debounce}`);
  }
  return { flags, rest };
}

function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function flagList(flags: ParsedArgs["flags"], name: string): string[] {
  const value = flags[name];
  return Array.isArray(value) ? value : [];
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function promptMissing(params: { server?: string; token?: string }) {
  if (params.server && params.token) return params as { server: string; token: string };
  const rl = readline.createInterface({ input, output });
  try {
    const server = params.server || await rl.question("Pentou URL [http://localhost:5173]: ");
    const token = params.token || await rl.question("Ingest token: ");
    return {
      server: server.trim() || "http://localhost:5173",
      token: token.trim(),
    };
  } finally {
    rl.close();
  }
}

async function initCollector(flags: ParsedArgs["flags"]): Promise<void> {
  const configPath = flagString(flags, "--config") || CONFIG_PATH;
  const prompted = await promptMissing({
    server: flagString(flags, "--server"),
    token: flagString(flags, "--token"),
  });
  if (!prompted.token) fail("ingest token is required. Get it from Settings -> Collector.");

  const server = normalizeServer(prompted.server);
  const token = prompted.token;
  const client = new IngestClient({ server, token });
  try {
    await client.ping();
  } catch (error: any) {
    fail(`cannot verify ingest token (${error?.message ?? error}). Check Settings -> Collector and retry.`);
  }

  let existing: CollectorConfig | undefined;
  try {
    existing = readConfig(configPath);
  } catch (error: any) {
    if (!String(error?.message ?? error).includes("not found")) throw error;
  }

  const cfg = buildInitConfig(existing, { server, token, flags });
  writeConfig(cfg, configPath);
  console.log(`collector config written: ${configPath}`);
  printDetectedSources(cfg);
}

/** 按本机目录/库文件存在性提示各来源状态（spec collector-source-expansion §4.3） */
function printDetectedSources(cfg: CollectorConfig): void {
  const sources: Array<[string, string | undefined]> = [
    ["claude-code", cfg.adapters["claude-code"].root],
    ["codex", cfg.adapters.codex.root],
    ["grok-cli", cfg.adapters["grok-cli"].root],
    ["copilot-vscode", cfg.adapters["copilot-vscode"].root],
    ["opencode", cfg.adapters.opencode.db],
    ["copilot", cfg.adapters.copilot.db],
    ["hermes", cfg.adapters.hermes.db],
    ["cursor", cfg.adapters.cursor.db],
  ];
  for (const [name, target] of sources) {
    const found = target ? fs.existsSync(target) : false;
    console.log(`  ${found ? "✓" : "-"} ${name}: ${found ? target : "not found (will be skipped)"}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildInitConfig(
  existing: CollectorConfig | undefined,
  params: { server: string; token: string; flags: ParsedArgs["flags"] },
): CollectorConfig {
  const flags = params.flags;
  const waylogDirs = flagList(flags, "--waylog-dir").map(resolveUserPath);
  const exclude = flagList(flags, "--exclude");
  const base = existing ?? defaultConfig();
  return defaultConfig({
    ...base,
    server: params.server,
    token: params.token,
    adapters: {
      ...base.adapters,
      "claude-code": {
        enabled: base.adapters["claude-code"].enabled,
        root: flagString(flags, "--claude-root")
          ? resolveUserPath(flagString(flags, "--claude-root")!)
          : base.adapters["claude-code"].root,
      },
      waylog: {
        enabled: waylogDirs.length > 0 ? true : base.adapters.waylog.enabled,
        dirs: waylogDirs.length > 0 ? unique([...base.adapters.waylog.dirs, ...waylogDirs]) : base.adapters.waylog.dirs,
      },
    },
    exclude: exclude.length > 0 ? unique([...base.exclude, ...exclude]) : base.exclude,
    debounceMs: flagString(flags, "--debounce-ms") ? Number(flagString(flags, "--debounce-ms")) : base.debounceMs,
    snapshots: base.snapshots,
  });
}

export function parseCollectArgsForTest(command: string, argv: string[]): ParsedArgs["flags"] {
  return parse(command, argv).flags;
}

export function buildInitConfigForTest(
  existing: CollectorConfig | undefined,
  params: { server: string; token: string; flags: ParsedArgs["flags"] },
): CollectorConfig {
  return buildInitConfig(existing, params);
}

async function pullCollector(flags: ParsedArgs["flags"]): Promise<void> {
  const configPath = flagString(flags, "--config") || CONFIG_PATH;
  const cfg = readConfig(configPath);
  const adapters = createAdapters(cfg);
  const summary = await pullOnce(cfg, adapters, {
    dryRun: flags["--dry-run"] === true,
    adapterName: flagString(flags, "--adapter"),
    verbose: flags["--verbose"] === true,
    configPath,
  });

  console.log(`scanned=${summary.scanned} sent=${summary.sent} excluded=${summary.skippedByExclude}`);
  console.log(`created=${summary.counts.created} merged=${summary.counts.merged} skipped=${summary.counts.skipped} error=${summary.counts.error}${summary.truncated ? ` truncated=${summary.truncated}` : ""}`);
  if (summary.errors.length) {
    for (const error of summary.errors) console.error(`  ${error.file}: ${error.error}`);
    process.exitCode = 1;
  }
}

async function watchCollector(flags: ParsedArgs["flags"]): Promise<void> {
  const configPath = flagString(flags, "--config") || CONFIG_PATH;
  const cfg = readConfig(configPath);
  const engine = new CollectorWatchEngine(cfg, createAdapters(cfg), {
    verbose: flags["--verbose"] === true,
    configPath,
  });
  await engine.start();
  console.log("collector watching. Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    const close = (signal: string) => {
      console.log(`\nreceived ${signal}, stopping collector...`);
      engine.stop();
      resolve();
    };
    process.once("SIGINT", () => close("SIGINT"));
    process.once("SIGTERM", () => close("SIGTERM"));
  });
}

export async function runCollectCommand(argv: string[]): Promise<void> {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  const parsed = parse(command, argv.slice(1));
  if (parsed.flags["--help"] || parsed.flags["-h"]) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.rest.length) throw new Error(`unknown positional arguments: ${parsed.rest.join(" ")}`);

  if (command === "init") await initCollector(parsed.flags);
  else if (command === "pull") await pullCollector(parsed.flags);
  else if (command === "watch") await watchCollector(parsed.flags);
  else throw new Error(`unknown collect command: ${command}`);
}
