import { describe, expect, it, vi } from "vitest";
import { buildRunSummary } from "./build-run-summary";
import type { CompactRunTrace } from "./run-trace";

const traceAtStep = (stepId: string): CompactRunTrace => ({
  skillId: "x",
  steps: [
    { id: "a", kind: "api", status: "done", ms: 1 },
    { id: stepId, kind: "llm", status: "error", ms: 2 },
  ],
  calls: [],
});

describe("buildRunSummary", () => {
  it("topic-digest 含标题、落位与来源数", () => {
    const text = buildRunSummary({
      skillId: "topic-digest",
      status: "done",
      output: {
        topic: "检索排序",
        sourceCount: 12,
        citations: [
          { type: "conversation", id: "c1", title: "a" },
          { type: "conversation", id: "c2", title: "b" },
          { type: "document", id: "d1", title: "c" },
        ],
      },
    });
    expect(text).toContain("检索排序");
    expect(text).toContain("12");
    expect(text).toMatch(/2.*会话|会话.*2/);
    expect(text).toMatch(/1.*文档|文档.*1/);
    expect(text).toContain("AI 空间");
  });

  it("doc-folder-organize 含条目与候选数", () => {
    const text = buildRunSummary({
      skillId: "doc-folder-organize",
      status: "done",
      output: { planDocId: "doc_plan", itemCount: 5, candidateCount: 20, notes: ["重名文件夹"] },
    });
    expect(text).toContain("5");
    expect(text).toContain("20");
    expect(text).toContain("doc_plan");
    expect(text).toContain("重名文件夹");
  });

  it("conversation-to-doc 含标题与新建/覆盖", () => {
    const created = buildRunSummary({
      skillId: "conversation-to-doc",
      status: "done",
      output: { docId: "doc_1", title: "选型笔记", created: true },
    });
    expect(created).toContain("选型笔记");
    expect(created).toContain("doc_1");

    const updated = buildRunSummary({
      skillId: "conversation-to-doc",
      status: "done",
      output: { docId: "doc_1", title: "选型笔记", created: false },
    });
    expect(updated).toMatch(/更新|回滚/);
  });

  it("annotation-driven-rewrite 含批注数", () => {
    const text = buildRunSummary({
      skillId: "annotation-driven-rewrite",
      status: "done",
      output: { docId: "doc_x", annotationCount: 3, proposedBody: "..." },
    });
    expect(text).toContain("3");
    expect(text).toContain("doc_x");
  });

  it("未知 skillId 回退非空通用总结", () => {
    const text = buildRunSummary({
      skillId: "future-skill",
      status: "done",
      output: { docId: "doc_z", title: "产物" },
    });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toContain("future-skill");
    expect(text).toContain("doc_z");
  });

  it("失败总结含原因与推进步骤", () => {
    const text = buildRunSummary({
      skillId: "topic-digest",
      status: "error",
      error: "没有检索到相关内容",
      trace: traceAtStep("search"),
    });
    expect(text).toContain("没有检索到相关内容");
    expect(text).toContain("search");
  });

  it("渲染总结不发起任何 LLM 调用", () => {
    const callLLM = vi.fn();
    buildRunSummary({
      skillId: "topic-digest",
      status: "done",
      output: { topic: "x", sourceCount: 1, citations: [] },
    });
    buildRunSummary({
      skillId: "unknown",
      status: "done",
      output: { foo: 1 },
    });
    expect(callLLM).not.toHaveBeenCalled();
  });
});
