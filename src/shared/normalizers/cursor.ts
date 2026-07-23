/**
 * Cursor 会话信封 normalizer（spec collector-source-expansion US-06）。
 * 信封：{ schema:"cursor-v1", session:{name,createdAt,lastUpdatedAt,_v},
 *        messages:[{ bubbleId, type, text }] }；type 1=用户、2=AI。
 * composerData 的 _v 持续演进（spec §5 边界 7）：未知 type 的气泡跳过、尽力解析。
 */
import type { Conversation, Message } from "../../app/data.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage, parseEnvelope } from "./util.js";

export function normalizeCursor(data: string): Conversation[] {
  const { session, messages: bubbles } = parseEnvelope(data, "cursor");
  const timestamp = epochToIso(session?.lastUpdatedAt) ?? epochToIso(session?.createdAt) ?? new Date().toISOString();
  const messages: Message[] = [];

  for (const bubble of bubbles) {
    const role = bubble?.type === 1 ? "user" : bubble?.type === 2 ? "ai" : null;
    if (!role) continue;
    const text = typeof bubble?.text === "string" ? bubble.text.trim() : "";
    if (!text) continue;
    messages.push(makeMessage(role, text, timestamp));
  }

  if (messages.length === 0) throw new EmptyPayloadError("cursor raw payload contains no messages");
  return [buildConversation({
    platform: "Cursor",
    title: typeof session?.name === "string" ? session.name : undefined,
    date: epochToIso(session?.createdAt),
    messages,
    fallbackTitle: "Cursor Conversation",
  })];
}
