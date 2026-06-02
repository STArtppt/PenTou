/**
 * dedup.ts
 * 导入去重指纹工具（纯函数，可单测）。spec: import-dedup-versioning §4.3。
 *
 * - fingerprint：逻辑身份键。命中即视为「同一逻辑项」（同一段对话 / 同一篇文档）。
 *   对话锚点为「首条用户消息 U1」——U1 在任意轮次追加后都不变，故 1 轮、N 轮统一稳定，
 *   单轮会话续聊后重导也能命中（spec 决策1）。
 * - contentHash：精确内容键。两者都相同则内容完全一致，导入时跳过、不产生空版本。
 */
import crypto from "node:crypto";

const SEP = "\u0000"; // NUL 分隔字段，避免拼接碰撞

export interface DedupSignature {
  fingerprint: string;
  contentHash: string;
}

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

/** 归一化：trim + 折叠所有空白（含换行）为单个空格。 */
export function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

// ── 对话 ────────────────────────────────────────────────────────────────────

interface ConvMessage {
  role: "user" | "ai";
  content: string;
}

interface ConversationLike {
  platform?: string;
  title?: string;
  messages?: ConvMessage[];
}

function firstUserMessage(messages: ConvMessage[]): string {
  const u1 = messages.find((m) => m.role === "user");
  return u1 ? normalizeText(u1.content) : "";
}

export function conversationSignature(conv: ConversationLike): DedupSignature {
  const platform = normalizeText(conv.platform);
  const title = normalizeText(conv.title);
  const messages = conv.messages ?? [];
  const u1 = firstUserMessage(messages);

  // fingerprint = platform + 归一化 title + 首条用户消息 U1（无用户消息时 U1 段为空）
  const fingerprint = sha1([platform, title, u1].join(SEP));
  // contentHash = 全部 messages 归一化序列（role + content）
  const contentHash = sha1(
    messages.map((m) => `${m.role}${SEP}${normalizeText(m.content)}`).join("\n"),
  );

  return { fingerprint, contentHash };
}

/**
 * 是否参与去重。标题与首条用户消息都为空时（如纯助手内容），指纹退化为仅 platform，
 * 会让无关条目互相误合并 → 视为不可去重，直接新建（spec §5 边界·无用户消息）。
 */
export function conversationDedupable(conv: ConversationLike): boolean {
  const title = normalizeText(conv.title);
  const u1 = firstUserMessage(conv.messages ?? []);
  return Boolean(title || u1);
}

// ── 文档 ────────────────────────────────────────────────────────────────────

interface DocumentLike {
  title?: string;
  body?: string;
}

/** 正文起始指纹：取正文前 2 个非空块（按空行分段）归一化后哈希。 */
export function leadingBodyDigest(body: string | undefined | null): string {
  const blocks = (body ?? "")
    .split(/\n\s*\n/)
    .map((b) => normalizeText(b))
    .filter(Boolean);
  return sha1(blocks.slice(0, 2).join(SEP));
}

export function documentSignature(doc: DocumentLike): DedupSignature {
  const title = normalizeText(doc.title);
  const leading = leadingBodyDigest(doc.body);

  // fingerprint = 归一化 title + 正文起始指纹（spec 决策2）
  const fingerprint = sha1([title, leading].join(SEP));
  const contentHash = sha1(normalizeText(doc.body));

  return { fingerprint, contentHash };
}

/** 标题与正文都为空时不参与去重（避免空指纹互相误合并）。 */
export function documentDedupable(doc: DocumentLike): boolean {
  return Boolean(normalizeText(doc.title) || normalizeText(doc.body));
}
