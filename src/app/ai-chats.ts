export type AiSidebarMessageStatus = "streaming" | "done" | "aborted" | "error";

/** 检索命中来源（ask-ai-context 检索增强；实时会话内展示，不持久化到 md）。 */
export interface AiCitation {
  type: "conversation" | "document";
  id: string;
  title: string;
}

export interface AiSidebarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: AiSidebarMessageStatus;
  error?: string;
  contextLabel?: string;
  /** 检索增强（transient）：语义检索状态与命中片段。 */
  retrievalStatus?: "searching" | "done";
  retrievalCount?: number;
  citations?: AiCitation[];
}

export interface AiChatSession {
  id: string;
  title: string;
  messages: AiSidebarMessage[];
  createdAt: string;
  updatedAt: string;
  model?: string;
  contextType?: "chat" | "doc";
  contextId?: string;
}

const AI_CHAT_ID_RE = /^chat_[a-zA-Z0-9_]+$/;
const MSG_START_RE = /^<!--\s*ai-msg\s+([^>]*)-->\s*$/gm;
const MSG_END_RE = /^<!--\s*\/ai-msg\s*-->\s*$/m;

export function generateAiChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateAiMessageId(): string {
  return `aimsg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function isValidAiChatId(id: string): boolean {
  return AI_CHAT_ID_RE.test(id);
}

export function createEmptyAiChatSession(now = new Date().toISOString()): AiChatSession {
  return {
    id: generateAiChatId(),
    title: "",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveAiChatTitle(question: string): string {
  const line = question.split("\n").map((part) => part.trim()).find(Boolean) ?? "New chat";
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

function escapeFrontmatterValue(value: string): string {
  if (!value) return '""';
  if (value.includes('"') || value.includes("\n") || value.includes(":")) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function unescapeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s]+))/g;
  for (const match of raw.matchAll(re)) {
    attrs[match[1]] = unescapeAttr(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

export function aiChatSessionToMd(session: AiChatSession): string {
  const lines = ["---"];
  lines.push(`id: ${escapeFrontmatterValue(session.id)}`);
  lines.push(`title: ${escapeFrontmatterValue(session.title || "New chat")}`);
  lines.push(`createdAt: ${escapeFrontmatterValue(session.createdAt)}`);
  lines.push(`updatedAt: ${escapeFrontmatterValue(session.updatedAt)}`);
  if (session.model) lines.push(`model: ${escapeFrontmatterValue(session.model)}`);
  if (session.contextType) lines.push(`contextType: ${escapeFrontmatterValue(session.contextType)}`);
  if (session.contextId) lines.push(`contextId: ${escapeFrontmatterValue(session.contextId)}`);
  lines.push("---", "");

  for (const message of session.messages) {
    const attrs = [
      `role=${message.role}`,
      `id=${escapeAttr(message.id)}`,
      `status=${message.status}`,
      message.error ? `error="${escapeAttr(message.error)}"` : "",
      message.contextLabel ? `contextLabel="${escapeAttr(message.contextLabel)}"` : "",
    ].filter(Boolean);
    lines.push(`<!-- ai-msg ${attrs.join(" ")} -->`);
    lines.push(message.content ?? "");
    lines.push("<!-- /ai-msg -->", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function parseAiChatSessionMd(id: string, content: string): AiChatSession {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const now = new Date().toISOString();
  if (!fmMatch) {
    return { id, title: id, messages: [], createdAt: now, updatedAt: now };
  }

  const meta: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) meta[match[1]] = unescapeFrontmatterValue(match[2]);
  }

  const body = fmMatch[2] ?? "";
  const starts = [...body.matchAll(MSG_START_RE)];
  const messages: AiSidebarMessage[] = [];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const attrs = parseAttrs(start[1]);
    const contentStart = (start.index ?? 0) + start[0].length;
    const rest = body.slice(contentStart);
    const end = rest.match(MSG_END_RE);
    const contentEnd = end?.index ?? (i + 1 < starts.length ? (starts[i + 1].index ?? body.length) - contentStart : rest.length);
    const rawContent = rest.slice(0, contentEnd).replace(/^\n/, "").replace(/\n$/, "");
    const role = attrs.role === "user" ? "user" : "assistant";
    const status = isAiMessageStatus(attrs.status) ? attrs.status : "done";
    messages.push({
      id: attrs.id || generateAiMessageId(),
      role,
      status,
      content: rawContent,
      error: attrs.error || undefined,
      contextLabel: attrs.contextLabel || undefined,
    });
  }

  return {
    id: meta.id || id,
    title: meta.title || "New chat",
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || now,
    model: meta.model || undefined,
    contextType: meta.contextType === "chat" || meta.contextType === "doc" ? meta.contextType : undefined,
    contextId: meta.contextId || undefined,
    messages,
  };
}

function isAiMessageStatus(value: string | undefined): value is AiSidebarMessageStatus {
  return value === "streaming" || value === "done" || value === "aborted" || value === "error";
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export async function listSessions(): Promise<AiChatSession[]> {
  return apiFetch("/api/ai-chats") as Promise<AiChatSession[]>;
}

export async function getSession(id: string): Promise<AiChatSession> {
  return apiFetch(`/api/ai-chats/${encodeURIComponent(id)}`) as Promise<AiChatSession>;
}

export async function saveSession(session: AiChatSession): Promise<void> {
  await apiFetch(`/api/ai-chats/${encodeURIComponent(session.id)}`, {
    method: "PUT",
    body: JSON.stringify(session),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch(`/api/ai-chats/${encodeURIComponent(id)}`, { method: "DELETE" });
}
