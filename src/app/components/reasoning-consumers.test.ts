/**
 * 下游消费方对 reasoning 的边界断言（spec message-reasoning）。
 * 复制 / 摘录 / RightNav 预览只取 content，不取 reasoning。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildExcerptSections } from "../doc-utils";

describe("downstream consumers exclude reasoning", () => {
  it("MessageActions copy only receives message.content", () => {
    const chatBody = readFileSync("src/app/components/ChatBody.tsx", "utf8");
    // 复制按钮只传 content，不传 reasoning（紧邻调用点断言）
    expect(chatBody).toMatch(
      /<MessageActions\s+content=\{message\.content\}/,
    );
    // MessageActions 自身 props 只有 content，无 reasoning 字段
    expect(chatBody).toMatch(
      /function MessageActions\(\{\s*content,\s*onExcerpt,\s*excerpting,\s*align/,
    );
    expect(chatBody).not.toMatch(/function MessageActions\([^)]*reasoning/);
  });

  it("excerptConversationToDoc only takes msg.content", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant" as const,
        content: "最终答案",
        reasoning: { search: "不应出现的搜索", thinking: "不应出现的思考" },
      },
    ];
    const sections = buildExcerptSections(messages as any);
    expect(sections).toContain("最终答案");
    expect(sections).not.toContain("不应出现的搜索");
    expect(sections).not.toContain("不应出现的思考");

    const docUtils = readFileSync("src/app/doc-utils.ts", "utf8");
    expect(docUtils).toContain("msg.content");
    expect(docUtils).not.toMatch(/msg\.reasoning/);
  });

  it("RightNav hover preview uses msg.content", () => {
    const rightNav = readFileSync("src/app/components/RightNav.tsx", "utf8");
    expect(rightNav).toContain("content: msg.content");
    expect(rightNav).not.toMatch(/msg\.reasoning/);
  });
});
