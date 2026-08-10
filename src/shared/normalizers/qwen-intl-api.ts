/**
 * Qwen 国际站（chat.qwen.ai）raw normalizer。
 * Open WebUI 形态：data.chat.history.messages map 或 data.chat.messages 数组。
 * 助手正文在 content_list[] phase==="answer"（content 字段恒为空串）。
 * thinking_summary + reasoning_content → reasoning.thinking（spec message-reasoning）。
 */
import type { Conversation, Message } from "../../app/data.js";
import { buildReasoning } from "../reasoning.js";
import { makeConvId, makeMessage, titleFromMessages } from "./util.js";

function assistantParts(msg: any): { body: string; think: string } {
  // 勿取 content——实测助手 content 恒为空串
  const list = Array.isArray(msg?.content_list) ? msg.content_list : [];
  const answers = list
    .filter((p: any) => p?.phase === "answer" && typeof p?.content === "string")
    .map((p: any) => p.content.trim())
    .filter(Boolean);
  const thinkParts = list
    .filter((p: any) => p?.phase === "thinking_summary" && typeof p?.content === "string")
    .map((p: any) => p.content.trim())
    .filter(Boolean);

  if (typeof msg?.reasoning_content === "string" && msg.reasoning_content.trim()) {
    thinkParts.push(msg.reasoning_content.trim());
  }

  let body = answers.join("\n\n").trim();
  // 极少数形态可能把正文放在 content
  if (!body && typeof msg?.content === "string" && msg.content.trim()) {
    body = msg.content.trim();
  }
  return { body, think: thinkParts.join("\n\n").trim() };
}

function userContent(msg: any): string {
  if (typeof msg?.content === "string" && msg.content.trim()) return msg.content.trim();
  return "";
}

function collectFromArray(rawMessages: any[], fallbackDate: string): Message[] {
  const messages: Message[] = [];
  for (const raw of rawMessages) {
    const roleRaw = String(raw?.role ?? "").toLowerCase();
    const ts =
      typeof raw?.timestamp === "number"
        ? new Date(raw.timestamp * 1000).toISOString()
        : fallbackDate;

    if (roleRaw === "user") {
      const content = userContent(raw);
      if (content) messages.push(makeMessage("user", content, ts));
      continue;
    }
    if (roleRaw === "assistant") {
      const { body, think } = assistantParts(raw);
      if (!body) continue; // content 为空不因 reasoning 复活
      const reasoning = buildReasoning(undefined, think || undefined);
      messages.push(makeMessage("ai", body, ts, reasoning));
    }
  }
  return messages;
}

function collectFromMap(map: Record<string, any>, currentId: string | null, fallbackDate: string): Message[] {
  // 优先走 parentId 链：从 currentId 回溯到根，再正序输出
  if (currentId && map[currentId]) {
    const chain: any[] = [];
    let cursor: string | null = currentId;
    const seen = new Set<string>();
    while (cursor && map[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(map[cursor]);
      cursor = map[cursor].parentId ?? null;
    }
    chain.reverse();
    return collectFromArray(chain, fallbackDate);
  }

  // 无 currentId 时按 timestamp 排序
  const all = Object.values(map).sort(
    (a: any, b: any) => Number(a?.timestamp ?? 0) - Number(b?.timestamp ?? 0),
  );
  return collectFromArray(all, fallbackDate);
}

export function normalizeQwenIntlApi(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("qwen-intl raw payload is not valid JSON");
  }

  const chat = json?.data?.chat ?? json?.chat ?? json?.data;
  const fallbackDate = new Date().toISOString();

  let messages: Message[] = [];

  // 数组形态优先（同批 data.chat.messages）
  if (Array.isArray(chat?.messages) && chat.messages.length > 0) {
    messages = collectFromArray(chat.messages, fallbackDate);
  } else if (chat?.history?.messages && typeof chat.history.messages === "object") {
    messages = collectFromMap(
      chat.history.messages,
      typeof chat.history.currentId === "string" ? chat.history.currentId : null,
      fallbackDate,
    );
  } else if (json?.data?.messages && typeof json.data.messages === "object" && !Array.isArray(json.data.messages)) {
    messages = collectFromMap(json.data.messages, null, fallbackDate);
  }

  if (messages.length === 0) {
    throw new Error("qwen-intl raw payload missing chat.history.messages / chat.messages");
  }

  const title =
    json?.data?.title ||
    chat?.title ||
    json?.title ||
    titleFromMessages(messages, "Qwen Conversation");

  return [
    {
      id: makeConvId(),
      title: String(title).trim() || "Qwen Conversation",
      platform: "Qwen",
      date: messages[0]?.timestamp || fallbackDate,
      folderId: null,
      messages,
    },
  ];
}
