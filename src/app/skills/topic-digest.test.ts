/**
 * 主题汇总的确定性部分：截断、分桶统计、来源清单拼装。
 * 这三样刻意都不经模型（spec topic-digest-format），因此它们必须能脱离 LLM 单测。
 */
import { describe, expect, it } from "vitest";
import {
  bucketCount,
  computeStats,
  renderCitations,
  truncateDeepRead,
  type EnrichedHit,
  DEEP_READ_HEAD_CHARS,
  DEEP_READ_TAIL_CHARS,
} from "./topic-digest";

const marker = (n: number) => `\n\n……（此处略去 ${n} 条消息）……\n\n`;

describe("深读截断（design D3）", () => {
  it("未超限时原样返回", () => {
    const blocks = ["短消息一", "短消息二"];
    expect(truncateDeepRead(blocks, marker)).toEqual({ text: "短消息一\n\n短消息二", omitted: 0 });
  });

  it("超限时保留头尾、丢中段并标注略去条数", () => {
    // 每条 1000 字，共 20 条 = 约 20038 字 > 12000
    const blocks = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(1000, "字"));
    const { text, omitted } = truncateDeepRead(blocks, marker);

    expect(text.startsWith("0")).toBe(true); // 开头是第一条
    expect(text.endsWith("字")).toBe(true); // 结尾是最后一条
    expect(text).toContain("略去");
    expect(omitted).toBeGreaterThan(0);
    expect(omitted).toBeLessThan(20);
    // 头尾长度按 D3 的 8000 / 4000
    expect(text.indexOf("略去")).toBeGreaterThan(DEEP_READ_HEAD_CHARS - 50);
    expect(text.length - text.lastIndexOf("……\n\n")).toBeGreaterThan(DEEP_READ_TAIL_CHARS - 50);
  });

  it("结尾的结论不会被截掉（从中间截而不是从开头截）", () => {
    const blocks = [
      "开头的问题",
      ...Array.from({ length: 30 }, () => "中间的过程".padEnd(1000, "程")),
      "最后的结论：就选 A 方案",
    ];
    const { text } = truncateDeepRead(blocks, marker);
    expect(text).toContain("开头的问题");
    expect(text).toContain("最后的结论：就选 A 方案");
  });

  it("单条超长消息也给得出诚实的略去条数（完全落在中段的才算）", () => {
    const blocks = ["头", "巨".repeat(30000), "尾"];
    const { omitted } = truncateDeepRead(blocks, marker);
    expect(omitted).toBe(0); // 那条巨长消息只是被截了一部分，不算「整条略去」
  });
});

describe("多维分桶统计", () => {
  it("按条数降序，缺失值归入未标注", () => {
    expect(bucketCount(["A", "B", "A", "A", undefined, ""], "未标注")).toEqual([
      ["A", 3],
      ["未标注", 2],
      ["B", 1],
    ]);
  });

  it("四个维度齐备，时间按月分桶", () => {
    const hits: EnrichedHit[] = [
      {
        type: "conversation", id: "c1", title: "一", snippetText: "",
        platform: "Claude", ingestSource: "cli:claude-code", sourceProject: "pentou",
        date: "2026-06-14T08:00:00.000Z",
      },
      {
        type: "conversation", id: "c2", title: "二", snippetText: "",
        platform: "Claude", ingestSource: "plugin", sourceProject: "pentou",
        date: "2026-06-30T08:00:00.000Z",
      },
      {
        type: "document", id: "d1", title: "三", snippetText: "",
        date: "2026-05-02T08:00:00.000Z",
      },
    ];
    const stats = computeStats(hits, "未标注");

    expect(stats.total).toBe(3);
    expect(stats.platform).toEqual([["Claude", 2], ["未标注", 1]]);
    expect(stats.ingestSource).toEqual([["cli:claude-code", 1], ["plugin", 1], ["未标注", 1]]);
    expect(stats.project).toEqual([["pentou", 2], ["未标注", 1]]);
    expect(stats.month).toEqual([["2026-06", 2], ["2026-05", 1]]);
  });
});

describe("来源清单", () => {
  const hits: EnrichedHit[] = [
    { type: "conversation", id: "conv_a", title: "选型讨论", snippetText: "", platform: "Claude", date: "2026-06-14T08:00:00.000Z" },
    { type: "document", id: "doc_b", title: "存储设计", snippetText: "" },
  ];

  it("每条是可点击的应用内链接，并带上辨认信息", () => {
    const md = renderCitations(hits, "zh");
    expect(md).toContain("[选型讨论](pentou://conversation/conv_a)");
    expect(md).toContain("Claude");
    expect(md).toContain("2026-06-14");
    expect(md).toContain("[存储设计](pentou://document/doc_b)");
  });

  it("英文界面下用英文类型标签", () => {
    expect(renderCitations(hits, "en")).toContain("（conversation · Claude · 2026-06-14）");
  });
});
