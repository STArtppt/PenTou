/**
 * attention.ts — 注意力权重（spec content-favorites）。
 *
 * 「我常看 / 我关注」这件事在库里只有一个真源：本文件的 `attentionWeight`。
 * 列表排序、检索加权、AI 上下文标注**一律读它返回的数值**，不去读 `favorite` 布尔 ——
 * 后续接入访问热度（`openCount` / `lastOpenedAt` 自动累计）时只改这里，消费方零改动。
 *
 * 本期只有收藏一个信号：已收藏 = 1，未收藏 = 0（design D1）。
 */

/**
 * 注意力信号。刻意写成**结构类型**而非 `Conversation | Document`：
 * 会话、文档、检索命中三种形状都能直接喂进来，将来加字段也不用改签名。
 */
export interface AttentionSignals {
  favorite?: boolean;
  // 演进位（本期不写、不读、不落盘）：
  // openCount?: number;
  // lastOpenedAt?: string;
}

/** 权重 ∈ [0, 1]。本期二值，将来接热度后是连续值 —— 消费方按数值用，别按布尔用。 */
export function attentionWeight(item: AttentionSignals): number {
  return item.favorite ? 1 : 0;
}

/**
 * 列表侧的**稳定分组**：权重高的整体前置，组内保持传入顺序（design D5）。
 * 调用方先按自己的口径排好序（时间等），再套这一层 —— 分组不改组内秩序。
 *
 * 与检索侧的"名次前移"软加权刻意不同：列表里没有相关度，用户点亮就是要它置顶。
 */
export function sortByAttention<T extends AttentionSignals>(items: T[]): T[] {
  const weighted = items.filter((item) => attentionWeight(item) > 0);
  if (weighted.length === 0 || weighted.length === items.length) return [...items];
  return [...weighted, ...items.filter((item) => attentionWeight(item) === 0)];
}

/** 检索侧加权强度（design D5）：收藏项名次前移 30%，挤不掉真正的强相关命中。 */
export const ATTENTION_RANK_ALPHA = 0.3;

/**
 * 名次前移：`effectiveRank = rank * (1 - ALPHA * weight)`。
 * 不碰原始分数 —— bm25 是负值升序、RRF 是正值降序，没有一个乘法因子对两者都安全。
 */
export function effectiveRank(rank: number, item: AttentionSignals): number {
  return rank * (1 - ATTENTION_RANK_ALPHA * attentionWeight(item));
}

/**
 * 按加权名次稳定重排。传入顺序即原始名次（0 起），权重全为 0 时恒等于原顺序。
 */
export function sortByEffectiveRank<T extends AttentionSignals>(items: T[]): T[] {
  return items
    .map((item, rank) => ({ item, rank, eff: effectiveRank(rank, item) }))
    .sort((a, b) => (a.eff === b.eff ? a.rank - b.rank : a.eff - b.eff))
    .map((entry) => entry.item);
}

/**
 * `?favorite=1` 过滤开关（spec content-favorites）：会话 / 文档 / 检索三处列表共用同一判定。
 * 不传该参数时调用方 MUST 走原路径 —— 缺省行为与本能力上线前逐字节一致。
 */
export function favoriteOnlyMode(url: string): boolean {
  return /[?&]favorite=1(\b|&|$)/.test(url);
}
