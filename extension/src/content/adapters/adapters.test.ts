import { describe, expect, it } from "vitest";
import { chatGptAdapter } from "./chatgpt";
import { deepSeekAdapter } from "./deepseek";

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
});
