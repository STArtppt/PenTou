/**
 * ai-context.ts — 当前视图上下文的加载策略（spec ask-ai-context）。
 *
 * 从「每轮无条件注入整篇正文 + 中段腰斩」改为：
 *   eager  —— 一个约 200 字符的**轻量头**（标题 / 类型 / 字数 / H1–H2 大纲 / 是否有未保存编辑）
 *   lazy   —— 正文经 `read_current_view` 工具按需取，可只取某一节
 *
 * 为什么不是纯 lazy：最高频的「总结这篇文档」在纯 lazy 下要多一次往返，且弱模型可能
 * 不调工具就瞎答。轻量头让模型有足够信息判断该不该取正文，成本却从 12000 字符降到约 200；
 * 对明确指向当前视图的措辞（`wantsCurrentViewBody`）再在派发层直接预取，把回归风险压掉。
 */

import { attentionWeight } from "@/shared/attention";

export interface ViewContext {
  kind: "doc" | "chat";
  title: string;
  /** 完整正文，**不做任何截断** —— 它只在按需取用时才进提示词。 */
  text: string;
  hasUnsavedEdit: boolean;
  /** 收藏（spec content-favorites）：经 attentionWeight 折算成权重后决定要不要标注。 */
  favorite?: boolean;
}

const MAX_OUTLINE_ENTRIES = 12;

export interface OutlineEntry {
  level: 1 | 2;
  title: string;
}

/** 取 H1–H2 大纲。代码块里的 `#` 不是标题，必须跳过，否则大纲会被注释行污染。 */
export function outlineOf(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
    if (m) entries.push({ level: m[1].length as 1 | 2, title: m[2].trim() });
  }
  return entries;
}

/** 字数：中文按字、西文按词，取二者之和 —— 只是给模型一个量级，不需要精确。 */
export function countWords(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + words;
}

/**
 * 轻量上下文头。没有视图时返回空串 —— 调用方据此完全不注入这一段，
 * 而不是注入一个「（无）」让模型以为有个空文档。
 */
export function buildContextHeader(view: ViewContext | null): string {
  if (!view) return "";
  const outline = outlineOf(view.text);
  const shown = outline.slice(0, MAX_OUTLINE_ENTRIES);
  const lines = [
    `当前视图：${view.kind === "doc" ? "文档" : "会话"}《${view.title}》`,
    `字数：约 ${countWords(view.text)}`,
  ];
  if (shown.length) {
    lines.push("大纲：");
    for (const entry of shown) lines.push(`${entry.level === 1 ? "- " : "  - "}${entry.title}`);
    if (outline.length > shown.length) lines.push(`  …（共 ${outline.length} 节，其余略）`);
  }
  // 注意力标注（spec content-favorites）：只标「有」不标「无」，避免每轮都塞一句无信息量的否定。
  if (attentionWeight(view) > 0) lines.push("★ 已收藏（用户常看的内容，优先阅读）");
  if (view.hasUnsavedEdit) lines.push("注意：有未保存的编辑，你看到的是已保存的正文。");
  lines.push("正文没有直接给你 —— 需要时用 read_current_view 取，可以只取某一节。");
  return lines.join("\n");
}

/**
 * 按标题取一节的**完整**文本（标题行 + 内容，直到下一个同级或更高级标题）。
 * 返回完整文本而非截断结果 —— 按节取用的全部意义就是绕开中段腰斩。
 * 匹配对大小写与首尾空白宽松，找不到返回 null 让调用方如实说「没有这一节」。
 */
export function sectionOf(markdown: string, heading: string): string | null {
  const want = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  if (!want) return null;
  const lines = markdown.split("\n");
  let start = -1;
  let level = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    if (start < 0) {
      if (m[2].trim().toLowerCase() === want) {
        start = i;
        level = m[1].length;
      }
      continue;
    }
    if (m[1].length <= level) return lines.slice(start, i).join("\n").trimEnd();
  }
  return start < 0 ? null : lines.slice(start).join("\n").trimEnd();
}

const VIEW_VERBS = /总结|概括|摘要|归纳|翻译|重写|改写|润色|校对|summar|translat|rewrite|proofread|polish|tl;?dr/i;
const DEICTIC = /本文|这篇|该文|这份|这段|当前|全文|上面|以上|this |it\b/i;
const SHORT_COMMAND_LENGTH = 12;

/**
 * 这句话是否明确指向「当前正在看的东西」（design 风险项缓解）。
 * 命中时派发层直接预取正文，不等模型开口 —— 弱模型不调工具就瞎答的回归风险主要在这里。
 * 短促的祈使句（「总结一下」）没有别的宾语，指的必然是屏幕上这份。
 */
export function wantsCurrentViewBody(question: string): boolean {
  const text = question.trim();
  if (!VIEW_VERBS.test(text)) return false;
  return DEICTIC.test(text) || text.length <= SHORT_COMMAND_LENGTH;
}
