import fs from "node:fs/promises";
import path from "node:path";
import { parseGrokTurns, type GrokTurnWindow } from "../../../shared/normalizers/grok-cli.js";
import { defaultGrokRoot, resolveUserPath } from "../config.js";
import type { CollectorAdapter, IngestItem, SessionFile } from "../types.js";
import { grokCliCwdFromFile } from "../cwd.js";
import { walkFiles } from "./walk.js";

const CHAT_FILE = "chat_history.jsonl";
const SUMMARY_FILE = "summary.json";
const EVENTS_FILE = "events.jsonl";

/** 会话级元信息，塞进 grok-cli-v1 信封供 normalizer 取真实时间 */
export interface GrokCliSessionMeta {
  created_at?: string;
  updated_at?: string;
  title?: string;
  /** 工作目录：会话目录的父级名是 encodeURIComponent(cwd)，URL 编码可无歧义还原 */
  cwd?: string;
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 会话父目录名 → 工作目录。URL 编码是可逆的，所以这一步安全；
 * 对比之下 `~/.claude/projects/` 的 `-` 编码不可逆，那边只用内容里的 cwd
 * （spec conversation-project-attribution §来源项目的判定优先级）。
 */
function decodeGrokCwd(encoded: string): string | undefined {
  if (!encoded.includes("%")) return undefined;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** events 文本中第一条带 ts 的行（会话 created_at 兜底） */
function firstTsInEvents(eventsText: string): string | undefined {
  for (const line of eventsText.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.ts === "string" && obj.ts.trim()) return obj.ts.trim();
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * 从同目录 summary.json（优先）或 events 首条 ts 取会话时间。
 * discover 仍只扫 chat_history；meta / events 仅在 toItem 时旁路读取。
 */
export async function readGrokSessionMeta(
  sessionDir: string,
  eventsText?: string | null,
): Promise<GrokCliSessionMeta> {
  const meta: GrokCliSessionMeta = {};
  try {
    const raw = await fs.readFile(path.join(sessionDir, SUMMARY_FILE), "utf-8");
    const summary = JSON.parse(raw);
    if (typeof summary?.created_at === "string" && summary.created_at.trim()) {
      meta.created_at = summary.created_at.trim();
    }
    if (typeof summary?.updated_at === "string" && summary.updated_at.trim()) {
      meta.updated_at = summary.updated_at.trim();
    }
    const title =
      (typeof summary?.generated_title === "string" && summary.generated_title.trim()) ||
      (typeof summary?.session_summary === "string" && summary.session_summary.trim()) ||
      "";
    if (title) meta.title = title;
  } catch {
    // summary 缺失/损坏时走 events 兜底
  }
  if (!meta.created_at && eventsText) {
    const firstTs = firstTsInEvents(eventsText);
    if (firstTs) meta.created_at = firstTs;
  }
  return meta;
}

/**
 * ~/.grok/sessions/<url编码cwd>/<uuid>/chat_history.jsonl；discover 仅此文件，
 * toItem 旁路读 summary.json / events.jsonl → 信封（会话时间 + turn 窗口）。
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
      const sessionDir = path.dirname(file);
      const history = await fs.readFile(file, "utf-8");
      // ~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/chat_history.jsonl
      const encodedCwd = path.basename(path.dirname(sessionDir));
      const eventsText = await readOptionalText(path.join(sessionDir, EVENTS_FILE));
      const turns: GrokTurnWindow[] = eventsText ? parseGrokTurns(eventsText) : [];
      const session = await readGrokSessionMeta(sessionDir, eventsText);
      return {
        platform: "grok-cli",
        externalId: path.basename(sessionDir) || undefined,
        format: "raw",
        data: JSON.stringify({
          schema: "grok-cli-v1",
          session: { ...session, ...(decodeGrokCwd(encodedCwd) ? { cwd: decodeGrokCwd(encodedCwd) } : {}) },
          turns,
          history,
        }),
        filename: CHAT_FILE,
      };
    },
    async resolveCwd(file: string): Promise<string | undefined> {
      return grokCliCwdFromFile(file);
    },
  };
}
