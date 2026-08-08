/**
 * Pi coding agent 会话 JSONL normalizer。
 *
 * 载荷就是 `~/.pi/agent/sessions/<编码cwd>/<时间戳>_<uuid>.jsonl` 原文（adapter 不加信封 ——
 * 会话时间、id、工作目录都在首行 `session` 事件里，没有需要旁路补齐的东西）。
 *
 * 行形态：
 * - `{ type:"session", id, timestamp, cwd, version }` —— 会话头，取 date 与 sourceProject
 * - `{ type:"model_change" | "thinking_level_change", ... }` —— 控制事件，丢弃
 * - `{ type:"message", timestamp, message:{ role, content:[part], ... } }`
 *   - role `user`：`text` part 即用户正文，再走 cleanUserMessageContent 兜底注入块
 *   - role `assistant`：只取 `text` part；`thinking`（含 CoT）与 `toolCall` 不是对话正文
 *   - role `toolResult`：工具回显（含 base64 图片），整条丢弃
 *
 * 消息时间取行级 `timestamp`（ISO）；缺失时回退 `message.timestamp`（epoch ms）。
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage } from "./util.js";
import { sourceProjectFromCwd } from "../source-project.js";

/** ISO / 可被 Date 解析的字符串 → ISO；非法返回 undefined */
function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 只取 text part：thinking / toolCall / image 不是对话正文 */
function textParts(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function normalizePi(data: string): Conversation[] {
  const messages: Message[] = [];
  let sessionDate: string | undefined;
  let cwd: unknown;
  let sawSourceTime = false;

  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // 半行/损坏行：跳过而非整会话失败
    }

    if (row?.type === "session") {
      sessionDate ??= isoTimestamp(row.timestamp);
      if (cwd === undefined) cwd = row.cwd;
      continue;
    }
    if (row?.type !== "message") continue;

    const payload = row.message;
    const role = payload?.role === "user" ? "user" : payload?.role === "assistant" ? "ai" : null;
    if (!role) continue; // toolResult 等

    let text = textParts(payload.content);
    if (role === "user") text = cleanUserMessageContent(text);
    if (!text) continue; // 纯 thinking / 纯 toolCall 轮，或清洗后只剩注入块

    const timestamp = isoTimestamp(row.timestamp) ?? epochToIso(payload.timestamp);
    if (timestamp) sawSourceTime = true;
    messages.push(makeMessage(role, text, timestamp ?? new Date().toISOString()));
  }

  if (messages.length === 0) throw new EmptyPayloadError("pi raw payload contains no messages");

  const conv = buildConversation({
    platform: "Pi",
    date: sessionDate,
    messages,
    fallbackTitle: "Pi Conversation",
    // 来源项目：session 行自带真实 cwd，无需反解目录名（spec conversation-project-attribution）
    sourceProject: sourceProjectFromCwd(cwd),
  });
  if (sessionDate || sawSourceTime) conv.dateFromSource = true;
  return [conv];
}
