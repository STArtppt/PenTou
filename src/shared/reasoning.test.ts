import { describe, expect, it } from "vitest";
import {
  buildReasoning,
  extractReasoningFromBody,
  formatReasoningForMd,
  mergeReasoning,
  renderDoubaoSearchBlock,
  stripReasoningBlocks,
} from "./reasoning.js";

describe("buildReasoning / mergeReasoning", () => {
  it("omits empty segments and returns undefined when both empty", () => {
    expect(buildReasoning("", "  ")).toBeUndefined();
    expect(buildReasoning("search", "")).toEqual({ search: "search" });
    expect(buildReasoning(null, "think")).toEqual({ thinking: "think" });
  });

  it("merges non-empty segments with blank lines", () => {
    expect(
      mergeReasoning({ search: "a" }, { search: "b", thinking: "t" }),
    ).toEqual({ search: "a\n\nb", thinking: "t" });
    expect(mergeReasoning({ thinking: "x" }, undefined)).toEqual({ thinking: "x" });
  });
});

describe("formatReasoningForMd / extractReasoningFromBody roundtrip", () => {
  it("roundtrips both segments", () => {
    const reasoning = buildReasoning("搜索摘要", "思考过程");
    const md = formatReasoningForMd(reasoning) + "最终答案";
    const out = extractReasoningFromBody(md);
    expect(out.reasoning).toEqual(reasoning);
    expect(out.content).toBe("最终答案");
  });

  it("writes only thinking when search is absent", () => {
    const md = formatReasoningForMd(buildReasoning(undefined, "only think"));
    expect(md).toContain("reasoning:thinking");
    expect(md).not.toContain("reasoning:search");
  });

  it("treats unclosed comment as plain content", () => {
    const body = "<!-- reasoning:search -->\nno close\n\nanswer";
    const out = extractReasoningFromBody(body);
    expect(out.reasoning).toBeUndefined();
    expect(out.content).toContain("<!-- reasoning:search -->");
    expect(out.content).toContain("answer");
  });
});

describe("stripReasoningBlocks", () => {
  it("removes closed reasoning blocks anywhere in text", () => {
    const text = [
      "## AI",
      "<!-- reasoning:search -->",
      "secret query unique_reasoning_token",
      "<!-- /reasoning:search -->",
      "",
      "visible answer",
    ].join("\n");
    const stripped = stripReasoningBlocks(text);
    expect(stripped).not.toContain("secret query unique_reasoning_token");
    expect(stripped).toContain("visible answer");
  });
});

describe("renderDoubaoSearchBlock", () => {
  function makeResult(i: number, overrides: Record<string, unknown> = {}) {
    return {
      text_card: {
        title: `Title ${i}`,
        url: `https://example.com/${i}`,
        sitename: `Site ${i}`,
        summary: `Snippet ${i} with lots of detail that should not appear`,
        ...overrides,
      },
    };
  }

  it("renders summary, queries, and all results without truncating count", () => {
    const results = Array.from({ length: 14 }, (_, i) => makeResult(i + 1));
    const md = renderDoubaoSearchBlock({
      search_query_result_block: {
        summary: "搜索 3 个关键词，参考 14 篇资料",
        queries: ["q1", { query: "q2" }, { text: "q3" }],
        results,
      },
    });
    expect(md).toContain("搜索 3 个关键词，参考 14 篇资料");
    expect(md).toContain("**搜索词**");
    expect(md).toContain("- q1");
    expect(md).toContain("- q2");
    expect(md).toContain("- q3");
    expect(md).toContain("**参考资料**");
    expect(md).toContain("[Title 14](https://example.com/14)");
    // 14 条链接全保留，无编号列表
    expect(md.match(/\[Title \d+\]/g)?.length).toBe(14);
  });

  it("keeps title only — no snippet and no sitename", () => {
    const long = `${"a".repeat(100)}\n\n${"b".repeat(120)}`;
    const md = renderDoubaoSearchBlock({
      results: [makeResult(1, { summary: long, sitename: "ShouldNotAppear" })],
    });
    expect(md).toContain("[Title 1](https://example.com/1)");
    expect(md).not.toContain("ShouldNotAppear");
    expect(md).not.toContain("Snippet");
    expect(md).not.toContain("aaa");
    expect(md).not.toMatch(/^\d+\. /m);
  });

  it("outputs plain title without URL", () => {
    const md = renderDoubaoSearchBlock({
      results: [
        { text_card: { title: "No URL", sitename: "Site" } },
        { text_card: { title: "With URL", url: "https://ex.com/x" } },
      ],
    });
    expect(md).toContain("No URL");
    expect(md).not.toContain("[No URL]");
    expect(md).toContain("[With URL](https://ex.com/x)");
    expect(md).not.toContain("Site");
  });

  it("omits query and result sections when empty", () => {
    const md = renderDoubaoSearchBlock({
      search_query_result_block: {
        summary: "only summary",
        queries: [],
        results: [],
      },
    });
    expect(md).toBe("only summary");
    expect(md).not.toContain("**搜索词**");
    expect(md).not.toContain("**参考资料**");
  });
});
