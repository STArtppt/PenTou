/**
 * WorkBuddy 会话 JSONL normalizer。
 *
 * 载荷就是 `~/.workbuddy/projects/<编码 cwd>/<sessionId>.jsonl` 原文
 * （adapter 不加信封：时间、标题、cwd 都在事件行里）。
 *
 * 行形态（2026-09-30 本机勘测）：
 * - `session-meta`：会话头，timestamp 为 epoch ms（数字或数字字符串）
 * - `ai-title`：`aiTitle` 作对话标题；多次出现取最后一次
 * - `message` + role `user`：正文在 `<user_query>` 内，外层是 `<system-reminder>` 注入块。
 *   没有 user_query 的行（`<task-notification>` 等）整条丢弃
 * - `message` + role `assistant`：只取 `output_text`。进行中的行（status 不是 completed）跳过
 * - `reasoning`：`rawContent` 里的 reasoning_text，挂到下一条有正文的助手消息上
 * - `function_call` / `function_call_result` / `file-history-snapshot`：不是对话正文，丢弃
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildReasoning } from "../reasoning.js";
import { sourceProjectFromCwd } from "../source-project.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage } from "./util.js";

interface WorkbuddyRow {
  type?: string;
  role?: string;
  timestamp?: unknown;
  cwd?: unknown;
  aiTitle?: unknown;
  status?: unknown;
  content?: unknown;
  rawContent?: unknown;
}

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi;

function rowTime(value: unknown): string | undefined {
  const epoch = epochToIso(value);
  if (epoch) return epoch;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function textsOf(content: unknown, types: ReadonlySet<string> | null): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const rec = part as { type?: unknown; text?: unknown };
      if (types && (typeof rec.type !== "string" || !types.has(rec.type))) return "";
      return typeof rec.text === "string" ? rec.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** 真实提问在 `<user_query>` 里；任务通知、本地图片路径、system-reminder 都不是用户正文。 */
function workbuddyUserText(raw: string): string {
  USER_QUERY_RE.lastIndex = 0;
  const queries = [...raw.matchAll(USER_QUERY_RE)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  if (queries.length === 0) return "";
  return cleanUserMessageContent(queries.join("\n\n"));
}

function reasoningText(row: WorkbuddyRow): string {
  const fromRaw = textsOf(row.rawContent, null);
  if (fromRaw) return fromRaw;
  return textsOf(row.content, null);
}

export function normalizeWorkbuddy(data: string): Conversation[] {
  const messages: Message[] = [];
  let sessionDate: string | undefined;
  let title: string | undefined;
  let cwd: unknown;
  let sawSourceTime = false;
  let pendingThinking: string[] = [];

  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let row: WorkbuddyRow;
    try {
      row = JSON.parse(line) as WorkbuddyRow;
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;

    if (cwd === undefined && typeof row.cwd === "string" && row.cwd.trim()) cwd = row.cwd;

    if (row.type === "session-meta") {
      sessionDate ??= rowTime(row.timestamp);
      continue;
    }
    if (row.type === "ai-title") {
      if (typeof row.aiTitle === "string" && row.aiTitle.trim()) title = row.aiTitle.trim();
      continue;
    }
    if (row.type === "reasoning") {
      const text = reasoningText(row);
      if (text) pendingThinking.push(text);
      continue;
    }
    if (row.type !== "message") continue;

    const timestamp = rowTime(row.timestamp);
    if (timestamp) sawSourceTime = true;
    const at = timestamp ?? new Date().toISOString();

    if (row.role === "user") {
      const text = workbuddyUserText(textsOf(row.content, new Set(["input_text"])));
      if (!text) continue;
      pendingThinking = [];
      messages.push(makeMessage("user", text, at));
      continue;
    }
    if (row.role !== "assistant") continue;
    if (typeof row.status === "string" && row.status !== "completed") continue;

    const text = textsOf(row.content, new Set(["output_text"]));
    if (!text) continue;
    const reasoning = buildReasoning(undefined, pendingThinking.join("\n\n"));
    pendingThinking = [];
    messages.push(makeMessage("ai", text, at, reasoning));
  }

  if (messages.length === 0) throw new EmptyPayloadError("workbuddy raw payload contains no messages");

  const conv = buildConversation({
    platform: "WorkBuddy",
    title,
    date: sessionDate,
    messages,
    fallbackTitle: "WorkBuddy Conversation",
    sourceProject: sourceProjectFromCwd(cwd),
  });
  if (sessionDate || sawSourceTime) conv.dateFromSource = true;
  return [conv];
}
