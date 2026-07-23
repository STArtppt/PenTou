/**
 * ChatGPT backend-api conversation normalizer.
 *
 * The browser extension submits the raw JSON returned by
 * `backend-api/conversation/<id>`. Its conversation body matches the export
 * parser closely enough that we keep this file as a validation + dispatch shim.
 */
import type { Conversation } from "../../app/data.js";
import { parseChatGPTExport } from "../parsers.js";

export function normalizeChatGptApi(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("chatgpt raw payload is not valid JSON");
  }

  const item = json?.mapping ? json : json?.conversation;
  if (!item?.mapping || typeof item.mapping !== "object") {
    throw new Error("chatgpt raw payload missing mapping");
  }

  const conversations = parseChatGPTExport([item]);
  if (conversations.length === 0) {
    throw new Error("chatgpt raw payload contains no visible messages");
  }
  return conversations;
}
