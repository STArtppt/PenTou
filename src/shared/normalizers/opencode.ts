/**
 * OpenCode 会话信封 normalizer（spec collector-source-expansion US-03）。
 * 信封：{ schema:"opencode-v1", session:{title,time_created,...},
 *        messages:[{ role, time:{created}, parts:[{type:"text",text}], ... }] }
 */
import type { Conversation, Message } from "../../app/data.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage, parseEnvelope } from "./util.js";

export function normalizeOpencode(data: string): Conversation[] {
  const { session, messages: rows } = parseEnvelope(data, "opencode");
  const messages: Message[] = [];

  for (const row of rows) {
    const role = row?.role === "user" ? "user" : row?.role === "assistant" ? "ai" : null;
    if (!role) continue;
    const text = (Array.isArray(row.parts) ? row.parts : [])
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) continue; // 纯工具/步骤轮无正文
    const timestamp = epochToIso(row?.time?.created) ?? epochToIso(row?.time_created) ?? new Date().toISOString();
    messages.push(makeMessage(role, text, timestamp));
  }

  if (messages.length === 0) throw new EmptyPayloadError("opencode raw payload contains no messages");
  return [buildConversation({
    platform: "OpenCode",
    title: typeof session?.title === "string" ? session.title : undefined,
    date: epochToIso(session?.time_created),
    messages,
    fallbackTitle: "OpenCode Conversation",
  })];
}
