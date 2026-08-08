/**
 * 入口收编的源码级断言（spec ai-intent-chips「收编分散的 AI 入口并保留消息级摘录」）。
 * 这些不变量靠代码审查守不住 —— 一次「顺手加回来」就会重新分叉，所以钉成测试。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");

const TOP_TOOLBAR = read("src/app/components/TopToolbar.tsx");
const CHAT_BODY = read("src/app/components/ChatBody.tsx");
const AI_SIDEBAR = read("src/app/components/AiSidebar.tsx");

describe("顶栏按钮已移除，能力经 chip 保留", () => {
  it("顶栏不再有「转文档」与「让 AI 重写」按钮", () => {
    expect(TOP_TOOLBAR).not.toContain("toolbar.rewriteByAnnotations");
    expect(TOP_TOOLBAR).not.toContain("toolbar.convertToDoc");
    expect(TOP_TOOLBAR).not.toContain("RewriteConfirmDialog");
  });

  it("两项能力都能在 AI 侧栏的 chip 里找到", () => {
    for (const key of ["chipConvertToDoc", "chipRewriteByAnnotations"]) {
      expect(read("src/app/ai-chips.ts")).toContain(key);
    }
    expect(AI_SIDEBAR).toContain("ChipBar");
  });
});

describe("转文档只有一份实现", () => {
  it("顶栏与会话正文都不再各存一份 handleConvertToDoc", () => {
    expect(TOP_TOOLBAR).not.toContain("handleConvertToDoc");
    expect(CHAT_BODY).not.toContain("handleConvertToDoc");
  });

  it("组件层不再直接调 convertConversationToDocument —— 收敛到 conversation-to-doc 技能", () => {
    const components = fs
      .readdirSync(path.resolve(process.cwd(), "src/app/components"))
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
    const offenders = components.filter((f) =>
      read(`src/app/components/${f}`).includes("convertConversationToDocument"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("消息级摘录入口保留", () => {
  it("ChatBody 仍有 handleExcerptMessage 并挂在消息的悬浮入口上", () => {
    // chip 无法表达「哪一条消息」，这个入口的语义依赖消息自身的悬浮 UI
    expect(CHAT_BODY).toContain("handleExcerptMessage");
    expect(CHAT_BODY).toContain("onExcerpt={() => handleExcerptMessage(msg)}");
    expect(CHAT_BODY).toContain("excerptConversationToDoc");
  });
});

describe("chip 展示不产生 LLM 调用", () => {
  it("chip 列表来自纯同步模块，不含任何请求或 LLM 调用", () => {
    const source = read("src/app/ai-chips.ts");
    for (const token of ["fetch(", "await ", "chatCompletion", "runSkill", "callLLM"]) {
      expect(source).not.toContain(token);
    }
  });
});

describe("AI 生成的可见标记（design 风险项缓解）", () => {
  it("侧栏文档行与文档顶栏都按出身给出标记", () => {
    const sidebar = read("src/app/components/Sidebar.tsx");
    expect(sidebar).toContain("isAiGenerated(doc)");
    expect(sidebar).toContain("doc.aiGenerated");
    expect(TOP_TOOLBAR).toContain("isAiGenerated(activeDoc)");
    expect(TOP_TOOLBAR).toContain("doc.aiGenerated");
  });

  it("标记与写权限用同一个判据，不会出现「标了却改不了」", () => {
    for (const file of ["src/app/components/Sidebar.tsx", "src/app/components/TopToolbar.tsx"]) {
      expect(read(file)).toContain('from "../skills/agent-write-policy"');
    }
  });

  it("中英文案都在 i18n 里，没有硬编码", () => {
    const i18n = read("src/app/i18n.ts");
    expect(i18n).toContain('"doc.aiGenerated": "AI-generated"');
    expect(i18n).toContain('"doc.aiGenerated": "AI 生成"');
  });
});

