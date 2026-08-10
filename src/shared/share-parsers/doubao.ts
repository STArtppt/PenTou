/**
 * 豆包分享态 turn 映射真源。
 * 仅服务分享页 `message_snapshot.message_list[]`；登录态是另一套 content_block 结构
 * （见 normalizers/doubao-api.ts），两侧共用 user_type / 定序 / 时间戳约定，不共用映射函数。
 *
 * reasoning：10025 / search_query_result_block → search；thinking_content → thinking
 * （spec message-reasoning；与登录态共用 renderDoubaoSearchBlock）。
 */
import type { MessageReasoning } from "../../app/data.js";
import { buildReasoning, renderDoubaoSearchBlock } from "../reasoning.js";

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makeId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeMsg(
  role: "user" | "ai",
  content: string,
  timestamp: string,
  reasoning?: MessageReasoning,
) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp,
    ...(reasoning ? { reasoning } : {}),
  };
}

/** 从图片对象按优先级取 URL（spec media-assets §4.5：原图 → 预览图 → 缩略图）。 */
function pickImageUrl(image: any, keys: string[]): string {
  for (const key of keys) {
    const url = image?.[key]?.url;
    if (typeof url === "string" && url) return url;
  }
  return "";
}

/**
 * Doubao 结构化图片 → markdown 图片（spec media-assets §4.5 / 决策 11）。
 * attachment_block 上传图、creation_block 生成图与参考图；URL 缺失插入占位（解析期兜底）。
 */
export function extractDoubaoBlockImages(parsed: any): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (url: string, alt: string, missingText: string) => {
    if (!url) {
      parts.push(missingText);
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    parts.push(`![${alt}](${url})`);
  };

  for (const att of parsed?.attachment_block?.attachments ?? []) {
    push(pickImageUrl(att?.image, ["image_ori", "image_preview", "image_thumb"]), "附件图片", "[图片缺失]");
  }

  let genIndex = 0;
  for (const creation of parsed?.creation_block?.creations ?? []) {
    genIndex++;
    push(
      pickImageUrl(creation?.image, ["image_raw_b", "image_ori", "image_preview", "image_thumb"]),
      `生成图片 ${genIndex}`,
      "[生成图片缺失]",
    );
    for (const ref of creation?.gen_detail?.ref_images ?? []) {
      const refUrl =
        pickImageUrl(ref, ["image_ori", "image_preview", "image_thumb"]) ||
        pickImageUrl(ref?.image, ["image_ori", "image_preview", "image_thumb"]);
      if (refUrl && !seen.has(refUrl)) {
        seen.add(refUrl);
        parts.push(`![参考图](${refUrl})`);
      }
    }
  }

  return parts;
}

/** 正文块：文本 + 图片；搜索块返回空（走 reasoning）。 */
export function extractDoubaoBlockText(block: any): string {
  const candidates = [block?.content_v2, block?.content];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = typeof candidate === "string" ? tryParseJson(candidate) : candidate;
    if (!parsed) continue;

    // 搜索块不进 content
    if (parsed.search_query_result_block || Number(block?.block_type) === 10025) {
      return "";
    }

    const segments: string[] = [];
    const text = parsed?.text_block?.text || parsed?.text;
    if (typeof text === "string" && text.trim()) segments.push(text.trim());
    segments.push(...extractDoubaoBlockImages(parsed));
    if (segments.length > 0) return segments.join("\n\n");
  }

  return "";
}

function collectBlocks(message: any): any[] {
  const blocks: any[] = [];
  if (Array.isArray(message?.content_block)) {
    blocks.push(...message.content_block);
  }
  if (blocks.length === 0 && typeof message?.content === "string") {
    const parsed = tryParseJson(message.content);
    if (Array.isArray(parsed)) blocks.push(...parsed);
  }
  return blocks;
}

function extractShareSearch(message: any): string {
  const rendered: string[] = [];
  const seen = new Set<string>();
  for (const block of collectBlocks(message)) {
    const candidates = [block?.content_v2, block?.content];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = typeof candidate === "string" ? tryParseJson(candidate) : candidate;
      if (!parsed) continue;
      const isSearch =
        Number(block?.block_type) === 10025 ||
        Boolean(parsed.search_query_result_block) ||
        (parsed.queries && parsed.results);
      if (!isSearch) continue;
      const md = renderDoubaoSearchBlock(parsed);
      if (!md || seen.has(md)) continue;
      seen.add(md);
      rendered.push(md);
    }
  }
  return rendered.join("\n\n").trim();
}

function extractShareThinking(message: any): string {
  return typeof message?.thinking_content === "string"
    ? message.thinking_content.trim()
    : "";
}

/** 提取正文 + reasoning（供 mapDoubaoMessageList 使用）。 */
export function extractDoubaoMessageParts(message: any): {
  content: string;
  reasoning?: MessageReasoning;
} {
  const texts: string[] = [];
  for (const block of collectBlocks(message)) {
    const text = extractDoubaoBlockText(block);
    if (text) texts.push(text);
  }
  const content = Array.from(new Set(texts)).join("\n\n").trim();
  const reasoning = buildReasoning(extractShareSearch(message), extractShareThinking(message));
  return { content, reasoning };
}

export function extractDoubaoMessageText(message: any): string {
  return extractDoubaoMessageParts(message).content;
}

/** 数字或数字字符串的定序键；取不到返回 null（交给稳定排序保留原始顺序）。 */
function numericField(message: any, keys: string[]): number | null {
  for (const key of keys) {
    const raw = message?.[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const num = Number(raw);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

/**
 * 分享态 message_list[] → messages（user_type 1=用户 / 其余助手；index 升序；create_time 秒级）。
 * 2026-08 起豆包把 index / create_time 下发成字符串，且分享载荷只有 index_in_conv 没有 index，
 * 故定序与时间戳都按「数字或数字字符串」取，取不到才回退原顺序 / fallbackDate。
 */
export function mapDoubaoMessageList(messageList: any[], fallbackDate = new Date().toISOString()) {
  return messageList
    .slice()
    .sort((a: any, b: any) => (numericField(a, ["index", "index_in_conv"]) ?? 0) - (numericField(b, ["index", "index_in_conv"]) ?? 0))
    .map((message: any) => {
      const { content, reasoning } = extractDoubaoMessageParts(message);
      if (!content) return null;
      const createTime = numericField(message, ["create_time"]);
      const timestamp =
        createTime && createTime > 0
          ? new Date(createTime > 10_000_000_000 ? createTime : createTime * 1000).toISOString()
          : fallbackDate;
      return makeMsg(message.user_type === 1 ? "user" : "ai", content, timestamp, reasoning);
    })
    .filter(Boolean) as Array<{
      id: string;
      role: "user" | "ai";
      content: string;
      timestamp: string;
      reasoning?: MessageReasoning;
    }>;
}

/** 从分享页已解出的 shareData 生成 Conversation 数组（与 parseDoubaoShare 输出同构）。 */
export function conversationsFromDoubaoShareData(shareData: any, fallbackDate = new Date().toISOString()) {
  const messageList = shareData?.message_snapshot?.message_list;
  if (!Array.isArray(messageList) || messageList.length === 0) return null;

  const messages = mapDoubaoMessageList(messageList, fallbackDate);
  if (messages.length === 0) return null;

  return [
    {
      id: makeId(),
      title: shareData.share_info?.share_name || "Doubao Shared Conversation",
      platform: "Doubao",
      date: fallbackDate,
      folderId: null,
      messages,
    },
  ];
}
