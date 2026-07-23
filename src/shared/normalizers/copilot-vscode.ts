/**
 * VS Code Copilot Chat 会话 JSON normalizer（spec collector-source-expansion US-04）。
 * 原始文件：workspaceStorage/<hash>/chatSessions/<uuid>.json，
 * { sessionId, creationDate, requests:[{ message:{text}, response:[...], timestamp? }] }。
 * response 项形态随 VS Code 版本演进（spec §8 风险）：宽容收集字符串型 value/text。
 */
import type { Conversation, Message } from "../../app/data.js";
import { buildConversation, epochToIso, makeMessage } from "./util.js";

function requestText(message: any): string {
  if (typeof message?.text === "string") return message.text.trim();
  if (Array.isArray(message?.parts)) {
    return message.parts
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function responseText(response: unknown): string {
  const chunks: string[] = [];
  const visit = (node: any): void => {
    if (typeof node === "string") {
      chunks.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === "object") {
      if (typeof node.value === "string") chunks.push(node.value);
      else if (typeof node.text === "string") chunks.push(node.text);
    }
  };
  visit(response);
  return chunks.join("").trim();
}

export function normalizeCopilotVscode(data: string): Conversation[] {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    throw new Error("copilot-vscode raw payload is not valid JSON");
  }
  if (!Array.isArray(json?.requests)) throw new Error("copilot-vscode raw payload missing requests");

  const sessionDate = epochToIso(json.creationDate);
  const messages: Message[] = [];
  for (const request of json.requests) {
    const timestamp = epochToIso(request?.timestamp) ?? sessionDate ?? new Date().toISOString();
    const userText = requestText(request?.message);
    const aiText = responseText(request?.response ?? request?.result?.value);
    if (userText) messages.push(makeMessage("user", userText, timestamp));
    if (aiText) messages.push(makeMessage("ai", aiText, timestamp));
  }

  if (messages.length === 0) throw new Error("copilot-vscode raw payload contains no messages");
  return [buildConversation({
    platform: "Copilot",
    date: sessionDate,
    messages,
    fallbackTitle: "Copilot Conversation",
  })];
}
