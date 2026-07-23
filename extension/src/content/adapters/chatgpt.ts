import { PlatformFetchError, type PlatformAdapter } from "./types";

function isChatGptHost(hostname: string): boolean {
  return hostname === "chatgpt.com" || hostname === "chat.openai.com";
}

export const chatGptAdapter: PlatformAdapter = {
  platform: "chatgpt",
  credentialStrategy: "session-token",

  matches(url) {
    return isChatGptHost(url.hostname) && /^\/c\/[^/]+/.test(url.pathname);
  },

  conversationId(url) {
    if (!this.matches(url)) return null;
    return url.pathname.split("/")[2] || null;
  },

  async fetchRaw(id) {
    const session = await fetch("/api/auth/session", { credentials: "include" });
    if (session.status === 401 || session.status === 403) {
      throw new PlatformFetchError("ChatGPT login has expired. Sign in and retry.", "not-logged-in");
    }
    if (!session.ok) {
      throw new PlatformFetchError("ChatGPT session endpoint changed.", "platform-api-changed");
    }

    const sessionJson = await session.json();
    const token = sessionJson?.accessToken;
    if (typeof token !== "string" || !token) {
      throw new PlatformFetchError("ChatGPT access token is unavailable.", "not-logged-in");
    }

    const res = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new PlatformFetchError("ChatGPT rejected the session. Sign in and retry.", "not-logged-in");
    }
    if (!res.ok) {
      throw new PlatformFetchError(`ChatGPT conversation API returned HTTP ${res.status}.`, "platform-api-changed");
    }
    return await res.text();
  },
};
