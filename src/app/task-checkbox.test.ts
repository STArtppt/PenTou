import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTaskLine, toggleTaskLine } from "./task-checkbox";

const BODY = [
  "# 整理计划",
  "",
  "已默认全部勾选，取消勾选即表示不采纳该条。",
  "",
  "## 待办",
  "",
  "- [x] 把《甲》归入「设计文档」",
  "- [ ] 把《乙》归入「开发记录」",
  "  - [X] 嵌套的一条",
  "",
  "普通段落，含 `- [ ]` 这样的行内代码不该被当成任务项来数。",
].join("\n");

describe("toggleTaskLine", () => {
  it("勾选 → 取消勾选", () => {
    const next = toggleTaskLine(BODY, 7);
    expect(next.split("\n")[6]).toBe("- [ ] 把《甲》归入「设计文档」");
  });

  it("取消勾选 → 勾选", () => {
    const next = toggleTaskLine(BODY, 8);
    expect(next.split("\n")[7]).toBe("- [x] 把《乙》归入「开发记录」");
  });

  it("嵌套列表按行号定位，且识别大写 [X]", () => {
    const next = toggleTaskLine(BODY, 9);
    expect(next.split("\n")[8]).toBe("  - [ ] 嵌套的一条");
  });

  it("只改目标行，其余字符逐字节不变", () => {
    const next = toggleTaskLine(BODY, 8);
    const before = BODY.split("\n");
    const after = next.split("\n");
    expect(after).toHaveLength(before.length);
    after.forEach((line, i) => {
      if (i === 7) return;
      expect(line).toBe(before[i]);
    });
  });

  it("非任务行调用时原样返回", () => {
    expect(toggleTaskLine(BODY, 1)).toBe(BODY);
    expect(toggleTaskLine(BODY, 11)).toBe(BODY);
  });

  it("行号越界或非法时原样返回", () => {
    expect(toggleTaskLine(BODY, 0)).toBe(BODY);
    expect(toggleTaskLine(BODY, 999)).toBe(BODY);
    expect(toggleTaskLine(BODY, 1.5)).toBe(BODY);
  });

  it("翻转两次回到原状", () => {
    expect(toggleTaskLine(toggleTaskLine(BODY, 8), 8)).toBe(BODY);
  });

  it("支持 * / + / 有序列表三种列表符", () => {
    expect(toggleTaskLine("* [ ] a", 1)).toBe("* [x] a");
    expect(toggleTaskLine("+ [x] a", 1)).toBe("+ [ ] a");
    expect(toggleTaskLine("1. [ ] a", 1)).toBe("1. [x] a");
  });
});

describe("isTaskLine", () => {
  it("识别任务行与非任务行", () => {
    expect(isTaskLine("- [ ] 甲")).toBe(true);
    expect(isTaskLine("   - [X] 甲")).toBe(true);
    expect(isTaskLine("- 甲")).toBe(false);
    expect(isTaskLine("正文里的 - [ ] 不算")).toBe(false);
  });
});

/**
 * `versionType: "none"` 是**通用能力**，误用会让真正的编辑不留版本（design D9 安全边界）。
 * 因此这里钉住：整个客户端只有复选框写回这一条路径传它。
 */
describe("versionType opt-out 的使用边界", () => {
  const data = readFileSync("src/app/data.tsx", "utf8");

  it("复选框写回路径带 versionType: \"none\"", () => {
    expect(data).toContain("toggleDocumentTask");
    expect(data).toMatch(/toggleTaskLine\(current, line\)/);
    expect(data).toMatch(/body,\s*versionType:\s*"none"/);
  });

  it("编辑器保存路径不传 versionType，仍正常建版本", () => {
    const saveBody = data.slice(
      data.indexOf("const saveDocumentBody"),
      data.indexOf("预览界面勾选任务复选框"),
    );
    expect(saveBody).toContain("JSON.stringify({ body: newBody })");
    expect(saveBody).not.toContain("versionType");
  });

  it("客户端只有一处传 versionType: \"none\"", () => {
    const files = [
      "src/app/data.tsx",
      "src/app/components/DocEditor.tsx",
      "src/app/skills/topic-digest.ts",
      "src/app/skills/doc-folder-organize.ts",
      "src/app/skills/plan-doc.ts",
      "src/app/skills/run-plan.ts",
      "src/app/skills/conversation-to-doc.ts",
      "src/app/skills/annotation-driven-rewrite.ts",
      "src/app/skills/tool-executor.ts",
    ];
    const hits = files.filter((f) => /versionType:\s*"none"/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual(["src/app/data.tsx"]);
  });
});
