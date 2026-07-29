/**
 * Grok CLI chat_history.jsonl normalizer（spec collector-source-expansion US-02）。
 * 行格式：{ type: "system"|"user"|"assistant"|"reasoning", content }；
 * - user 的 content 为 [{type:"text",text}] 数组，真实提问包在 <user_query> 内；
 * - 带 synthetic_reason 的 user 行是注入的系统提醒，不是用户发言；
 * - 无 synthetic_reason 的纯 <user_info>/<git_status> 等注入行也丢弃（cleanUserMessageContent）；
 * - assistant 的 content 可能为空串（纯工具调用轮）。
 *
 * 载荷两种形态：
 * 1. grok-cli-v1 信封（adapter 产出）：
 *    { schema, session, turns?: GrokTurnWindow[], history }
 *    → 会话 date 用 session.created_at；消息时间按 turns 与「真实 user 切轮」对齐
 * 2. 旧版纯 jsonl 字符串 → 无源时间，落库时间兜底
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildConversation, EmptyPayloadError, makeMessage } from "./util.js";
import { sourceProjectFromCwd } from "../source-project.js";

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

/** ISO / 可被 Date 解析的字符串 → ISO；非法返回 undefined */
export function parseGrokTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** events.jsonl 中一个 turn 的时间窗（adapter 解析后塞进信封） */
export interface GrokTurnWindow {
  turnNumber?: number;
  startedAt: string;
  firstTokens: string[];
  endedAt?: string;
}

/**
 * 从 events.jsonl 文本抽出 turn 窗口。
 * 只关心 turn_started / first_token / turn_ended，流式扫行，忽略 phase_changed 等噪声。
 */
export function parseGrokTurns(eventsText: string): GrokTurnWindow[] {
  const turns: GrokTurnWindow[] = [];
  let cur: GrokTurnWindow | null = null;
  for (const line of eventsText.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const type = obj?.type;
    const ts = typeof obj?.ts === "string" ? obj.ts.trim() : "";
    if (!ts) continue;
    if (type === "turn_started") {
      cur = {
        turnNumber: typeof obj.turn_number === "number" ? obj.turn_number : undefined,
        startedAt: ts,
        firstTokens: [],
      };
      turns.push(cur);
    } else if (type === "first_token" && cur) {
      cur.firstTokens.push(ts);
    } else if (type === "turn_ended" && cur) {
      if (!cur.endedAt) cur.endedAt = ts;
      cur = null;
    }
  }
  return turns;
}

export interface UnpackedGrokPayload {
  history: string;
  sessionDate?: string;
  title?: string;
  turns: GrokTurnWindow[];
  /** 来源项目（工作目录 basename）；旧版纯 jsonl 载荷取不到，留空 */
  sourceProject?: string;
}

function normalizeTurnWindows(raw: unknown): GrokTurnWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: GrokTurnWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const startedAt = typeof item.startedAt === "string" ? item.startedAt.trim() : "";
    if (!startedAt) continue;
    const firstTokens = Array.isArray(item.firstTokens)
      ? item.firstTokens.filter((t: unknown): t is string => typeof t === "string" && Boolean(t.trim()))
      : [];
    out.push({
      turnNumber: typeof item.turnNumber === "number" ? item.turnNumber : undefined,
      startedAt,
      firstTokens,
      endedAt: typeof item.endedAt === "string" && item.endedAt.trim() ? item.endedAt.trim() : undefined,
    });
  }
  return out;
}

/** 解包信封或回退为纯 jsonl */
export function unpackGrokCliPayload(data: string): UnpackedGrokPayload {
  const trimmed = data.trim();
  if (!trimmed.startsWith("{")) return { history: data, turns: [] };
  try {
    const json = JSON.parse(trimmed);
    if (
      json &&
      typeof json === "object" &&
      typeof json.schema === "string" &&
      json.schema.startsWith("grok-cli") &&
      typeof json.history === "string"
    ) {
      const session = json.session && typeof json.session === "object" ? json.session : {};
      const sessionDate =
        parseGrokTimestamp(session.created_at) ?? parseGrokTimestamp(session.updated_at);
      const title = typeof session.title === "string" && session.title.trim()
        ? session.title.trim()
        : undefined;
      return {
        history: json.history,
        sessionDate,
        title,
        turns: normalizeTurnWindows(json.turns),
        sourceProject: sourceProjectFromCwd(session.cwd),
      };
    }
  } catch {
    // 整段不是 JSON（多半是 jsonl）→ 当纯 history
  }
  return { history: data, turns: [] };
}

