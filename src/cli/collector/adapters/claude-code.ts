import fs from "node:fs/promises";
import path from "node:path";
import { defaultClaudeRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { cwdFromJsonlHead } from "../cwd.js";
import { walkFiles } from "./walk.js";

/** 子代理转录（<session-id>/subagents/agent-*.jsonl）是支线流量，不构成用户对话。 */
function isSubagentPath(file: string): boolean {
  return file.split(path.sep).includes("subagents");
}

export function createClaudeCodeAdapter(root = defaultClaudeRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "claude-code",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name.endsWith(".jsonl"));
      return files
        .filter((file) => !isSubagentPath(file))
        .map((file) => ({ path: file, platform: "claude-code" }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!file.endsWith(".jsonl") || isSubagentPath(file)) return null;
      const data = await fs.readFile(file, "utf-8");
      const externalId = path.basename(file, ".jsonl") || undefined;
      return {
        platform: "claude-code",
        externalId,
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
    async resolveCwd(file: string): Promise<string | undefined> {
      return cwdFromJsonlHead(file, (obj) => obj?.cwd ?? obj?.payload?.cwd);
    },
  };
}
