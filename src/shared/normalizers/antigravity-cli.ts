/**
 * Antigravity CLI transcript normalizer（spec collector-antigravity US-02）。
 *
 * 载荷是 `~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript_full.jsonl`
 * 的原文（或 adapter 加的信封 `{ schema:"antigravity-cli-v1", conversationId, workspace?, history }`，
 * 无信封时回退按纯 jsonl 处理）。行格式（一行一步）：
 *
 * - `{ source:"USER_EXPLICIT", type:"USER_INPUT", content }` —— 用户消息。content 以
 *   `<USER_REQUEST>…</USER_REQUEST>` 包裹真实提问，其余 `<ADDITIONAL_METADATA>` /
 *   `<USER_SETTINGS_CHANGE>` 等块一并剥掉（cleanUserMessageContent 兜底）。
 * - `{ source:"MODEL", type:"PLANNER_RESPONSE", content?, thinking?, tool_calls? }`
 *   - 带 `tool_calls` 无 content：工具调用轮，跳过（工具执行细节不是对话正文）。
 *   - 带 `content`：助手最终回答（含 thinking 时投影为 reasoning）。
 * - `{ source:"MODEL", type:"RUN_COMMAND"|"VIEW_FILE"|"GENERIC"|… }` —— 工具结果，跳过。
 * - `{ source:"SYSTEM", type:"CHECKPOINT"|"CONVERSATION_HISTORY"|"SYSTEM_MESSAGE" }` —— 系统噪声，跳过。
 *
 * 消息时间取步级 `created_at`（ISO）；会话 date 取首步时间。
 * platform 输出 "Antigravity" —— 与 Gemini 独立品牌（spec collector-antigravity US-04）。
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildConversation, EmptyPayloadError, makeMessage } from "./util.js";
import { sourceProjectFromCwd } from "../source-project.js";

const USER_REQUEST_RE = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i;

interface AntigravityStep {
  step_index?: unknown;
  source?: unknown;
  type?: unknown;
  status?: unknown;
  created_at?: unknown;
  content?: unknown;
  thinking?: unknown;
  tool_calls?: unknown;
}

function parseStep(line: string): AntigravityStep | null {
  if (!line.trim()) return null;
  try {
    const row = JSON.parse(line);
    return row && typeof row === "object" ? (row as AntigravityStep) : null;
  } catch {
    return null;
  }
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 用户消息正文：优先取 <USER_REQUEST> 内层，其余注入块交给共享清洗兜底。 */
function userText(content: unknown): string {
  if (typeof content !== "string") return "";
  const wrapped = USER_REQUEST_RE.exec(content);
  const text = wrapped ? wrapped[1].trim() : cleanUserMessageContent(content);
  return cleanUserMessageContent(text);
}

function isToolCallStep(step: AntigravityStep): boolean {
  return Array.isArray(step.tool_calls) && step.tool_calls.length > 0;
}

export interface UnpackedAntigravityPayload {
  history: string;
  sourceProject?: string;
}

/** 解包信封或回退为纯 jsonl 文本。 */
export function unpackAntigravityCliPayload(data: string): UnpackedAntigravityPayload {
  const trimmed = data.trim();
  if (!trimmed.startsWith("{")) return { history: data };
  try {
    const json = JSON.parse(trimmed);
    if (
      json &&
      typeof json === "object" &&
      typeof json.schema === "string" &&
      json.schema.startsWith("antigravity-cli") &&
      typeof json.history === "string"
    ) {
      return {
        history: json.history,
        sourceProject: sourceProjectFromCwd(json.workspace),
      };
    }
  } catch {
    // 整段不是 JSON → 当纯 jsonl
  }
  return { history: data };
}

function extractMessages(history: string): Message[] {
  const messages: Message[] = [];
  let sessionDate: string | undefined;

  for (const line of history.split("\n")) {
    const step = parseStep(line);
    if (!step) continue;
    // 只收已完成的步：RUNNING 等中间态可能是半写/进行中，避免截断内容落库
    if (step.status !== "DONE") continue;
    const timestamp = isoTimestamp(step.created_at);
    sessionDate ??= timestamp;
    const fallback = timestamp ?? sessionDate ?? new Date().toISOString();

    if (typeof step.source === "string" && step.source.startsWith("USER") && step.type === "USER_INPUT") {
      const text = userText(step.content);
      if (text) messages.push(makeMessage("user", text, fallback));
      continue;
    }
    if (step.source !== "MODEL" || step.type !== "PLANNER_RESPONSE") continue;
    if (isToolCallStep(step)) continue; // 工具调用轮不是正文
    if (typeof step.content !== "string" || !step.content.trim()) continue;

    const text = step.content.trim();
    const thinking = typeof step.thinking === "string" && step.thinking.trim()
      ? step.thinking.trim()
      : undefined;
    messages.push(
      makeMessage("ai", text, fallback, thinking ? { thinking } : undefined),
    );
  }

  return messages;
}

export function normalizeAntigravityCli(data: string): Conversation[] {
  const { history, sourceProject } = unpackAntigravityCliPayload(data);
  const messages = extractMessages(history);
  if (messages.length === 0) throw new EmptyPayloadError("antigravity-cli raw payload contains no messages");

  const date = messages[0]?.timestamp;
  const conv = buildConversation({
    platform: "Antigravity",
    messages,
    date,
    fallbackTitle: "Antigravity Conversation",
    sourceProject,
  });
  conv.dateFromSource = true;
  return [conv];
}
