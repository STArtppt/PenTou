/**
 * Hermes 会话信封 normalizer（spec collector-source-expansion US-05）。
 * 信封：{ schema:"hermes-v1", session:{title,started_at,...},
 *        messages:[{ role:"user"|"assistant", content, timestamp }] }
 * started_at / timestamp 为 epoch 秒（REAL）。
 * 兼容：非信封 payload（Hermes 导出 JSON 等历史用法）回退既有 parseHermesExport。
 * 用户侧清洗：丢弃 `# Instructions…` 技能注入等（与 Codex 同构）。
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { parseHermesExport } from "../parsers.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage, parseEnvelope } from "./util.js";

function isEnvelope(data: string): boolean {
  try {
    const json = JSON.parse(data);
    return typeof json?.schema === "string" && json.schema.startsWith("hermes");
  } catch {
    return false;
  }
}

export function normalizeHermes(data: string): Conversation[] {
  if (!isEnvelope(data)) {
    const conversations = parseHermesExport(JSON.parse(data));
    if (conversations.length === 0) throw new EmptyPayloadError("hermes raw payload contains no messages");
    // 导出回退路径也清洗用户消息，与信封路径一致
    for (const conv of conversations) {
      conv.messages = conv.messages
        .map((m) =>
          m.role === "user" ? { ...m, content: cleanUserMessageContent(m.content) } : m,
        )
        .filter((m) => m.content.trim());
    }
    return conversations.filter((c) => c.messages.length > 0);
  }
  const { session, messages: rows } = parseEnvelope(data, "hermes");
  const messages: Message[] = [];

  for (const row of rows) {
    const role = row?.role === "user" ? "user" : row?.role === "assistant" ? "ai" : null;
    if (!role) continue;
    const raw = typeof row?.content === "string" ? row.content : "";
    const text = role === "user" ? cleanUserMessageContent(raw) : raw.trim();
    if (!text) continue;
    messages.push(makeMessage(role, text, epochToIso(row?.timestamp) ?? new Date().toISOString()));
  }

  if (messages.length === 0) throw new EmptyPayloadError("hermes raw payload contains no messages");
  return [buildConversation({
    platform: "Hermes",
    title: typeof session?.title === "string" ? session.title : undefined,
    date: epochToIso(session?.started_at),
    messages,
    fallbackTitle: "Hermes Conversation",
  })];
}
