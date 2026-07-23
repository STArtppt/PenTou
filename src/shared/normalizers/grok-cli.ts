/**
 * Grok CLI chat_history.jsonl normalizer（spec collector-source-expansion US-02）。
 * 行格式：{ type: "system"|"user"|"assistant"|"reasoning", content }；
 * - user 的 content 为 [{type:"text",text}] 数组，真实提问包在 <user_query> 内；
 * - 带 synthetic_reason 的 user 行是注入的系统提醒，不是用户发言；
 * - 无 synthetic_reason 的纯 <user_info>/<git_status> 等注入行也丢弃（cleanUserMessageContent）；
 * - assistant 的 content 可能为空串（纯工具调用轮）。
 * 行内无时间戳：date 由服务端落库时间兜底。
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildConversation, EmptyPayloadError, makeMessage } from "./util.js";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/;

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function normalizeGrokCli(data: string): Conversation[] {
  const lines = data.split("\n").filter((line) => line.trim());
  const messages: Message[] = [];
  const now = new Date().toISOString();

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user" && !obj.synthetic_reason) {
      let text = contentText(obj.content).trim();
      const query = USER_QUERY_RE.exec(text);
      // 有 <user_query> 时只取真实提问；否则完整清洗（user_info / git_status 等）
      text = query ? query[1].trim() : cleanUserMessageContent(text);
      if (text) messages.push(makeMessage("user", text, now));
    } else if (obj.type === "assistant") {
      const text = contentText(obj.content).trim();
      if (text) messages.push(makeMessage("ai", text, now));
    }
  }

  if (messages.length === 0) throw new EmptyPayloadError("grok-cli raw payload contains no messages");
  return [buildConversation({ platform: "Grok", messages, fallbackTitle: "Grok Conversation" })];
}
