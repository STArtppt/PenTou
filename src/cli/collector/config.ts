import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CollectorConfig } from "./types.js";

export const DEFAULT_SERVER = "http://localhost:5173";
export const DEFAULT_DEBOUNCE_MS = 15_000;
export const CONFIG_DIR = path.join(os.homedir(), ".pentou");
export const CONFIG_PATH = path.join(CONFIG_DIR, "collector.json");

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function resolveUserPath(input: string): string {
  return path.resolve(expandHome(input));
}

export function defaultClaudeRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function defaultConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    server: overrides.server ?? DEFAULT_SERVER,
    token: overrides.token ?? "",
    exclude: overrides.exclude ?? [],
    debounceMs: overrides.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    snapshots: overrides.snapshots ?? {},
    adapters: {
      "claude-code": {
        enabled: overrides.adapters?.["claude-code"]?.enabled ?? true,
        root: overrides.adapters?.["claude-code"]?.root ?? defaultClaudeRoot(),
      },
      waylog: {
        enabled: overrides.adapters?.waylog?.enabled ?? false,
        dirs: overrides.adapters?.waylog?.dirs ?? [],
      },
    },
  };
}

export function normalizeServer(server: string): string {
  return server.replace(/\/+$/, "");
}

export function normalizeConfig(raw: any): CollectorConfig {
  if (!raw || typeof raw !== "object") throw new Error("collector config must be an object");
  if (typeof raw.server !== "string" || !raw.server.trim()) throw new Error("collector config missing server");
  if (typeof raw.token !== "string" || !raw.token.trim()) throw new Error("collector config missing token");

  const cfg = defaultConfig({
    server: normalizeServer(raw.server.trim()),
    token: raw.token.trim(),
    adapters: {
      "claude-code": {
        enabled: raw.adapters?.["claude-code"]?.enabled !== false,
        root: raw.adapters?.["claude-code"]?.root
          ? resolveUserPath(String(raw.adapters["claude-code"].root))
          : defaultClaudeRoot(),
      },
      waylog: {
        enabled: raw.adapters?.waylog?.enabled === true,
        dirs: Array.isArray(raw.adapters?.waylog?.dirs)
          ? raw.adapters.waylog.dirs.map((dir: string) => resolveUserPath(String(dir)))
          : [],
      },
    },
    exclude: Array.isArray(raw.exclude) ? raw.exclude.map(String) : [],
    debounceMs: Number.isFinite(raw.debounceMs) && raw.debounceMs > 0
      ? Number(raw.debounceMs)
      : DEFAULT_DEBOUNCE_MS,
    snapshots: raw.snapshots && typeof raw.snapshots === "object" ? raw.snapshots : {},
  });
  return cfg;
}

export function readConfig(file = CONFIG_PATH): CollectorConfig {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`collector config not found: ${file}. Run "pentou collect init" first.`);
    }
    throw error;
  }
  try {
    return normalizeConfig(JSON.parse(text));
  } catch (error: any) {
    throw new Error(`invalid collector config ${file}: ${error?.message ?? error}`);
  }
}

export function writeConfig(config: CollectorConfig, file = CONFIG_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
}
