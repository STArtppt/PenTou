import { describe, expect, it } from "vitest";
import { chatGptAdapter } from "./chatgpt";
import { deepSeekAdapter } from "./deepseek";
import { doubaoAdapter } from "./doubao";
import { qwenAdapter } from "./qwen";
import { qwenIntlAdapter } from "./qwen-intl";
import { geminiAdapter } from "./gemini";
import { adapters } from "./index";

describe("platform adapters", () => {
  it("matches ChatGPT conversation URLs", () => {
    const url = new URL("https://chatgpt.com/c/abc-123");
    expect(chatGptAdapter.matches(url)).toBe(true);
    expect(chatGptAdapter.conversationId(url)).toBe("abc-123");
    expect(chatGptAdapter.matches(new URL("https://chatgpt.com/"))).toBe(false);
  });

  it("matches DeepSeek conversation URL variants", () => {
    expect(deepSeekAdapter.conversationId(new URL("https://chat.deepseek.com/a/chat/s/session-1"))).toBe("session-1");
    expect(deepSeekAdapter.conversationId(new URL("https://chat.deepseek.com/chat/session-2"))).toBe("session-2");
    expect(deepSeekAdapter.matches(new URL("https://chat.deepseek.com/"))).toBe(false);
  });

  it("matches Doubao /chat/<digits> and rejects home/settings", () => {
    expect(doubaoAdapter.conversationId(new URL("https://www.doubao.com/chat/38435082212974338"))).toBe(
      "38435082212974338",
    );
    expect(doubaoAdapter.matches(new URL("https://www.doubao.com/chat/38435082212974338"))).toBe(true);
    expect(doubaoAdapter.matches(new URL("https://www.doubao.com/"))).toBe(false);
    expect(doubaoAdapter.matches(new URL("https://www.doubao.com/setting"))).toBe(false);
    expect(doubaoAdapter.matches(new URL("https://www.doubao.com/chat/not-digits"))).toBe(false);
  });

  it("matches Qwen CN /chat/<32hex> and rejects home; does not match intl host", () => {
    const id = "68fec75828dd4923be7c33d6e60c85c6";
    expect(qwenAdapter.conversationId(new URL(`https://www.qianwen.com/chat/${id}`))).toBe(id);
    expect(qwenAdapter.matches(new URL("https://www.qianwen.com/"))).toBe(false);
    expect(qwenAdapter.matches(new URL("https://chat.qwen.ai/c/067c5598-ce15-47ba-9f79-6fc4cf155227"))).toBe(false);
  });

  it("matches Qwen intl /c/<uuid> and rejects CN host / home", () => {
    const id = "067c5598-ce15-47ba-9f79-6fc4cf155227";
    expect(qwenIntlAdapter.conversationId(new URL(`https://chat.qwen.ai/c/${id}`))).toBe(id);
    expect(qwenIntlAdapter.matches(new URL("https://chat.qwen.ai/"))).toBe(false);
    expect(qwenIntlAdapter.matches(new URL("https://www.qianwen.com/chat/68fec75828dd4923be7c33d6e60c85c6"))).toBe(
      false,
    );
  });

  it("matches Gemini /app/<16hex> and rejects home", () => {
    expect(geminiAdapter.conversationId(new URL("https://gemini.google.com/app/2a53dee8a991863e"))).toBe(
      "2a53dee8a991863e",
    );
    expect(geminiAdapter.matches(new URL("https://gemini.google.com/"))).toBe(false);
    expect(geminiAdapter.matches(new URL("https://gemini.google.com/app/"))).toBe(false);
  });

  it("does not cross-match Qwen CN and intl on the same id string", () => {
    // 国内 32 hex 与国际 UUID 格式天然不同；再加域名互斥
    const hex32 = "68fec75828dd4923be7c33d6e60c85c6";
    const uuid = "067c5598-ce15-47ba-9f79-6fc4cf155227";
    expect(qwenAdapter.conversationId(new URL(`https://www.qianwen.com/chat/${hex32}`))).toBe(hex32);
    expect(qwenIntlAdapter.conversationId(new URL(`https://chat.qwen.ai/c/${uuid}`))).toBe(uuid);
    expect(adapters.filter((a) => a.matches(new URL(`https://www.qianwen.com/chat/${hex32}`)))).toHaveLength(1);
    expect(adapters.filter((a) => a.matches(new URL(`https://chat.qwen.ai/c/${uuid}`)))).toHaveLength(1);
  });
});

