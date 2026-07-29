/**
 * OpenCode 会话信封 normalizer（spec collector-source-expansion US-03）。
 * 信封：{ schema:"opencode-v1", session:{title,time_created,...},
 *        messages:[{ role, time:{created}, parts:[{type:"text",text,synthetic?}], ... }] }
 * - part.synthetic=true：工具旁白 / 文件倾倒 / system-reminder，不是用户或助手正文；
 * - 用户侧再走 cleanUserMessageContent 兜底。
 */
import type { Conversation, Message } from "../../app/data.js";
import { cleanUserMessageContent } from "../agent-noise.js";
import { buildConversation, EmptyPayloadError, epochToIso, makeMessage, parseEnvelope } from "./util.js";
import { sourceProjectFromCwd } from "../source-project.js";

/** 只取非 synthetic 的 text part（真实对话正文） */
function realTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part: any) => part && part.synthetic !== true)
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function normalizeOpencode(data: string): Conversation[] {
  const { session, messages: rows } = parseEnvelope(data, "opencode");
  const messages: Message[] = [];

  for (const row of rows) {
    const role = row?.role === "user" ? "user" : row?.role === "assistant" ? "ai" : null;
    if (!role) continue;
    let text = realTextParts(row.parts);
    if (role === "user") text = cleanUserMessageContent(text);
    if (!text) continue; // 纯工具/步骤轮或仅 synthetic 注入
    const timestamp = epochToIso(row?.time?.created) ?? epochToIso(row?.time_created) ?? new Date().toISOString();
    messages.push(makeMessage(role, text, timestamp));
  }

  if (messages.length === 0) throw new EmptyPayloadError("opencode raw payload contains no messages");
  return [buildConversation({
    platform: "OpenCode",
    title: typeof session?.title === "string" ? session.title : undefined,
    date: epochToIso(session?.time_created),
    messages,
    fallbackTitle: "OpenCode Conversation",
    // 来源项目：opencode session 表存有 directory（spec conversation-project-attribution）
    sourceProject: sourceProjectFromCwd(session?.directory),
  })];
}
