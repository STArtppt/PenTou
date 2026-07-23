import fs from "node:fs/promises";
import path from "node:path";
import { defaultGrokRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

const CHAT_FILE = "chat_history.jsonl";

/**
 * ~/.grok/sessions/<url编码cwd>/<uuid>/chat_history.jsonl；仅此文件参与采集，
 * 会话目录内其余文件（events.jsonl / summary.json / terminal 等）忽略（US-02 AC2）。
 * externalId = 会话目录 UUID，与 cwd 目录无关（spec §5 边界 5）。
 */
export function createGrokCliAdapter(root = defaultGrokRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "grok-cli",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name === CHAT_FILE);
      return files
        .map((file) => ({ path: file, platform: "grok-cli" }) as SessionFile)
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (path.basename(file) !== CHAT_FILE) return null;
      const data = await fs.readFile(file, "utf-8");
      return {
        platform: "grok-cli",
        externalId: path.basename(path.dirname(file)) || undefined,
        format: "raw",
        data,
        filename: CHAT_FILE,
      };
    },
  };
}
