/**
 * GitHub Copilot 共库会话信封 normalizer（spec collector-source-expansion US-04）。
 * 信封：{ schema:"copilot-v1", session:{summary,created_at,...},
 *        messages:[{ turn_index, user_message, assistant_response, timestamp }] }
 * timestamp 为 sqlite datetime("YYYY-MM-DD HH:MM:SS"，UTC）或 ISO 串。
 */
import type { Conversation, Message } from "../../app/data.js";
import { buildConversation, makeMessage, parseEnvelope } from "./util.js";

function sqliteUtcToIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeCopilot(data: string): Conversation[] {
  const { session, messages: turns } = parseEnvelope(data, "copilot");
  const messages: Message[] = [];

  for (const turn of turns) {
    const timestamp = sqliteUtcToIso(turn?.timestamp) ?? new Date().toISOString();
    const userText = typeof turn?.user_message === "string" ? turn.user_message.trim() : "";
    const aiText = typeof turn?.assistant_response === "string" ? turn.assistant_response.trim() : "";
    if (userText) messages.push(makeMessage("user", userText, timestamp));
    if (aiText) messages.push(makeMessage("ai", aiText, timestamp));
  }

  if (messages.length === 0) throw new Error("copilot raw payload contains no messages");
  return [buildConversation({
    platform: "Copilot",
    title: typeof session?.summary === "string" ? session.summary : undefined,
    date: sqliteUtcToIso(session?.created_at),
    messages,
    fallbackTitle: "Copilot Conversation",
  })];
}
