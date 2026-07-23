import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 回归：src/docs/debugging/2026-07-16-user-bubble-pre-intrinsic-overflow.md
// 用户气泡是 inline-block（shrink-to-fit），必须有 max-w-full 宽度上限，
// 否则子级 <pre> 的固有宽度（最长行）会把气泡撑出消息列，overflow-x-auto 永不触发。
describe("message bubble width containment", () => {
  it("caps the message bubble width so <pre> scrolls instead of overflowing", () => {
    const chatBody = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    expect(chatBody).toContain("max-w-full text-[15px] leading-7 markdown-body break-words");
    expect(chatBody).not.toContain("max-w-none");
  });
});
