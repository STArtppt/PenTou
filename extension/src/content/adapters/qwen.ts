import { PlatformFetchError, type PlatformAdapter } from "./types";

/**
 * Qwen 国内站（www.qianwen.com）登录态回拉（2026-08-08 勘测）。
 * 跨子域 GET chat2-api.qianwen.com；cookie 鉴权；ut 自生成 UUID 即可。
 */
const API_BASE = "https://chat2-api.qianwen.com/api/v1/session/msg/list";

function randomUt(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
}

export const qwenAdapter: PlatformAdapter = {
  platform: "qwen",
  credentialStrategy: "cookie",

  matches(url) {
    return this.conversationId(url) !== null;
  },

  conversationId(url) {
    // 与国际站互斥：仅国内域名
    if (url.hostname !== "www.qianwen.com" && url.hostname !== "qianwen.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // /chat/<32 位 hex，无连字符>
    if (parts[0] === "chat" && parts[1] && /^[0-9a-f]{32}$/i.test(parts[1])) return parts[1];
    return null;
  },

  async fetchRaw(id) {
    const params = new URLSearchParams({
      biz_id: "ai_qwen",
      pr: "qwen",
      ut: randomUt(),
      session_id: id,
      page_size: "100",
      page: "1",
    });
    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      credentials: "include",
    });

    if (res.status === 401 || res.status === 403) {
      throw new PlatformFetchError("Qwen login has expired. Sign in and retry.", "not-logged-in");
    }
    if (!res.ok) {
      throw new PlatformFetchError(`Qwen conversation API returned HTTP ${res.status}.`, "platform-api-changed");
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const list = json?.data?.list;
      if (!Array.isArray(list) || list.length === 0) {
        throw new PlatformFetchError("Qwen conversation API returned no messages.", "platform-api-changed");
      }
    } catch (e) {
      if (e instanceof PlatformFetchError) throw e;
      throw new PlatformFetchError("Qwen conversation API returned invalid JSON.", "platform-api-changed");
    }
    return text;
  },
};
