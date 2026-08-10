/**
 * Gemini 登录态 raw normalizer。
 * 复用 share-parsers/gemini：rpcid=hNvQHb，turns 取 data[0]，倒序反转。
 */
import type { Conversation } from "../../app/data.js";
import {
  parseGeminiApiPayload,
  parseGeminiBatchExecuteResponse,
} from "../share-parsers/gemini.js";
import { makeConvId } from "./util.js";

export function normalizeGeminiApi(data: string): Conversation[] {
  const text = data?.trim?.() ?? String(data);
  if (!text) throw new Error("gemini raw payload is empty");

  // 已是解包后的 JSON
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const json = JSON.parse(text);
      const convs = parseGeminiApiPayload(json, { turnsPath: "login", reverseTurns: true });
      return convs.map((c) => ({ ...c, id: makeConvId(), platform: "Gemini" as const }));
    } catch (e: any) {
      // 可能是 batchexecute 文本以 [ 开头的分块，继续下面路径
      if (!text.includes("wrb.fr") && !text.includes(")]}'")) {
        throw new Error(`gemini raw payload parse failed: ${e?.message ?? e}`);
      }
    }
  }

  // batchexecute 原始响应（含 )]}' 前缀 + 分块）
  const inner = parseGeminiBatchExecuteResponse(text, "hNvQHb");
  if (!inner) {
    // 兼容分享态 rpcid 误投
    const shareInner = parseGeminiBatchExecuteResponse(text, "ujx1Bf");
    if (shareInner) {
      const convs = parseGeminiApiPayload(shareInner, { turnsPath: "share", reverseTurns: false });
      return convs.map((c) => ({ ...c, id: makeConvId(), platform: "Gemini" as const }));
    }
    throw new Error("gemini raw payload missing batchexecute wrb.fr envelope");
  }

  const convs = parseGeminiApiPayload(inner, { turnsPath: "login", reverseTurns: true });
  // 过滤「图片缺失」脏占位若同时已有真实图（applyGeminiInlineImages 已处理；再 scrub 孤立脏占位）
  return convs.map((c) => ({
    ...c,
    id: makeConvId(),
    platform: "Gemini" as const,
    messages: c.messages.map((m: any) => ({
      ...m,
      content:
        typeof m.content === "string" && m.content.includes("![生成图片")
          ? m.content.replace(/\[生成图片缺失\]\n*/g, "").trim()
          : m.content,
    })),
  }));
}
