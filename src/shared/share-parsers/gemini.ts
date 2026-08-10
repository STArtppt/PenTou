/**
 * Gemini batchexecute / 分享态与登录态共用解析真源。
 * 分享 rpcid=`ujx1Bf`、turns=`data[0][1]`；登录态 rpcid=`hNvQHb`、turns=`data[0]`。
 */

function makeId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeMsg(role: "user" | "ai", content: string, timestamp: string) {
  return { id: `msg_${Math.random().toString(36).slice(2, 9)}`, role, content, timestamp };
}

/** 从 batchexecute 分块响应中解出指定 rpcid 的内层 JSON。默认分享态 ujx1Bf。 */
export function parseGeminiBatchExecuteResponse(text: string, rpcid = "ujx1Bf"): any | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("[[")) continue;

    try {
      const envelope = JSON.parse(line);
      for (const entry of envelope) {
        if (entry?.[0] === "wrb.fr" && entry?.[1] === rpcid && typeof entry?.[2] === "string") {
          return JSON.parse(entry[2]);
        }
      }
    } catch {
      /* skip malformed chunk */
    }
  }

  return null;
}

export function geminiTimestamp(value: any, fallback: string): string {
  if (!Array.isArray(value) || typeof value[0] !== "number") return fallback;
  const millis = value[0] * 1000 + Math.floor((typeof value[1] === "number" ? value[1] : 0) / 1_000_000);
  return new Date(millis).toISOString();
}

export function extractGeminiUserText(request: any): string {
  const parts = request?.[0];
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: any) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function extractGeminiResponseText(response: any): string {
  const candidates = [response?.[0]?.[0]?.[1], response?.[0]?.[1], response?.[0]?.[11]?.[0], response?.[11]?.[0]];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const text = candidate
        .map((part: any) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (text) return text;
    }

    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return "";
}

/** 深扫响应节点收集 lh3.googleusercontent.com 生成图 URL，按数组顺序去重（spec media-assets §4.5）。 */
export function collectGeminiImageUrls(node: any, out: string[] = [], seen = new Set<string>()): string[] {
  if (typeof node === "string") {
    if (/^https:\/\/lh3\.googleusercontent\.com\//.test(node) && !seen.has(node)) {
      seen.add(node);
      out.push(node);
    }
  } else if (Array.isArray(node)) {
    for (const child of node) collectGeminiImageUrls(child, out, seen);
  } else if (node && typeof node === "object") {
    for (const child of Object.values(node)) collectGeminiImageUrls(child, out, seen);
  }
  return out;
}

/**
 * Gemini 正文内联 image_generation_content/<id> 占位 token → lh3 生成图 markdown。
 * 无对应图片时删除 token 并插入占位；未被 token 占用的生成图按序补在正文末尾（spec §4.5）。
 */
export function applyGeminiInlineImages(text: string, imageUrls: string[]): string {
  const tokenRe = /https?:\/\/googleusercontent\.com\/image_generation_content\/(\d+)/g;
  const idToOrd = new Map<string, number>();
  for (const match of text.matchAll(tokenRe)) {
    if (!idToOrd.has(match[1])) idToOrd.set(match[1], idToOrd.size);
  }

  const usedOrds = new Set<number>();
  let result = text.replace(tokenRe, (_match, id: string) => {
    const ord = idToOrd.get(id) ?? 0;
    usedOrds.add(ord);
    const url = imageUrls[ord];
    return url ? `![生成图片 ${ord + 1}](${url})` : "[生成图片缺失]";
  });
  const extra = imageUrls
    .map((url, i) => (usedOrds.has(i) ? null : `![生成图片 ${i + 1}](${url})`))
    .filter(Boolean) as string[];
  if (extra.length > 0) result = [result.trim(), ...extra].filter(Boolean).join("\n\n");
  return result;
}

export type GeminiTurnsPath = "share" | "login";

/**
 * 解析 Gemini API/RPC 内层 payload。
 * - share：turns = data[0][1]（分享页既有路径）
 * - login：turns = data[0]（登录态 batchexecute，倒序需 reverse）
 */
export function parseGeminiApiPayload(
  data: any,
  options?: { turnsPath?: GeminiTurnsPath; reverseTurns?: boolean },
): any[] {
  const turnsPath = options?.turnsPath ?? "share";
  const reverseTurns = options?.reverseTurns ?? turnsPath === "login";
  const date = new Date().toISOString();

  let turns: any;
  let titleSource: any;
  if (turnsPath === "login") {
    turns = Array.isArray(data?.[0]) ? data[0] : null;
    titleSource = null;
  } else {
    const conversation = data?.[0];
    turns = conversation?.[1];
    titleSource = conversation?.[2]?.[1];
  }

  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error("Gemini API payload did not contain any messages.");
  }

  const ordered = reverseTurns ? turns.slice().reverse() : turns;
  const messages: any[] = [];
  for (const turn of ordered) {
    const timestamp = geminiTimestamp(turn?.[4], date);
    const userText = extractGeminiUserText(turn?.[2]);
    const aiText = applyGeminiInlineImages(
      extractGeminiResponseText(turn?.[3]),
      collectGeminiImageUrls(turn?.[3]),
    );

    if (userText) messages.push(makeMsg("user", userText, timestamp));
    if (aiText) messages.push(makeMsg("ai", aiText, timestamp));
  }

  if (messages.length === 0) {
    throw new Error("Gemini API payload did not contain any message text.");
  }

  return [
    {
      id: makeId(),
      title: titleSource || messages[0].content.slice(0, 80).split("\n")[0],
      platform: "Gemini",
      date,
      folderId: null,
      messages,
    },
  ];
}
