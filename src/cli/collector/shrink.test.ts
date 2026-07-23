import { describe, expect, it } from "vitest";
import { MESSAGE_CONTENT_CAP, shrinkConversation, truncateContent } from "./shrink.js";

function msg(role: "user" | "ai", content: string, id = `m_${role}_${content.length}`) {
  return { id, role, content, timestamp: "2026-07-14T00:00:00.000Z" };
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}

describe("truncateContent", () => {
  it("按 UTF-8 字节截断，多字节字符不越界", () => {
    const text = "汉".repeat(1000); // 3 bytes/char
    const out = truncateContent(text, 100);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(100);
    expect(out.length).toBeGreaterThan(0);
  });

  it("不在代理对中间断开", () => {
    const text = "😀".repeat(100); // 4 bytes / 2 code units
    const out = truncateContent(text, 10);
    expect(out).toBe("😀".repeat(2));
  });

  it("确定性：同输入同输出", () => {
    const text = "x".repeat(500_000);
    expect(truncateContent(text, 1234)).toBe(truncateContent(text, 1234));
  });
});

describe("shrinkConversation", () => {
  it("预算内原样返回，计数为零", () => {
    const conv = { title: "t", platform: "claude-code", messages: [msg("user", "hi"), msg("ai", "hello")] };
    const result = shrinkConversation(conv, 10_000);
    expect(result.conversation).toEqual(conv);
    expect(result.truncatedMessages).toBe(0);
    expect(result.removedMessages).toBe(0);
  });

  it("阶段一：超 cap 消息截断并带标记，达标后不进入移除", () => {
    const big = "x".repeat(MESSAGE_CONTENT_CAP + 1000);
    const conv = { title: "t", messages: [msg("user", "hi"), msg("ai", big)] };
    const result = shrinkConversation(conv, MESSAGE_CONTENT_CAP * 2);
    expect(result.truncatedMessages).toBe(1);
    expect(result.removedMessages).toBe(0);
    const truncated = result.conversation.messages[1];
    expect(Buffer.byteLength(truncated.content, "utf-8")).toBeLessThanOrEqual(MESSAGE_CONTENT_CAP);
    expect(truncated.content).toContain(`> [pentou-cli 截断：原始 ${big.length} 字符]`);
    expect(result.conversation.messages[0].content).toBe("hi"); // U1 未动
    expect(bytes(result.conversation)).toBeLessThanOrEqual(MESSAGE_CONTENT_CAP * 2);
  });

  it("阶段二：从最旧非 U1 消息移除，保 U1 与尾部，占位在移除处", () => {
    const filler = "y".repeat(50_000);
    const conv = {
      title: "t",
      messages: [msg("user", "U1", "m_u1"), ...Array.from({ length: 20 }, (_, i) => msg("ai", `${filler}#${i}`, `m_${i}`))],
    };
    const budget = 300_000;
    const result = shrinkConversation(conv, budget);
    expect(result.removedMessages).toBeGreaterThan(0);
    expect(bytes(result.conversation)).toBeLessThanOrEqual(budget);
    const out = result.conversation.messages;
    expect(out[0].content).toBe("U1"); // U1 保留且仍是首条用户消息
    expect(out[1].content).toBe(`> [pentou-cli 省略中部 ${result.removedMessages} 条消息]`);
    expect(out[out.length - 1].content).toBe(`${filler}#19`); // 尾部最新消息保留
  });

  it("会话以 ai 消息开头时，U1 之前的消息可被移除，U1 仍保留", () => {
    const filler = "z".repeat(100_000);
    const conv = {
      messages: [msg("ai", `${filler}-lead`, "m_lead"), msg("user", "U1", "m_u1"), msg("ai", `${filler}-tail`, "m_tail")],
    };
    const result = shrinkConversation(conv, 150_000);
    const contents = result.conversation.messages.map((m) => m.content);
    expect(contents).toContain("U1");
    expect(contents.find((c) => c.includes("省略中部"))).toBeTruthy();
    expect(bytes(result.conversation)).toBeLessThanOrEqual(150_000);
  });

  it("确定性：同输入两次调用输出逐字节一致", () => {
    const conv = {
      title: "t",
      messages: [msg("user", "x".repeat(MESSAGE_CONTENT_CAP + 5)), ...Array.from({ length: 30 }, (_, i) => msg("ai", "w".repeat(40_000), `m_${i}`))],
    };
    const a = shrinkConversation(conv, 500_000);
    const b = shrinkConversation(conv, 500_000);
    expect(JSON.stringify(a.conversation)).toBe(JSON.stringify(b.conversation));
    expect(a.truncatedMessages).toBe(b.truncatedMessages);
    expect(a.removedMessages).toBe(b.removedMessages);
  });

  it("保底：移除至仅剩 U1 + 占位", () => {
    const conv = {
      messages: [msg("user", "U1", "m_u1"), ...Array.from({ length: 5 }, (_, i) => msg("ai", "v".repeat(10_000), `m_${i}`))],
    };
    const result = shrinkConversation(conv, 2_000);
    expect(result.removedMessages).toBe(5);
    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.messages[0].content).toBe("U1");
  });
});
