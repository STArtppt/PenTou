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
