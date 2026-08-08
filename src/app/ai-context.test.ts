import { describe, expect, it } from "vitest";
import { buildContextHeader, countWords, outlineOf, sectionOf, wantsCurrentViewBody } from "./ai-context";

const LONG_DOC = [
  "# 设计稿",
  "",
  "开场白。",
  "",
  "## 背景",
  "",
  "背景段落，很长很长。",
  "",
  "### 细节",
  "",
  "三级标题的内容也属于「背景」这一节。",
  "",
  "## 取舍",
  "",
  "取舍段落。",
  "",
  "```md",
  "# 这是代码块里的井号，不是标题",
  "```",
  "",
  "## 收尾",
  "",
  "收尾段落。",
].join("\n");

describe("大纲提取", () => {
  it("只取 H1–H2，跳过代码块里的井号", () => {
    expect(outlineOf(LONG_DOC)).toEqual([
      { level: 1, title: "设计稿" },
      { level: 2, title: "背景" },
      { level: 2, title: "取舍" },
      { level: 2, title: "收尾" },
    ]);
  });

  it("无标题的文本返回空大纲", () => {
    expect(outlineOf("就是一段普通文字。")).toEqual([]);
  });
});

describe("轻量上下文头", () => {
  const view = { kind: "doc" as const, title: "设计稿", text: LONG_DOC, hasUnsavedEdit: false };

  it("含标题 / 类型 / 字数 / 大纲，且**不含整篇正文**", () => {
    const header = buildContextHeader(view);
    expect(header).toContain("文档《设计稿》");
    expect(header).toContain("字数：约");
    expect(header).toContain("- 背景");
    expect(header).not.toContain("背景段落，很长很长。");
    expect(header).toContain("read_current_view");
  });

  it("便宜：远小于正文，量级在几百字符", () => {
    const bigDoc = { ...view, text: "正文。".repeat(4000) };
    const header = buildContextHeader(bigDoc);
    expect(header.length).toBeLessThan(400);
    expect(bigDoc.text.length).toBeGreaterThan(10000);
  });

  it("有未保存编辑时明确告知模型看到的是已保存正文", () => {
    expect(buildContextHeader({ ...view, hasUnsavedEdit: true })).toContain("未保存的编辑");
    expect(buildContextHeader(view)).not.toContain("未保存的编辑");
  });

  it("超长大纲二次收敛，不让大纲本身变成新的成本大头", () => {
    const many = Array.from({ length: 50 }, (_, i) => `## 第 ${i} 节\n内容`).join("\n");
    const header = buildContextHeader({ ...view, text: many });
    expect(header).toContain("共 50 节");
    expect(header.split("\n").filter((l) => l.startsWith("  - ")).length).toBeLessThanOrEqual(13);
  });

  it("没有视图时返回空串，而不是一个「无」占位", () => {
    expect(buildContextHeader(null)).toBe("");
  });

  it("会话视图标为会话", () => {
    expect(buildContextHeader({ ...view, kind: "chat" })).toContain("会话《设计稿》");
  });
});

describe("按节取用不腰斩", () => {
  it("返回该节完整文本，含其下的更低级标题", () => {
    const section = sectionOf(LONG_DOC, "背景")!;
    expect(section.startsWith("## 背景")).toBe(true);
    expect(section).toContain("背景段落，很长很长。");
    expect(section).toContain("### 细节");
    expect(section).toContain("三级标题的内容");
    expect(section).not.toContain("取舍段落");
  });

  it("超长节整段返回，一个字都不截", () => {
    const huge = `## 长节\n${"内容。".repeat(9000)}\n\n## 下一节\n短`;
    const section = sectionOf(huge, "长节")!;
    expect(section).toContain("内容。".repeat(9000));
    expect(section).not.toContain("已截断");
    expect(section).not.toContain("下一节");
  });

  it("最后一节取到文末", () => {
    expect(sectionOf(LONG_DOC, "收尾")).toContain("收尾段落。");
  });

  it("标题可带井号 / 大小写 / 首尾空白", () => {
    expect(sectionOf(LONG_DOC, "## 取舍 ")).toContain("取舍段落。");
    expect(sectionOf("## Design\nbody", "design")).toContain("body");
  });

  it("找不到的节返回 null，让调用方如实说没有", () => {
    expect(sectionOf(LONG_DOC, "不存在的节")).toBeNull();
    expect(sectionOf(LONG_DOC, "  ")).toBeNull();
  });
});

describe("是否明确指向当前视图（预取判定）", () => {
  it("带指示词的动词句命中", () => {
    for (const q of ["总结这篇文档", "帮我翻译本文", "根据以上内容重写这份材料", "summarize this document"]) {
      expect(wantsCurrentViewBody(q)).toBe(true);
    }
  });

  it("短促祈使句命中（没有别的宾语，指的必然是屏幕上这份）", () => {
    expect(wantsCurrentViewBody("总结一下")).toBe(true);
    expect(wantsCurrentViewBody("翻译")).toBe(true);
  });

  it("与当前视图无关的提问不命中，不付整篇正文的代价", () => {
    for (const q of [
      "我以前和 AI 聊过哪些关于本地优先的话题？",
      "帮我总结一下我上个月在别的项目里讨论过的所有检索方案的取舍和结论",
      "现在几点",
    ]) {
      expect(wantsCurrentViewBody(q)).toBe(false);
    }
  });
});

describe("字数估算", () => {
  it("中文按字、西文按词", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("你好 world")).toBe(3);
  });
});
