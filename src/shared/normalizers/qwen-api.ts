/**
 * Qwen 国内站（qianwen.com）raw normalizer。
 * data.list[] 与分享态 session.record_list[] 同构 → 复用 share-parsers/qwen。
 */
import type { Conversation } from "../../app/data.js";
import { mapQianwenRecords, parseQianwenApiPayload } from "../share-parsers/qwen.js";
import { makeConvId, titleFromMessages } from "./util.js";

export function normalizeQwenApi(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("qwen raw payload is not valid JSON");
  }

  // 分享态形态：session.record_list
  if (Array.isArray(json?.session?.record_list)) {
    const share = parseQianwenApiPayload(json);
    return share.map((c) => ({
      ...c,
      platform: "Qwen" as const,
    }));
  }

  // 登录态：data.list[]
  const list = json?.data?.list ?? json?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("qwen raw payload missing data.list / session.record_list");
  }

  const fallbackDate = new Date().toISOString();
  const messages = mapQianwenRecords(list, fallbackDate);
  if (messages.length === 0) {
    throw new Error("qwen raw payload did not contain any message text");
  }

  const title =
    json?.data?.title ||
    json?.title ||
    list[0]?.session_title ||
    titleFromMessages(messages as any, "Qwen Conversation");

  return [
    {
      id: makeConvId(),
      title: String(title).trim() || "Qwen Conversation",
      platform: "Qwen",
      date: messages[0]?.timestamp || fallbackDate,
      folderId: null,
      messages: messages as Conversation["messages"],
    },
  ];
}
