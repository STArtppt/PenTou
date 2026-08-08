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

// 用户消息：头像与气泡右对齐；AI 保持左对齐。
describe("user message right alignment", () => {
  it("right-aligns user avatar/header and bubble, keeps AI on the left", () => {
    const chatBody = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    expect(chatBody).toContain('isUser && "flex-row-reverse"');
    expect(chatBody).toContain('align={isUser ? "right" : "left"}');
    expect(chatBody).toContain('isUser && "text-right"');
    expect(chatBody).toContain("rounded-tr-sm");
    expect(chatBody).not.toContain("rounded-tl-sm");
  });
});

// 正文不预留头像槽：桌面留槽会让消息左/右边界与拉通全宽的元数据面板对不齐。
describe("message body has no avatar gutter", () => {
  it("keeps desktop body flush with the avatar column", () => {
    const chatBody = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    expect(chatBody).not.toContain("md:pl-12");
    expect(chatBody).not.toContain("md:pr-12");
  });
});
