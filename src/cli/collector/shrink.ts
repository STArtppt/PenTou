/**
 * shrink.ts
 * 超限会话的确定性瘦身（spec collector-oversize-ingest §4.5 决策 4，纯函数、可单测）。
 *
 * 两阶段：
 * 1. 单消息内容超过 MESSAGE_CONTENT_CAP 时截断并追加标记；
 * 2. 整体仍超预算时，从最旧的非 U1 消息起整条移除，在移除处插入一条占位消息。
 *
 * 指纹保护（src/server/dedup.ts：fingerprint = platform + title + U1）：
 * title 不动；U1（首条用户消息）仅自身超 cap 才被截断。
 * 同一输入产出一致的 role/content 序列 → 重复上报被服务端 contentHash skip。
 */

export const MESSAGE_CONTENT_CAP = 256 * 1024;

interface ShrinkableMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

interface ShrinkableConversation {
  messages: ShrinkableMessage[];
  [key: string]: unknown;
}

export interface ShrinkResult {
  conversation: ShrinkableConversation;
  truncatedMessages: number;
  removedMessages: number;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

/** 按 UTF-8 字节上限截断；确定性，且不在代理对中间断开。 */
export function truncateContent(content: string, capBytes: number): string {
  let out = content;
  let bytes = byteLength(out);
  while (bytes > capBytes) {
    // 按超出比例收缩字符数，至多数轮收敛；每轮至少去掉 1 个字符防死循环
    const keep = Math.min(out.length - 1, Math.floor((out.length * capBytes) / bytes));
    out = out.slice(0, Math.max(0, keep));
    bytes = byteLength(out);
  }
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1); // 孤立高代理
  return out;
}

function truncationMarker(originalChars: number): string {
  return `\n\n> [pentou-cli 截断：原始 ${originalChars} 字符]`;
}

function makePlaceholder(removedCount: number, timestamp: unknown): ShrinkableMessage {
  return {
    id: "msg_pentou_omitted",
    role: "ai",
    content: `> [pentou-cli 省略中部 ${removedCount} 条消息]`,
    ...(typeof timestamp === "string" ? { timestamp } : {}),
  };
}

function conversationBytes(conv: ShrinkableConversation): number {
  return byteLength(JSON.stringify(conv));
}

/**
 * 把会话瘦身到 budgetBytes（按 JSON 序列化后字节计）以内。
 * 理论保底为「U1（截断后）+ 占位 + 尾部若干」；若连保底都超预算（实际不可达，
 * cap 远小于预算），返回的 conversation 仍会超限，由调用方按 error 处理（spec §5 异常 2）。
 */
export function shrinkConversation(conv: ShrinkableConversation, budgetBytes: number): ShrinkResult {
  const original = conv.messages ?? [];

  // ── 阶段一：单消息截断 ──────────────────────────────────────────────────
  let truncatedMessages = 0;
  const capped = original.map((message) => {
    if (typeof message.content !== "string" || byteLength(message.content) <= MESSAGE_CONTENT_CAP) {
      return message;
    }
    truncatedMessages += 1;
    const marker = truncationMarker(message.content.length);
    const body = truncateContent(message.content, MESSAGE_CONTENT_CAP - byteLength(marker));
    return { ...message, content: body + marker };
  });

  let out: ShrinkableConversation = { ...conv, messages: capped };
  if (conversationBytes(out) <= budgetBytes) {
    return { conversation: out, truncatedMessages, removedMessages: 0 };
  }

  // ── 阶段二：从最旧的非 U1 消息起整条移除 ────────────────────────────────
  // 每条消息的序列化成本预计算（含数组分隔逗号），避免逐次全量重序列化
  const u1Index = capped.findIndex((message) => message.role === "user");
  const emptyBytes = conversationBytes({ ...conv, messages: [] });
  const messageBytes = capped.map((message) => byteLength(JSON.stringify(message)) + 1);

  const removable: number[] = [];
  for (let i = 0; i < capped.length; i++) {
    if (i !== u1Index) removable.push(i);
  }

  // 按 removable 升序移除（即最旧优先），首个被移除的恒为 removable[0]；
  // 用运行总量递减代替逐轮全量重算，避免海量小消息时 O(n²)
  const firstRemovedTimestamp = capped[removable[0]]?.timestamp;
  const placeholderBytes = (count: number): number =>
    byteLength(JSON.stringify(makePlaceholder(count, firstRemovedTimestamp))) + 1;

  let keptTotal = emptyBytes;
  for (const size of messageBytes) keptTotal += size;

  let removedMessages = 0;
  const removed = new Set<number>();
  for (const index of removable) {
    if (keptTotal + (removedMessages > 0 ? placeholderBytes(removedMessages) : 0) <= budgetBytes) break;
    removed.add(index);
    keptTotal -= messageBytes[index];
    removedMessages += 1;
  }

  if (removedMessages === 0) {
    return { conversation: out, truncatedMessages, removedMessages };
  }

  // 在首个被移除消息的位置插入占位，保持其余顺序
  const placeholder = makePlaceholder(removedMessages, firstRemovedTimestamp);
  const messages: ShrinkableMessage[] = [];
  let placed = false;
  for (let i = 0; i < capped.length; i++) {
    if (removed.has(i)) {
      if (!placed) {
        messages.push(placeholder);
        placed = true;
      }
      continue;
    }
    messages.push(capped[i]);
  }
  out = { ...conv, messages };
  return { conversation: out, truncatedMessages, removedMessages };
}
