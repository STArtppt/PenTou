import fs from "node:fs/promises";
import path from "node:path";
import { defaultCodexRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { cwdFromJsonlHead } from "../cwd.js";
import { walkFiles } from "./walk.js";

/** rollout-<ISO时间>-<会话UUID>.jsonl，UUID 即 externalId（spec collector-source-expansion US-01） */
const ROLLOUT_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function isRolloutFile(name: string): boolean {
  return name.startsWith("rollout-") && name.endsWith(".jsonl");
}

export function extractCodexExternalId(file: string): string | undefined {
  return ROLLOUT_UUID_RE.exec(path.basename(file))?.[1] ?? undefined;
}

/** CLI 与桌面 Codex 模式共写 ~/.codex/sessions（本地引擎壳，spec §4.5 决策 6） */
export function createCodexAdapter(root = defaultCodexRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "codex",
    async discover() {
      const files = await walkFiles(resolvedRoot, isRolloutFile);
      return files
        .map((file) => ({ path: file, platform: "codex" }) as SessionFile)
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!isRolloutFile(path.basename(file))) return null;
      const data = await fs.readFile(file, "utf-8");
      return {
        platform: "codex",
        externalId: extractCodexExternalId(file) ?? path.basename(file, ".jsonl"),
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
    async resolveCwd(file: string): Promise<string | undefined> {
      return cwdFromJsonlHead(file, (obj) =>
        obj?.type === "session_meta" ? obj?.payload?.cwd : obj?.cwd,
      );
    },
  };
}
