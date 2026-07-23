import { PlatformFetchError, type PlatformAdapter } from "./types";

function candidateUrls(id: string): string[] {
  const enc = encodeURIComponent(id);
  return [
    `/api/v0/chat_session/fetch?chat_session_id=${enc}`,
    `/api/v0/chat/session?chat_session_id=${enc}`,
    `/api/v0/chat/history_messages?chat_session_id=${enc}`,
  ];
}

export const deepSeekAdapter: PlatformAdapter = {
  platform: "deepseek",
  credentialStrategy: "cookie",

  matches(url) {
    return url.hostname === "chat.deepseek.com" && this.conversationId(url) !== null;
  },

  conversationId(url) {
    if (url.hostname !== "chat.deepseek.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const chatIndex = parts.findIndex((part) => part === "chat");
    if (chatIndex >= 0 && parts[chatIndex + 1]) {
      if (parts[chatIndex + 1] === "s" && parts[chatIndex + 2]) return parts[chatIndex + 2];
      return parts[chatIndex + 1];
    }
    return null;
  },

  async fetchRaw(id) {
    let lastStatus = 0;
    for (const url of candidateUrls(id)) {
      const res = await fetch(url, { credentials: "include" });
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403) {
        throw new PlatformFetchError("DeepSeek login has expired. Sign in and retry.", "not-logged-in");
      }
      if (res.ok) return await res.text();
    }
    throw new PlatformFetchError(
      `DeepSeek conversation API endpoint is not confirmed yet (last HTTP ${lastStatus || "network error"}).`,
      "platform-api-changed",
    );
  },
};
