import fs from "node:fs/promises";
import path from "node:path";
import { defaultWorkbuddyRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem } from "../types.js";
import { cwdFromJsonlHead } from "../cwd.js";
import { walkFiles } from "./walk.js";

/**
 * WorkBuddy 5.x 本地会话（2026-09-30 本机勘测）：
 * `~/.workbuddy/projects/<编码 cwd>/<sessionId>.jsonl`。
 *
 * 一行一个事件：`session-meta` / `message`（user 的 input_text、assistant 的 output_text）/
 * `ai-title` / `reasoning` / `function_call` / `function_call_result` / `file-history-snapshot`。
 * 会话时间、标题、cwd 都在这份 JSONL 里，不加信封，raw 直接交给 workbuddy normalizer。
 *
 * 只收项目目录下一层的 `*.jsonl`。同级 `.file-rollback.ndjson` 与
 * `<sessionId>/tool-results/` 不是会话正文。云端会话（workbuddy.db 里 transport=cloud）
 * 没有本地 JSONL，采不到正文。
 *
 * externalId = 文件名（会话 UUID）。
 */
function workbuddyExternalId(file: string): string | undefined {
  const id = path.basename(file, ".jsonl").trim();
  return id || undefined;
}

/** `root/<project>/<session>.jsonl`，恰好两段；更深的 jsonl 不是会话正文。 */
function isWorkbuddySessionFile(root: string, file: string): boolean {
  if (!file.endsWith(".jsonl")) return false;
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return rel.split(path.sep).length === 2;
}

export function createWorkbuddyAdapter(root = defaultWorkbuddyRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "workbuddy",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name.endsWith(".jsonl"));
      return files
        .filter((file) => isWorkbuddySessionFile(resolvedRoot, file))
        .map((file) => ({ path: file, platform: "workbuddy" }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!isWorkbuddySessionFile(resolvedRoot, file)) return null;
      const data = await fs.readFile(file, "utf-8");
      return {
        platform: "workbuddy",
        externalId: workbuddyExternalId(file),
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
    async resolveCwd(file: string): Promise<string | undefined> {
      // cwd 在 message 行上，不在首行 session-meta；父目录名是 `-` 编码，不可逆
      return cwdFromJsonlHead(file, (obj) => obj?.cwd);
    },
  };
}
