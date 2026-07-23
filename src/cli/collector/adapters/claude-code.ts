import fs from "node:fs/promises";
import path from "node:path";
import { defaultClaudeRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

export function createClaudeCodeAdapter(root = defaultClaudeRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "claude-code",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name.endsWith(".jsonl"));
      return files.map((file) => ({ path: file, platform: "claude-code" })).sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!file.endsWith(".jsonl")) return null;
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
  };
}
