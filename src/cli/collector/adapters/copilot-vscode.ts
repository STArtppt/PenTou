import fs from "node:fs/promises";
import path from "node:path";
import { defaultVscodeChatRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { walkFiles } from "./walk.js";

/** workspaceStorage/<hash>/chatSessions/<uuid>.json 才是会话文件 */
function isChatSessionFile(file: string): boolean {
  return file.endsWith(".json") && path.basename(path.dirname(file)) === "chatSessions";
}

/**
 * VS Code Copilot Chat 插件会话（spec US-04）。requests 为空的会话不上报
 * （US-04 AC3），externalId = 会话 JSON 的 sessionId。
 */
export function createCopilotVscodeAdapter(root = defaultVscodeChatRoot()): CollectorAdapter {
  const resolvedRoot = resolveUserPath(root);
  return {
    platform: "copilot-vscode",
    async discover() {
      const files = await walkFiles(resolvedRoot, (name) => name.endsWith(".json"));
      return files
        .filter(isChatSessionFile)
        .map((file) => ({ path: file, platform: "copilot-vscode" }) as SessionFile)
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    watchRoots() {
      return [resolvedRoot];
    },
    async toItem(file: string): Promise<IngestItem | null> {
      if (!isChatSessionFile(file)) return null;
      const data = await fs.readFile(file, "utf-8");
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        return null; // 写入中的半截 JSON：等下次事件收敛
      }
      if (!Array.isArray(json?.requests) || json.requests.length === 0) return null;
      const externalId = typeof json.sessionId === "string" && json.sessionId
        ? json.sessionId
        : path.basename(file, ".json");
      return {
        platform: "copilot-vscode",
        externalId,
        format: "raw",
        data,
        filename: path.basename(file),
      };
    },
  };
}
