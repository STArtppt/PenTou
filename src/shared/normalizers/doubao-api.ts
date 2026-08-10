/**
 * 豆包登录态 raw normalizer。
 * 载荷：downlink_body.pull_singe_chain_downlink_body.messages[] + content_block[]
 * （与分享态 message_list 结构不同，独立映射；输出契约由等价性测试守住）。
 */
import type { Conversation, Message } from "../../app/data.js";
import { makeConvId, makeMessage, titleFromMessages } from "./util.js";

function pickImageUrl(image: any, keys: string[]): string {
  for (const key of keys) {
    const url = image?.[key]?.url;
    if (typeof url === "string" && url) return url;
  }
  return "";
}

function blockPayload(block: any): any {
  const raw = block?.content_v2 ?? block?.content;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/** content_block 走查：10000 文本 / 2074 生成图 / 10025 联网搜索 / 10050 富媒体 / 10052 附件。 */
function extractLoginBlockText(block: any): string {
  const type = Number(block?.block_type);
  const payload = blockPayload(block);
  if (!payload && type !== 10000) return "";

  if (type === 10000 || type === 0 || !type) {
    const text = payload?.text_block?.text || payload?.text;
    if (typeof text === "string" && text.trim()) return text.trim();
    // 个别退化形态：content 直接是字符串
    if (typeof block?.content === "string" && block.content.trim() && !block.content.startsWith("{")) {
      return block.content.trim();
    }
    return "";
  }

  if (type === 2074) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let genIndex = 0;
    for (const creation of payload?.creation_block?.creations ?? []) {
      genIndex++;
      const url = pickImageUrl(creation?.image, ["image_raw_b", "image_ori", "image_preview", "image_thumb"]);
      if (!url) {
        parts.push("[生成图片缺失]");
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      parts.push(`![生成图片 ${genIndex}](${url})`);
    }
    return parts.join("\n\n");
  }

  if (type === 10025) {
    const search = payload?.search_query_result_block ?? payload;
    const queries = Array.isArray(search?.queries)
      ? search.queries.map((q: any) => (typeof q === "string" ? q : q?.query || q?.text || "")).filter(Boolean)
      : [];
    const results = Array.isArray(search?.results)
      ? search.results
          .map((r: any) => {
            const card = r?.text_card ?? r;
            const title = card?.title || card?.name || "";
            const snippet = card?.summary || card?.text || card?.snippet || "";
            return [title, snippet].filter(Boolean).join(" — ");
          })
          .filter(Boolean)
      : [];
    const lines = [
      queries.length ? `搜索：${queries.join("；")}` : "",
      ...results.slice(0, 8),
    ].filter(Boolean);
    return lines.join("\n");
  }

  if (type === 10050) {
    const parts: string[] = [];
    for (const creation of payload?.rich_media_block?.creations ?? []) {
      const title = creation?.title || creation?.name || "";
      const url =
        creation?.url ||
        creation?.video?.url ||
        creation?.cover?.url ||
        pickImageUrl(creation?.image, ["image_ori", "image_preview", "image_thumb"]);
      if (title && url) parts.push(`[${title}](${url})`);
      else if (url) parts.push(url);
      else if (title) parts.push(title);
    }
    return parts.join("\n\n");
  }

  if (type === 10052) {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const att of payload?.attachment_block?.attachments ?? []) {
      const url = pickImageUrl(att?.image, ["image_ori", "image_preview", "image_thumb"]);
      if (!url) {
        parts.push("[图片缺失]");
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      parts.push(`![附件图片](${url})`);
    }
    return parts.join("\n\n");
  }

  // 未知 block：尽量捞文本
  const fallback = payload?.text_block?.text || payload?.text;
  return typeof fallback === "string" ? fallback.trim() : "";
}

function extractLoginMessageContent(message: any): string {
  const blocks = Array.isArray(message?.content_block) ? message.content_block : [];
  const texts = blocks.map(extractLoginBlockText).filter(Boolean);
  if (texts.length > 0) return Array.from(new Set(texts)).join("\n\n").trim();

  // 降级：content 字段可能是 {"text":"..."} 字符串
  if (typeof message?.content === "string" && message.content.trim()) {
    try {
      const parsed = JSON.parse(message.content);
      if (typeof parsed?.text === "string") return parsed.text.trim();
    } catch {
      return message.content.trim();
    }
  }
  return "";
}

function hasNonEmptyContentBlock(messages: any[]): boolean {
  return messages.some((m) => {
    const blocks = m?.content_block;
    if (!Array.isArray(blocks) || blocks.length === 0) return false;
    return blocks.some((b: any) => extractLoginBlockText(b).length > 0);
  });
}

function normalizeCreateTime(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return new Date(num > 10_000_000_000 ? num : num * 1000).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

export function normalizeDoubaoApi(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("doubao raw payload is not valid JSON");
  }

  const body =
    json?.downlink_body?.pull_singe_chain_downlink_body ??
    json?.pull_singe_chain_downlink_body ??
    json;
  const rawMessages = body?.messages;
  if (!Array.isArray(rawMessages)) {
    throw new Error("doubao raw payload missing pull_singe_chain_downlink_body.messages");
  }

  // 2xx 静默降级：content_block 全空 → 失败（spec platform-raw-normalizers）
  if (rawMessages.length > 0 && !hasNonEmptyContentBlock(rawMessages)) {
    // 允许 content 字段兜底有正文的退化形态
    const hasText = rawMessages.some((m: any) => extractLoginMessageContent(m).length > 0);
    if (!hasText) {
      throw new Error("doubao raw payload has empty content_block (degraded response)");
    }
  }
  if (rawMessages.length === 0) {
    throw new Error("doubao raw payload messages is empty");
  }

  const fallbackDate = new Date().toISOString();
  // index_in_conv 倒序（新→旧），反转为旧→新
  const ordered = rawMessages.slice().sort((a: any, b: any) => {
    const ai = Number(a?.index_in_conv ?? a?.index ?? 0);
    const bi = Number(b?.index_in_conv ?? b?.index ?? 0);
    return ai - bi;
  });

  const messages: Message[] = [];
  for (const raw of ordered) {
    const content = extractLoginMessageContent(raw);
    if (!content) continue;
    const role: "user" | "ai" = Number(raw?.user_type) === 1 ? "user" : "ai";
    const timestamp = normalizeCreateTime(raw?.create_time, fallbackDate);
    messages.push(makeMessage(role, content, timestamp));
  }

  if (messages.length === 0) {
    throw new Error("doubao raw payload did not contain any message text");
  }

  const sourceDate =
    body?.conversation?.create_time ??
    body?.create_time ??
    json?.create_time ??
    ordered[0]?.create_time;
  const date = sourceDate ? normalizeCreateTime(sourceDate, messages[0].timestamp) : messages[0].timestamp;

  const conv: Conversation = {
    id: makeConvId(),
    title: titleFromMessages(messages, "Doubao Conversation"),
    platform: "Doubao",
    date,
    folderId: null,
    messages,
    ...(sourceDate ? { dateFromSource: true } : {}),
  };
  return [conv];
}
