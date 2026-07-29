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

export function defaultCodexRoot(): string {
  return path.join(os.homedir(), ".codex", "sessions");
}

export function defaultGrokRoot(): string {
  return path.join(os.homedir(), ".grok", "sessions");
}

/**
 * 与 opencode 自身的 `Global.Path.data` 保持一致：`path.join(xdgData, "opencode")`，
 * 其中 xdgData 来自 xdg-basedir —— `XDG_DATA_HOME || ~/.local/share`，**没有 Windows 分支**，
 * 因此 Windows 上同样落在 `%USERPROFILE%\.local\share`，不需要按平台分派。
 * 空串按 xdg-basedir 的 `||` 语义视为未设置。
 */
export function defaultOpencodeDb(): string {
  const xdgData = process.env.XDG_DATA_HOME;
  const base = xdgData ? xdgData : path.join(os.homedir(), ".local", "share");
  return path.join(base, "opencode", "opencode.db");
}

export function defaultCopilotDb(): string {
  return path.join(os.homedir(), ".copilot", "session-store.db");
}

export function defaultHermesDb(): string {
  return path.join(os.homedir(), ".hermes", "state.db");
}

/** VS Code / Cursor 的用户数据目录按平台定位（spec §5 边界 4：仅默认 stable 路径） */
function editorUserDir(app: "Code" | "Cursor"): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", app, "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), app, "User");
  }
  return path.join(os.homedir(), ".config", app, "User");
}

export function defaultVscodeChatRoot(): string {
  return path.join(editorUserDir("Code"), "workspaceStorage");
}

export function defaultCursorDb(): string {
  return path.join(editorUserDir("Cursor"), "globalStorage", "state.vscdb");
}

export function defaultConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  const rootAdapter = (
    name: "codex" | "grok-cli" | "copilot-vscode",
    defaultRoot: string,
  ): { enabled: boolean; root: string } => ({
    enabled: overrides.adapters?.[name]?.enabled ?? true,
    root: overrides.adapters?.[name]?.root ?? defaultRoot,
  });
  const dbAdapter = (
    name: "opencode" | "copilot" | "hermes" | "cursor",
    defaultDb: string,
  ): { enabled: boolean; db: string } => ({
    enabled: overrides.adapters?.[name]?.enabled ?? true,
    db: overrides.adapters?.[name]?.db ?? defaultDb,
  });
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
      codex: rootAdapter("codex", defaultCodexRoot()),
      "grok-cli": rootAdapter("grok-cli", defaultGrokRoot()),
      "copilot-vscode": rootAdapter("copilot-vscode", defaultVscodeChatRoot()),
      opencode: dbAdapter("opencode", defaultOpencodeDb()),
      copilot: dbAdapter("copilot", defaultCopilotDb()),
      hermes: dbAdapter("hermes", defaultHermesDb()),
      cursor: dbAdapter("cursor", defaultCursorDb()),
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

  const rootAdapter = (name: string, defaultRoot: string) => ({
    enabled: raw.adapters?.[name]?.enabled !== false,
    root: raw.adapters?.[name]?.root ? resolveUserPath(String(raw.adapters[name].root)) : defaultRoot,
  });
  const dbAdapter = (name: string, defaultDb: string) => ({
    enabled: raw.adapters?.[name]?.enabled !== false,
    db: raw.adapters?.[name]?.db ? resolveUserPath(String(raw.adapters[name].db)) : defaultDb,
  });

  const cfg = defaultConfig({
    server: normalizeServer(raw.server.trim()),
    token: raw.token.trim(),
    adapters: {
      "claude-code": rootAdapter("claude-code", defaultClaudeRoot()),
      waylog: {
        enabled: raw.adapters?.waylog?.enabled === true,
        dirs: Array.isArray(raw.adapters?.waylog?.dirs)
          ? raw.adapters.waylog.dirs.map((dir: string) => resolveUserPath(String(dir)))
          : [],
      },
      codex: rootAdapter("codex", defaultCodexRoot()),
      "grok-cli": rootAdapter("grok-cli", defaultGrokRoot()),
      "copilot-vscode": rootAdapter("copilot-vscode", defaultVscodeChatRoot()),
      opencode: dbAdapter("opencode", defaultOpencodeDb()),
      copilot: dbAdapter("copilot", defaultCopilotDb()),
      hermes: dbAdapter("hermes", defaultHermesDb()),
      cursor: dbAdapter("cursor", defaultCursorDb()),
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
