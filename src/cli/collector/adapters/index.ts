import { createClaudeCodeAdapter } from "./claude-code.js";
import { createWaylogAdapter } from "./waylog.js";
import { createCodexAdapter } from "./codex.js";
import { createGrokCliAdapter } from "./grok-cli.js";
import { createPiAdapter } from "./pi.js";
import { createCopilotVscodeAdapter } from "./copilot-vscode.js";
import { createOpencodeAdapter } from "./opencode.js";
import { createCopilotAdapter } from "./copilot.js";
import { createHermesAdapter } from "./hermes.js";
import { createCursorAdapter } from "./cursor.js";
import { createDocsAdapter } from "./docs.js";
import { sqliteAvailable, SQLITE_UNAVAILABLE_HINT } from "../sqlite.js";
import type { CollectorAdapter, CollectorConfig } from "../types.js";

export function createAdapters(
  config: CollectorConfig,
  warn: (message: string) => void = console.warn,
): CollectorAdapter[] {
  const adapters: CollectorAdapter[] = [];
  const cfg = config.adapters;
  if (cfg["claude-code"].enabled) adapters.push(createClaudeCodeAdapter(cfg["claude-code"].root));
  if (cfg.waylog.enabled) adapters.push(createWaylogAdapter(cfg.waylog.dirs));
  if (cfg.codex.enabled) adapters.push(createCodexAdapter(cfg.codex.root));
  if (cfg["grok-cli"].enabled) adapters.push(createGrokCliAdapter(cfg["grok-cli"].root));
  if (cfg.pi.enabled) adapters.push(createPiAdapter(cfg.pi.root));
  if (cfg["copilot-vscode"].enabled) adapters.push(createCopilotVscodeAdapter(cfg["copilot-vscode"].root));
  // 文档推送：仅显式登记（enabled）时创建，未登记时完全静默（spec collector-docs-push）
  if (cfg.docs?.enabled) adapters.push(createDocsAdapter(cfg.docs.dirs));

  // SQLite 查询型：node:sqlite 缺失时整组禁用并明确提示，文件型不受影响（US-03 AC3）
  const queryEnabled = cfg.opencode.enabled || cfg.copilot.enabled || cfg.hermes.enabled || cfg.cursor.enabled;
  if (queryEnabled && !sqliteAvailable()) {
    warn(SQLITE_UNAVAILABLE_HINT);
  } else {
    if (cfg.opencode.enabled) adapters.push(createOpencodeAdapter(cfg.opencode.db));
    if (cfg.copilot.enabled) adapters.push(createCopilotAdapter(cfg.copilot.db));
    if (cfg.hermes.enabled) adapters.push(createHermesAdapter(cfg.hermes.db));
    if (cfg.cursor.enabled) adapters.push(createCursorAdapter(cfg.cursor.db));
  }
  return adapters;
}
