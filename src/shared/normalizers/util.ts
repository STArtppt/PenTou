/** normalizer 共用的最小构造工具（与 parsers.ts 同构，避免跨层 export 私有函数） */
import type { Conversation, Message, MessageReasoning, Platform } from "../../app/data.js";

/**
 * 空会话（载荷合法但不含任何用户/AI 消息，如只跑了 /exit 的 CLI 会话）。
 * 服务端与 CLI 降级路径据此归类为 skipped 而非 error（ingest-gateway 边界 3）。
 */
export class EmptyPayloadError extends Error {}

export function makeConvId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeMessage(
  role: "user" | "ai",
  content: string,
  timestamp: string,
  reasoning?: MessageReasoning,
): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp,
    ...(reasoning ? { reasoning } : {}),
  };
}

export function titleFromMessages(messages: Message[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === "user");
  const source = (firstUser?.content ?? messages[0]?.content ?? "").trim();
  return source.slice(0, 80).split("\n")[0] || fallback;
}

export function buildConversation(params: {
  platform: Platform;
  title?: string;
  date?: string;
  messages: Message[];
  fallbackTitle: string;
  /** 来源项目（工作目录 basename）；判定不了就不传，字段不写入（spec conversation-project-attribution） */
  sourceProject?: string;
}): Conversation {
  const date = params.date || params.messages[0]?.timestamp || new Date().toISOString();
  return {
    id: makeConvId(),
    title: params.title?.trim() || titleFromMessages(params.messages, params.fallbackTitle),
    platform: params.platform,
    date,
    folderId: null,
    messages: params.messages,
    ...(params.sourceProject ? { sourceProject: params.sourceProject } : {}),
  };
}

/** epoch 秒/毫秒宽容转 ISO；非法输入返回 undefined */
export function epochToIso(value: unknown): string | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const ms = num < 1e12 ? num * 1000 : num; // < 2001-09 的毫秒值不可能出现在这些库里，按秒解释
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** SqliteSessionEnvelope 的通用校验入口 */
export function parseEnvelope(data: string, schemaPrefix: string): { session: any; messages: any[] } {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error(`${schemaPrefix} raw payload is not valid JSON`);
  }
  if (typeof json?.schema !== "string" || !json.schema.startsWith(schemaPrefix)) {
    throw new Error(`${schemaPrefix} raw payload missing schema`);
  }
  if (!Array.isArray(json.messages)) throw new Error(`${schemaPrefix} raw payload missing messages`);
  return { session: json.session ?? {}, messages: json.messages };
}
