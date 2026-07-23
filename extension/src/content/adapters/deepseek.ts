import { PlatformFetchError, type PlatformAdapter } from "./types";

/**
 * 端点与鉴权方式由 2026-07-20 真实登录页 Network 勘测确认（spec browser-extension §8 待补项）：
 *   GET /api/v0/chat/history_messages?chat_session_id=<uuid>
 *   authorization: Bearer <token>
 * 此前候选列表里路径本就命中，失败原因是只带 cookie、未带 Bearer 头。
 * 观测到的 cache_version / cache_reset_at 为客户端缓存协调参数，不参与会话定位，故不发送。
 */
const HISTORY_ENDPOINT = "/api/v0/chat/history_messages";

/** 勘测时观测到的客户端标识头；部分平台接口会校验，保持与真实请求一致。 */
const CLIENT_HEADERS: Record<string, string> = {
  "x-client-platform": "web",
  "x-client-version": "2.2.0",
};

/**
 * token 存放位置（2026-07-20 勘测：`userToken` 存在于 DeepSeek 的 localStorage）。
 * 不对 token 做格式校验——DeepSeek 的 token 并非 JWT，按形状过滤会把真 token 拒掉。
 * 也不扫描未知 key：错拿一个长字符串当 Bearer 只会换来含义不明的 401，
 * 不如按「明确报错 + 引导升级 Pentou」处理（spec §4.5 决策 5）。
 */
const TOKEN_KEYS = ["userToken", "token", "accessToken"];

function extractToken(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed.trim() || null;
    for (const candidate of [parsed?.value, parsed?.token, parsed?.accessToken, parsed?.access_token]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return null;
  } catch {
    return trimmed; // 非 JSON：裸 token 字符串
  }
}

/**
 * localStorage 按源隔离而非按扩展世界隔离，所以隔离世界的 content script 可直接读取，
 * 无需 spec 预留的 MAIN world 注入（credentialStrategy 仍为 session-token：取 bearer 再调数据接口）。
 */
function readAccessToken(): string | null {
  for (const key of TOKEN_KEYS) {
    const token = extractToken(localStorage.getItem(key));
    if (token) return token;
  }
  return null;
}

export const deepSeekAdapter: PlatformAdapter = {
  platform: "deepseek",
  credentialStrategy: "session-token",

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
    const token = readAccessToken();
    if (!token) {
      throw new PlatformFetchError("DeepSeek login was not found. Sign in and retry.", "not-logged-in");
    }

    const res = await fetch(`${HISTORY_ENDPOINT}?chat_session_id=${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { ...CLIENT_HEADERS, authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new PlatformFetchError("DeepSeek login has expired. Sign in and retry.", "not-logged-in");
    }
    if (!res.ok) {
      throw new PlatformFetchError(`DeepSeek conversation API returned HTTP ${res.status}.`, "platform-api-changed");
    }
    return await res.text();
  },
};