// 端点/鉴权来自 2026-07-20 真实登录页勘测；固化以便平台改动时测试先失败
describe("DeepSeek adapter fetchRaw (spike 2026-07-20)", () => {
  const SESSION = "842f4bcb-dae7-4777-96a7-2e54703f9999";
  // DeepSeek 的 token 不是 JWT（2026-07-20 勘测：按 JWT 形状过滤会把真 token 拒掉）
  const TOKEN = "Ab3xK9-nQ2pR7sT4uV6wX8yZ0cD1eF5g";

  const withEnv = async (store: Record<string, string>, fetchImpl: any, run: () => Promise<void>) => {
    const g: any = globalThis;
    const prevLs = g.localStorage;
    const prevFetch = g.fetch;
    g.localStorage = {
      ...store,
      length: Object.keys(store).length,
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
    };
    g.fetch = fetchImpl;
    try {
      await run();
    } finally {
      g.localStorage = prevLs;
      g.fetch = prevFetch;
    }
  };

  it("calls history_messages with a Bearer token read from localStorage", async () => {
    let seenUrl = "";
    let seenInit: any = null;
    await withEnv(
      { userToken: JSON.stringify({ value: TOKEN, __version: "0" }) },
      async (url: string, init: any) => {
        seenUrl = url;
        seenInit = init;
        return { ok: true, status: 200, text: async () => '{"data":{"biz_data":{"messages":[]}}}' };
      },
      async () => {
        const raw = await deepSeekAdapter.fetchRaw(SESSION);
        expect(raw).toContain("biz_data");
      },
    );
    expect(seenUrl).toBe(`/api/v0/chat/history_messages?chat_session_id=${SESSION}`);
    expect(seenInit.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seenInit.credentials).toBe("include");
  });

  // userToken 的存储形态未实测到（值不可外泄），故裸串与 JSON 包裹两种都要支持
  it("accepts a bare token string as well as a JSON-wrapped one", async () => {
    for (const stored of [TOKEN, JSON.stringify({ value: TOKEN }), JSON.stringify({ token: TOKEN })]) {
      let seenInit: any = null;
      await withEnv(
        { userToken: stored },
        async (_url: string, init: any) => {
          seenInit = init;
          return { ok: true, status: 200, text: async () => "{}" };
        },
        async () => {
          await deepSeekAdapter.fetchRaw(SESSION);
        },
      );
      expect(seenInit.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("reports not-logged-in when no token is present", async () => {
    await withEnv({ theme: "dark" }, async () => ({ ok: true, status: 200, text: async () => "{}" }), async () => {
      await expect(deepSeekAdapter.fetchRaw(SESSION)).rejects.toMatchObject({ reason: "not-logged-in" });
    });
  });

  it("reports not-logged-in on 401 and platform-api-changed on other errors", async () => {
    await withEnv({ userToken: TOKEN }, async () => ({ ok: false, status: 401, text: async () => "" }), async () => {
      await expect(deepSeekAdapter.fetchRaw(SESSION)).rejects.toMatchObject({ reason: "not-logged-in" });
    });
    await withEnv({ userToken: TOKEN }, async () => ({ ok: false, status: 500, text: async () => "" }), async () => {
      await expect(deepSeekAdapter.fetchRaw(SESSION)).rejects.toMatchObject({ reason: "platform-api-changed" });
    });
  });
});