interface DraftMessage {
  role: "user" | "ai";
  content: string;
}

function extractDraftMessages(history: string): DraftMessage[] {
  const lines = history.split("\n").filter((line) => line.trim());
  const messages: DraftMessage[] = [];
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
      text = query ? query[1].trim() : cleanUserMessageContent(text);
      if (text) messages.push({ role: "user", content: text });
    } else if (obj.type === "assistant") {
      const text = contentText(obj.content).trim();
      if (text) messages.push({ role: "ai", content: text });
    }
  }
  return messages;
}

/** 每个真实 user 开启新逻辑轮；其后连续 ai 归该轮 */
export function groupMessagesByUserTurns(messages: DraftMessage[]): DraftMessage[][] {
  const groups: DraftMessage[][] = [];
  let current: DraftMessage[] | null = null;
  for (const msg of messages) {
    if (msg.role === "user") {
      current = [msg];
      groups.push(current);
    } else if (current) {
      current.push(msg);
    } else {
      current = [msg];
      groups.push(current);
    }
  }
  return groups;
}

function aiTimestampInTurn(win: GrokTurnWindow, aiIndex: number, aiTotal: number, fallback: string): string {
  const start = parseGrokTimestamp(win.startedAt) ?? fallback;
  const end = parseGrokTimestamp(win.endedAt) ?? start;
  const tokens = win.firstTokens
    .map((t) => parseGrokTimestamp(t))
    .filter((t): t is string => Boolean(t));

  if (aiTotal <= 0) return start;
  if (aiTotal === 1) return tokens[0] ?? end;

  // first_token 条数与可见 AI 条数一致时一一对应（最佳）
  if (tokens.length === aiTotal) return tokens[aiIndex] ?? end;

  // 否则在 [首 token 或 start, end] 上均匀插值
  const t0 = Date.parse(tokens[0] ?? start);
  const t1 = Date.parse(end);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return fallback;
  if (t1 <= t0) return new Date(t0).toISOString();
  const ms = t0 + ((t1 - t0) * aiIndex) / (aiTotal - 1);
  return new Date(ms).toISOString();
}

/**
 * 将逻辑轮与 events turn 窗口对齐填时间。
 * 轮次数 === windows 时按索引 zip；否则整会话回退 fallback（避免错位）。
 */
export function assignGrokMessageTimestamps(
  messages: DraftMessage[],
  turns: GrokTurnWindow[],
  fallback: string,
): Message[] {
  if (messages.length === 0) return [];
  const groups = groupMessagesByUserTurns(messages);
  if (turns.length === 0 || groups.length !== turns.length) {
    return messages.map((m) => makeMessage(m.role, m.content, fallback));
  }

  const out: Message[] = [];
  for (let i = 0; i < groups.length; i++) {
    const win = turns[i];
    const group = groups[i];
    const aiTotal = group.filter((m) => m.role === "ai").length;
    let aiIndex = 0;
    for (const m of group) {
      if (m.role === "user") {
        out.push(makeMessage("user", m.content, parseGrokTimestamp(win.startedAt) ?? fallback));
      } else {
        out.push(makeMessage("ai", m.content, aiTimestampInTurn(win, aiIndex, aiTotal, fallback)));
        aiIndex += 1;
      }
    }
  }
  return out;
}

export function normalizeGrokCli(data: string): Conversation[] {
  const { history, sessionDate, title, turns, sourceProject } = unpackGrokCliPayload(data);
  const drafts = extractDraftMessages(history);
  if (drafts.length === 0) throw new EmptyPayloadError("grok-cli raw payload contains no messages");

  const fallback = sessionDate ?? new Date().toISOString();
  const messages = assignGrokMessageTimestamps(drafts, turns, fallback);
  // 会话 date：summary 优先；否则第一轮 turn 开始；再否则 fallback
  const date =
    sessionDate ??
    parseGrokTimestamp(turns[0]?.startedAt) ??
    messages[0]?.timestamp;

  const conv = buildConversation({
    platform: "Grok",
    title,
    date,
    messages,
    fallbackTitle: "Grok Conversation",
    sourceProject,
  });
  if (sessionDate || turns.length > 0) conv.dateFromSource = true;
  return [conv];
}
