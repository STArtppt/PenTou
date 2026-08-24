import { describe, expect, it } from "vitest";
import {
  ATTENTION_RANK_ALPHA,
  attentionWeight,
  effectiveRank,
  sortByAttention,
  sortByEffectiveRank,
} from "./attention";

describe("注意力权重", () => {
  it("已收藏为 1、未收藏为 0", () => {
    expect(attentionWeight({ favorite: true })).toBe(1);
    expect(attentionWeight({ favorite: false })).toBe(0);
    expect(attentionWeight({})).toBe(0);
  });

  it("入参是结构类型：会话 / 文档 / 检索命中三种形状都能直接喂", () => {
    const conv = { id: "conv_1", title: "会话", platform: "ChatGPT", favorite: true };
    const doc = { id: "doc_1", title: "文档", body: "", favorite: false };
    const hit = { type: "document" as const, id: "doc_1", score: -3.2, favorite: true };
    expect(attentionWeight(conv)).toBe(1);
    expect(attentionWeight(doc)).toBe(0);
    expect(attentionWeight(hit)).toBe(1);
  });
});

describe("列表侧稳定分组", () => {
  const items = [
    { id: "a" },
    { id: "b", favorite: true },
    { id: "c" },
    { id: "d", favorite: true },
  ];

  it("收藏整体前置，两组内部都保持传入顺序", () => {
    expect(sortByAttention(items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("全未收藏 / 全收藏 / 空数组时恒等于原顺序", () => {
    const none: Array<{ id: string; favorite?: boolean }> = [{ id: "a" }, { id: "b" }];
    const all = [{ id: "a", favorite: true }, { id: "b", favorite: true }];
    expect(sortByAttention(none).map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortByAttention(all).map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortByAttention([])).toEqual([]);
  });

  it("不原地改数组（调用方的时间排序结果不能被就地打乱）", () => {
    const input = [...items];
    sortByAttention(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("检索侧名次前移", () => {
  it("收藏项名次按 ALPHA 前移，未收藏项名次不变", () => {
    expect(effectiveRank(40, { favorite: true })).toBeCloseTo(40 * (1 - ATTENTION_RANK_ALPHA));
    expect(effectiveRank(40, {})).toBe(40);
  });

  it("相关度接近时收藏项上浮（前移 30%，越靠后前移越多）", () => {
    // rank 5 的收藏项 eff = 3.5：越过 rank 4，越不过 rank 3
    const hits = ["a", "b", "c", "d", "e"].map((id) => ({ id }) as { id: string; favorite?: boolean });
    const sorted = sortByEffectiveRank([...hits, { id: "fav", favorite: true }]);
    expect(sorted.map((h) => h.id)).toEqual(["a", "b", "c", "d", "fav", "e"]);
  });

  it("头部名次差距太小时不越位（前移是比例而非固定名次）", () => {
    // rank 1 的收藏项 eff = 0.7 > 0，越不过头名
    const hits = [{ id: "top" }, { id: "fav", favorite: true }, { id: "tail" }];
    expect(sortByEffectiveRank(hits).map((h) => h.id)).toEqual(["top", "fav", "tail"]);
  });

  it("是排序偏置而非过滤：强相关的未收藏项不被挤出，也不会被排到收藏项之后很远", () => {
    // 第 0 名未收藏 + 第 10 名收藏：10 * 0.7 = 7 > 0，头名仍在头名
    const hits = [
      { id: "top" },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `mid${i}` })),
      { id: "fav", favorite: true },
    ];
    const sorted = sortByEffectiveRank(hits);
    expect(sorted[0].id).toBe("top");
    expect(sorted.map((h) => h.id)).toContain("fav");
    expect(sorted).toHaveLength(hits.length);
  });

  it("权重全为 0 时恒等于原顺序（稳定）", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}` }) as { id: string; favorite?: boolean });
    expect(sortByEffectiveRank(hits).map((h) => h.id)).toEqual(hits.map((h) => h.id));
  });
});
