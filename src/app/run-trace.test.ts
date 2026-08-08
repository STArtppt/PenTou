import { describe, expect, it } from "vitest";
import {
  buildCompactTrace,
  parseTraceFence,
  renderTraceFence,
  stripTraceFence,
  summarizeToolArgs,
} from "./run-trace";

describe("run-trace", () => {
  it("summarizeToolArgs 压成短摘要且截断过长字段", () => {
    const summary = summarizeToolArgs({
      projectId: "dp_default",
      query: "a".repeat(80),
      nested: { a: 1, b: 2 },
    });
    expect(summary).toContain("projectId=dp_default");
    expect(summary.length).toBeLessThanOrEqual(120);
    // 长字符串被截断，不是完整 80 个 a
    expect(summary).not.toContain("a".repeat(80));
  });

  it("buildCompactTrace 只留压缩字段", () => {
    const trace = buildCompactTrace({
      skillId: "doc-folder-organize",
      steps: [{ id: "inventory", kind: "api", status: "done", ms: 142 }],
      calls: [{ name: "list_documents", arguments: { projectId: "dp_default" }, status: "ok" }],
    });
    expect(trace).toEqual({
      skillId: "doc-folder-organize",
      steps: [{ id: "inventory", kind: "api", status: "done", ms: 142 }],
      calls: [{ name: "list_documents", argsSummary: "projectId=dp_default", status: "ok" }],
    });
    expect(JSON.stringify(trace)).not.toContain("result");
    expect(JSON.stringify(trace)).not.toContain("chunk");
  });

  it("render/parse 往返围栏块", () => {
    const trace = buildCompactTrace({
      skillId: "topic-digest",
      steps: [{ id: "search", kind: "api", status: "done", ms: 10 }],
      calls: [],
    });
    const fence = renderTraceFence(trace);
    expect(fence).toContain("```pentou-run-trace");
    expect(parseTraceFence(`总结正文\n\n${fence}\n`)).toEqual(trace);
  });

  it("stripTraceFence 剥离围栏块且不误伤普通代码块", () => {
    const body = [
      "已完成整理。",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "```pentou-run-trace",
      JSON.stringify({
        skillId: "x",
        steps: [{ id: "a", kind: "api", status: "done" }],
        calls: [],
      }),
      "```",
      "",
      "尾注",
    ].join("\n");

    const stripped = stripTraceFence(body);
    expect(stripped).toContain("```js");
    expect(stripped).toContain("const x = 1;");
    expect(stripped).toContain("尾注");
    expect(stripped).not.toContain("pentou-run-trace");
    expect(stripped).not.toContain('"skillId"');
  });
});
