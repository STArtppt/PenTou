import fs from "node:fs/promises";
import path from "node:path";
import { defaultAntigravityRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

const TRANSCRIPT = "transcript.jsonl";
const TRANSCRIPT_FULL = "transcript_full.jsonl";
const LOGS_REL = path.join(".system_generated", "logs");

/**
 * Antigravity CLI 会话采集（spec collector-antigravity）。
 *
 * 本机存储勘测（2026-08-24）：
 * - `~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript_full.jsonl`
 *   —— 会话步进 JSONL（一行一步：USER_INPUT / PLANNER_RESPONSE / 工具结果 / CHECKPOINT），
 *   与 `conversations/<uuid>.db`（protobuf 轨迹）步骤一一对应，但可直接解析。
 * - 同目录 `transcript.jsonl` 为同一份日志的「截断视图」（长 content 字段带 truncated_fields），
 *   `transcript_full.jsonl` 内容更完整，两者 mtime 同步更新，因此**优先采集 full**。
 * - `conversations/<uuid>.db` 的 step_payload / metadata 全是 protobuf blob，无 schema 不可靠解析
 *   （作为脑补风险记录：brain 目录若被 CLI 清理，本 adapter 会暂时采不到，见 spec §5 边界）。
 * - `~/.gemini/antigravity-cli/history.jsonl` 记录用户输入行，带 `conversationId → workspace` 映射，
 *   用于补工作目录（sourceProject / 项目归属），可旁路读取，不做采集对象。
 *
 * 文件型 adapter：discover 只收每会话一个 transcript 文件，externalId = brain 目录 UUID。
 * toItem 产出信封 `{ schema:"antigravity-cli-v1", conversationId, workspace?, history }`，
 * workspace 交给服务端 normalizer 投影为 sourceProject。
 */

export function antigravityConversationId(file: string): string | undefined {
  const segments = path.dirname(file).split(path.sep);
  // .../brain/<uuid>/.system_generated/logs
  const idx = segments.lastIndexOf("logs");
  const uuid = idx >= 2 ? segments[idx - 2] : undefined;
  return uuid?.trim() || undefined;
}

interface HistoryCache {
  mtimeMs: number;
  /** conversationId → workspace（最后一次出现覆盖） */
  workspaceByConv: Map<string, string>;
}

/**
 * 读 `~/.gemini/antigravity-cli/history.jsonl` 建 conversationId → workspace 映射。
 * 按文件 mtime 做短缓存：watch 长驻进程里每次 toItem 只 stat，不重读未变文件。
 */
async function readWorkspaceMap(
  historyFile: string,
  cache: HistoryCache | null,
): Promise<HistoryCache> {
  try {
    const stat = await fs.stat(historyFile);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache;
    const text = await fs.readFile(historyFile, "utf-8");
    const workspaceByConv = new Map<string, string>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (typeof row?.conversationId !== "string" || !row.conversationId.trim()) continue;
        if (typeof row?.workspace !== "string" || !row.workspace.trim()) continue;
        workspaceByConv.set(row.conversationId.trim(), row.workspace.trim());
      } catch {
        continue; // 半行/损坏行跳过，不影响其余
      }
    }
    return { mtimeMs: stat.mtimeMs, workspaceByConv };
  } catch {
    return cache ?? { mtimeMs: -1, workspaceByConv: new Map() };
  }
}

export function createAntigravityCliAdapter(root = defaultAntigravityRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  // history.jsonl 在 brain 的父目录：~/.gemini/antigravity-cli/history.jsonl
  const historyFile = path.join(path.dirname(resolvedRoot), "history.jsonl");
  let historyCache: HistoryCache | null = null;

  return {
    platform: "antigravity-cli",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name === TRANSCRIPT || name === TRANSCRIPT_FULL);
      // 每会话只采一个文件：transcript_full.jsonl 优先，缺失回退 transcript.jsonl
      const byConv = new Map<string, SessionFile>();
      for (const file of files.sort()) {
        const id = antigravityConversationId(file);
        if (!id) continue;
        const existing = byConv.get(id);
        if (!existing || path.basename(file) === TRANSCRIPT_FULL) {
          byConv.set(id, { path: file, platform: "antigravity-cli" });
        }
      }
      return [...byConv.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      const name = path.basename(file);
      if (name !== TRANSCRIPT && name !== TRANSCRIPT_FULL) return null;
      const conversationId = antigravityConversationId(file);
      if (!conversationId) return null;
      const history = await fs.readFile(file, "utf-8");
      const cache = await readWorkspaceMap(historyFile, historyCache);
      historyCache = cache;
      const workspace = cache.workspaceByConv.get(conversationId);
      return {
        platform: "antigravity-cli",
        externalId: conversationId,
        format: "raw",
        data: JSON.stringify({
          schema: "antigravity-cli-v1",
          conversationId,
          ...(workspace ? { workspace } : {}),
          history,
        }),
        filename: name,
      };
    },
    async resolveCwd(file: string): Promise<string | undefined> {
      const name = path.basename(file);
      if (name !== TRANSCRIPT && name !== TRANSCRIPT_FULL) return undefined;
      const conversationId = antigravityConversationId(file);
      if (!conversationId) return undefined;
      const cache = await readWorkspaceMap(historyFile, historyCache);
      historyCache = cache;
      return cache.workspaceByConv.get(conversationId);
    },
  };
}
