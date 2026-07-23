import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveInitialConversationId } from "./data";

// 回归：src/docs/debugging/2026-07-16-refresh-opens-oldest-conversation.md
// 刷新后应恢复上次打开的会话，而不是永远选 readdir 字母序第一条。
describe("initial conversation selection", () => {
  const convs = [{ id: "conv_a" }, { id: "conv_b" }, { id: "conv_c" }];

  it("restores the stored conversation when it still exists", () => {
    expect(resolveInitialConversationId(convs, "conv_b")).toBe("conv_b");
  });

  it("falls back to the first conversation when the stored id is stale", () => {
    expect(resolveInitialConversationId(convs, "conv_deleted")).toBe("conv_a");
  });

  it("falls back to the first conversation when nothing is stored", () => {
    expect(resolveInitialConversationId(convs, null)).toBe("conv_a");
  });

  it("returns null when there are no conversations", () => {
    expect(resolveInitialConversationId([], "conv_b")).toBeNull();
  });

  it("persists the active conversation id across reloads via localStorage", () => {
    const data = readFileSync("src/app/data.tsx", "utf8");
    expect(data).toContain('localStorage.setItem("pentou-active-conversation"');
    expect(data).toContain('localStorage.removeItem("pentou-active-conversation")');
    expect(data).toContain("resolveInitialConversationId(convs");
  });
});
