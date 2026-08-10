import { PlatformFetchError, type PlatformAdapter } from "./types";

/**
 * Qwen 国际站（chat.qwen.ai）登录态回拉（2026-08-08 勘测）。
 * 同源 GET /api/v2/chats/<uuid>，cookie 鉴权，无参无头。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const qwenIntlAdapter: PlatformAdapter = {
  platform: "qwen-intl",
  credentialStrategy: "cookie",

  matches(url) {
    return this.conversationId(url) !== null;
  },

  conversationId(url) {
    // 与国内站互斥：仅国际域名
    if (url.hostname !== "chat.qwen.ai") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // /c/<标准 UUID>
    if (parts[0] === "c" && parts[1] && UUID_RE.test(parts[1])) return parts[1];
    return null;
  },

  async fetchRaw(id) {
    const res = await fetch(`/api/v2/chats/${encodeURIComponent(id)}`, {
      credentials: "include",
    });

    if (res.status === 401 || res.status === 403) {
      throw new PlatformFetchError("Qwen (intl) login has expired. Sign in and retry.", "not-logged-in");
    }
    if (!res.ok) {
      throw new PlatformFetchError(`Qwen (intl) conversation API returned HTTP ${res.status}.`, "platform-api-changed");
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const chat = json?.data?.chat ?? json?.chat;
      const hasArray = Array.isArray(chat?.messages) && chat.messages.length > 0;
      const hasMap = chat?.history?.messages && Object.keys(chat.history.messages).length > 0;
      if (!hasArray && !hasMap) {
        throw new PlatformFetchError("Qwen (intl) conversation API returned no messages.", "platform-api-changed");
      }
    } catch (e) {
      if (e instanceof PlatformFetchError) throw e;
      throw new PlatformFetchError("Qwen (intl) conversation API returned invalid JSON.", "platform-api-changed");
    }
    return text;
  },
};
