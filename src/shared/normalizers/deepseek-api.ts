/**
 * DeepSeek conversation API normalizer.
 *
 * Supports the existing export-style mapping tree plus the API/share-style
 * `biz_data.messages[]` shape observed in url-import-guide / obscura.
 */
import type { Conversation, Message } from "../../app/data.js";
import { parseDeepSeekExport } from "../parsers.js";

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function fragmentText(fragments: any[]): { content: string; think: string } {
  const parts: string[] = [];
  const thoughts: string[] = [];

  for (const frag of fragments) {
    const text = typeof frag?.content === "string" ? frag.content : typeof frag?.text === "string" ? frag.text : "";
    if (!text) continue;
    if (frag?.type === "THINK") thoughts.push(text);
    else parts.push(text);
  }

  return { content: parts.join("\n").trim(), think: thoughts.join("\n").trim() };
}

function messageRole(raw: any): "user" | "ai" {
  const role = String(raw?.role ?? raw?.message_role ?? raw?.type ?? "").toLowerCase();
  if (role === "user" || role === "request" || role === "human") return "user";
  return "ai";
}

function toMessage(raw: any, fallbackDate: string): Message | null {
  const role = messageRole(raw);
  let content = "";
  let think = "";

  if (Array.isArray(raw?.fragments)) {
    const out = fragmentText(raw.fragments);
    content = out.content;
    think = out.think;
  } else if (Array.isArray(raw?.message?.fragments)) {
    const out = fragmentText(raw.message.fragments);
    content = out.content;
    think = out.think;
  } else {
    content = typeof raw?.content === "string" ? raw.content : typeof raw?.text === "string" ? raw.text : "";
  }

  let finalContent = content.trim();
  if (think.trim()) {
    const quoted = think.split("\n").map((line) => `> ${line}`).join("\n");
    finalContent = `> [!NOTE]\n> **Thinking Process**\n${quoted}\n\n${finalContent}`.trim();
  }
  if (!finalContent) return null;

  return {
    id: makeId("msg"),
    role,
    content: finalContent,
    timestamp: normalizeTimestamp(raw?.inserted_at ?? raw?.created_at ?? raw?.create_time ?? raw?.timestamp, fallbackDate),
  };
}

function normalizeBizData(root: any): Conversation[] {
  const data = root?.data?.biz_data ?? root?.biz_data ?? root?.conversation ?? root;
  if (!Array.isArray(data?.messages)) return [];

  const fallbackDate = normalizeTimestamp(
    data?.inserted_at ?? data?.created_at ?? data?.updated_at ?? root?.created_at,
    new Date().toISOString(),
  );
  const messages = data.messages.map((m: any) => toMessage(m, fallbackDate)).filter(Boolean) as Message[];
  if (messages.length === 0) return [];

  const firstUser = messages.find((m) => m.role === "user");
  const genericTitle = data?.title === "Shared Conversation" ? "" : data?.title;
  const title = String(genericTitle || firstUser?.content.slice(0, 80).split("\n")[0] || "DeepSeek Conversation").trim();

  return [{
    id: makeId("conv"),
    title,
    platform: "DeepSeek",
    date: fallbackDate,
    folderId: null,
    messages,
  }];
}

export function normalizeDeepSeekApi(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("deepseek raw payload is not valid JSON");
  }

  const exportLike = json?.mapping ? parseDeepSeekExport([json]) : [];
  if (exportLike.length > 0) return exportLike;

  const bizData = normalizeBizData(json);
  if (bizData.length > 0) return bizData;

  throw new Error("deepseek raw payload missing mapping or biz_data.messages");
}
