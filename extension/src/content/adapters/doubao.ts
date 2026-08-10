import { PlatformFetchError, type PlatformAdapter } from "./types";

/**
 * 豆包登录态会话回拉（2026-08-08 勘测）。
 * POST /im/chain/single，cookie 鉴权；必须带 samantha_web/pc_version/encoding=utf-8/anchor_index，
 * 否则 200 但 content_block 全空（静默降级）。
 */
const QUERY = "aid=497858&samantha_web=1&pc_version=3.30.6";
const ENDPOINT = `/im/chain/single?${QUERY}`;
/** 锚到「最新」一侧，limit 一次拉完常见会话。 */
const ANCHOR_INDEX = 9007199254740991;

function hasNonEmptyContentBlock(raw: string): boolean {
  try {
    const json = JSON.parse(raw);
    const messages =
      json?.downlink_body?.pull_singe_chain_downlink_body?.messages ??
      json?.pull_singe_chain_downlink_body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return false;
    return messages.some((m: any) => {
      const blocks = m?.content_block;
      if (!Array.isArray(blocks) || blocks.length === 0) return false;
      return blocks.some((b: any) => {
        const c = b?.content ?? b?.content_v2;
        if (!c) return false;
        if (typeof c === "string") return c.trim().length > 0;
        return Boolean(
          c?.text_block?.text ||
            c?.text ||
            c?.creation_block?.creations?.length ||
            c?.attachment_block?.attachments?.length ||
            c?.search_query_result_block ||
            c?.rich_media_block?.creations?.length,
        );
      });
    });
  } catch {
    return false;
  }
}

export const doubaoAdapter: PlatformAdapter = {
  platform: "doubao",
  credentialStrategy: "cookie",

  matches(url) {
    return this.conversationId(url) !== null;
  },

  conversationId(url) {
    if (url.hostname !== "www.doubao.com" && url.hostname !== "doubao.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // /chat/<纯数字>
    if (parts[0] === "chat" && parts[1] && /^\d+$/.test(parts[1])) return parts[1];
    return null;
  },

  async fetchRaw(id) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json; encoding=utf-8",
      },
      body: JSON.stringify({
        cmd: 3100,
        uplink_body: {
          pull_singe_chain_uplink_body: {
            conversation_id: id,
            anchor_index: ANCHOR_INDEX,
            conversation_type: 3,
            direction: 1,
            limit: 100,
          },
        },
      }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new PlatformFetchError("Doubao login has expired. Sign in and retry.", "not-logged-in");
    }
    if (!res.ok) {
      throw new PlatformFetchError(`Doubao conversation API returned HTTP ${res.status}.`, "platform-api-changed");
    }

    const text = await res.text();
    if (!hasNonEmptyContentBlock(text)) {
      throw new PlatformFetchError(
        "Doubao returned empty content_block (degraded response or API change).",
        "platform-api-changed",
      );
    }
    return text;
  },
};
