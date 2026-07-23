import { describe, expect, it } from "vitest";
import { normalizeChatGptApi } from "./chatgpt-api";
import { normalizeDeepSeekApi } from "./deepseek-api";

describe("ChatGPT API normalizer", () => {
  it("takes the active mapping branch and skips hidden/system messages", () => {
    const raw = JSON.stringify({
      id: "chatcmpl-1",
      title: "Branchy",
      create_time: 1783560000,
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a_old", "a_new"],
          message: {
            author: { role: "user" },
            create_time: 1783560001,
            content: { parts: ["hello"] },
          },
        },
        a_old: {
          id: "a_old",
          parent: "u1",
          children: [],
          message: {
            author: { role: "assistant" },
            create_time: 1783560002,
            content: { parts: ["old answer"] },
          },
        },
        a_new: {
          id: "a_new",
          parent: "u1",
          children: [],
          message: {
            author: { role: "assistant" },
            create_time: 1783560003,
            content: { parts: ["new answer"] },
          },
        },
      },
    });

    const [conv] = normalizeChatGptApi(raw);
    expect(conv.title).toBe("Branchy");
    expect(conv.platform).toBe("ChatGPT");
    expect(conv.messages.map((m) => m.content)).toEqual(["hello", "new answer"]);
  });

  // 回归：真实采集中 ChatGPT 对个别 assistant 消息返回了远早于会话创建时间的 create_time
  // （debugging/2026-07-20-chatgpt-extension-stale-message-timestamp.md）
  it("marks dateFromSource so a stale message create_time cannot drag the date back", () => {
    const raw = JSON.stringify({
      id: "6a5dc6cd-0f48-83e8-8d52-1b773a573718",
      title: "梅西评价分析",
      create_time: 1784530637.811463, // 2026-07-20T06:57:17.811Z
      update_time: 1784532318.488657,
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1",
          parent: "root",
          children: ["a1"],
          message: { author: { role: "user" }, create_time: 1784530636.656, content: { parts: ["如何评价梅西"] } },
        },
        a1: {
          id: "a1",
          parent: "u1",
          children: [],
          // 平台返回的过期时间戳：2026-07-17T10:58:47.957Z，早于会话创建时间三天
          message: { author: { role: "assistant" }, create_time: 1784285927.957723, content: { parts: ["梅西是……"] } },
        },
      },
    });

    const [conv] = normalizeChatGptApi(raw);
    expect(conv.date).toBe("2026-07-20T06:57:17.811Z");
    expect(conv.dateFromSource).toBe(true);
    // 消息原始时间按 US-01 保真，不做改写
    expect(conv.messages[1].timestamp).toBe("2026-07-17T10:58:47.957Z");
  });

  it("throws a platform-specific error for unexpected payloads", () => {
    expect(() => normalizeChatGptApi("{}")).toThrow("chatgpt raw payload missing mapping");
  });
});

describe("DeepSeek API normalizer", () => {
  it("maps biz_data messages and THINK fragments", () => {
    const raw = JSON.stringify({
      data: {
        biz_data: {
          title: "DeepSeek topic",
          created_at: "2026-07-09T00:00:00.000Z",
          messages: [
            { role: "user", content: "question", created_at: "2026-07-09T00:00:01.000Z" },
            {
              role: "assistant",
              created_at: "2026-07-09T00:00:02.000Z",
              fragments: [
                { type: "THINK", content: "think line" },
                { type: "RESPONSE", content: "answer" },
              ],
            },
          ],
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.title).toBe("DeepSeek topic");
    expect(conv.platform).toBe("DeepSeek");
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "question" });
    expect(conv.messages[1].content).toContain("Thinking Process");
    expect(conv.messages[1].content).toContain("answer");
  });

  // 登录态 GET /api/v0/chat/history_messages 的真实响应形态（2026-07-20 勘测确认字段名）
  it("maps the logged-in history_messages shape (chat_messages + chat_session)", () => {
    const raw = JSON.stringify({
      code: 0,
      msg: "",
      data: {
        biz_data: {
          chat_session: {
            id: "842f4bcb-dae7-4777-96a7-2e54703f9999",
            title: "梅西评价分析",
            inserted_at: "2026-07-20T06:57:17.811Z",
          },
          chat_messages: [
            {
              message_id: 1,
              parent_id: null,
              role: "USER",
              inserted_at: "2026-07-20T06:57:16.656Z",
              fragments: [{ type: "REQUEST", content: "如何评价梅西" }],
            },
            {
              message_id: 2,
              parent_id: 1,
              role: "ASSISTANT",
              inserted_at: "2026-07-20T06:57:20.000Z",
              fragments: [
                { type: "THINK", content: "先分点" },
                { type: "RESPONSE", content: "梅西是……" },
              ],
            },
          ],
          cache_control: {},
          cache_reset_at: 1784534306,
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.title).toBe("梅西评价分析");
    expect(conv.platform).toBe("DeepSeek");
    expect(conv.date).toBe("2026-07-20T06:57:17.811Z");
    expect(conv.dateFromSource).toBe(true);
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "如何评价梅西" });
    expect(conv.messages[0].timestamp).toBe("2026-07-20T06:57:16.656Z");
    expect(conv.messages[1].role).toBe("ai");
    expect(conv.messages[1].content).toContain("Thinking Process");
    expect(conv.messages[1].content).toContain("梅西是……");
  });

  it("also accepts export-style mapping payloads", () => {
    const raw = JSON.stringify({
      id: "ds-1",
      title: "Mapping",
      inserted_at: "2026-07-09T00:00:00.000Z",
      mapping: {
        root: { parent: null, children: ["u1"] },
        u1: {
          parent: "root",
          children: [],
          message: { fragments: [{ type: "REQUEST", content: "hello" }] },
        },
      },
    });

    const [conv] = normalizeDeepSeekApi(raw);
    expect(conv.messages.map((m) => m.content)).toEqual(["hello"]);
  });

  it("throws a platform-specific error for unexpected payloads", () => {
    expect(() => normalizeDeepSeekApi("{}")).toThrow("deepseek raw payload missing mapping or biz_data.messages");
  });
});
