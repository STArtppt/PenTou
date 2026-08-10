import { PlatformFetchError, type PlatformAdapter } from "./types";

/**
 * Gemini 登录态会话回拉（2026-08-08/09 勘测）。
 * batchexecute rpcids=hNvQHb；at 令牌从文档 DOM 读 SNlM0e（无需 MAIN world 注入）。
 * 轮次超过 limit 时按 data[1] 游标续拉。
 */
const RPCID = "hNvQHb";
const ENDPOINT = `/_/BardChatUi/data/batchexecute?rpcids=${RPCID}&rt=c`;
const PAGE_LIMIT = 100;

/** 隔离世界读文档 DOM 取令牌；取不到视为未登录。 */
function readAtToken(): string | null {
  try {
    const html = document.documentElement?.innerHTML ?? "";
    const match = html.match(/"SNlM0e":"([^"]+)"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function buildBody(conversationId: string, cursor: string | null, at: string): string {
  const inner = JSON.stringify([
    `c_${conversationId}`,
    PAGE_LIMIT,
    cursor,
    1,
    [0],
    [4],
    null,
    1,
  ]);
  const fReq = JSON.stringify([[[RPCID, inner, null, "generic"]]]);
  return `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}&`;
}

/** 从 batchexecute 分块响应解出内层 data；返回 { data, cursor }。 */
function unwrapPage(text: string): { data: any; cursor: string | null } {
  for (const line of text.split("\n")) {
    if (!line.startsWith("[[")) continue;
    try {
      const envelope = JSON.parse(line);
      for (const entry of envelope) {
        if (entry?.[0] === "wrb.fr" && entry?.[1] === RPCID && typeof entry?.[2] === "string") {
          const data = JSON.parse(entry[2]);
          const cursor = data?.[1] == null ? null : String(data[1]);
          return { data, cursor };
        }
      }
    } catch {
      /* next line */
    }
  }
  throw new PlatformFetchError("Gemini batchexecute response shape changed.", "platform-api-changed");
}

export const geminiAdapter: PlatformAdapter = {
  platform: "gemini",
  credentialStrategy: "cookie",

  matches(url) {
    return this.conversationId(url) !== null;
  },

  conversationId(url) {
    if (url.hostname !== "gemini.google.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // /app/<16 位 hex>
    if (parts[0] === "app" && parts[1] && /^[0-9a-f]{16}$/i.test(parts[1])) return parts[1];
    return null;
  },

  async fetchRaw(id) {
    const at = readAtToken();
    if (!at) {
      throw new PlatformFetchError("Gemini session token not found. Sign in and retry.", "not-logged-in");
    }

    // 多页合并：把各页 turns 拼进第一页 data[0]，cursor 置 null，供服务端一次解析
    let cursor: string | null = null;
    let firstData: any = null;
    const allTurns: any[] = [];
    let pages = 0;
    const maxPages = 20;

    do {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        body: buildBody(id, cursor, at),
      });

      if (res.status === 401 || res.status === 403 || res.status === 400) {
        // 400 xsrf ≈ 令牌失效/未登录
        throw new PlatformFetchError("Gemini rejected the session token. Sign in and retry.", "not-logged-in");
      }
      if (!res.ok) {
        throw new PlatformFetchError(`Gemini batchexecute returned HTTP ${res.status}.`, "platform-api-changed");
      }

      const text = await res.text();
      const page = unwrapPage(text);
      if (!firstData) firstData = page.data;
      const turns = Array.isArray(page.data?.[0]) ? page.data[0] : [];
      allTurns.push(...turns);
      cursor = page.cursor;
      pages++;
    } while (cursor && pages < maxPages);

    if (!firstData || allTurns.length === 0) {
      throw new PlatformFetchError("Gemini returned no conversation turns.", "platform-api-changed");
    }

    // 合并后的内层 JSON：turns 在 data[0]，cursor null
    const merged = Array.isArray(firstData) ? [...firstData] : [allTurns];
    merged[0] = allTurns;
    if (merged.length > 1) merged[1] = null;

    // 包装成 batchexecute 单行形态，复用服务端 parseGeminiBatchExecuteResponse
    const inner = JSON.stringify(merged);
    const envelope = JSON.stringify([["wrb.fr", RPCID, inner]]);
    return `)]}'\n${envelope.length}\n${envelope}\n`;
  },
};
