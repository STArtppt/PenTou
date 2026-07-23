import { createClaudeCodeAdapter } from "./claude-code.js";
import { createWaylogAdapter } from "./waylog.js";
import type { CollectorConfig } from "../types.js";

export function createAdapters(config: CollectorConfig) {
  const adapters = [];
  if (config.adapters["claude-code"].enabled) {
    adapters.push(createClaudeCodeAdapter(config.adapters["claude-code"].root));
  }
  if (config.adapters.waylog.enabled) {
    adapters.push(createWaylogAdapter(config.adapters.waylog.dirs));
  }
  return adapters;
}
