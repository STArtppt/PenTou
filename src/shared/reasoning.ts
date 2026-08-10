/**
 * 消息级 reasoning 共用工具（spec message-reasoning）。
 * 分隔符常量、归一化工厂、豆包搜索段渲染、.md 落盘/回读剥离。
 */
import type { MessageReasoning } from "../app/data.js";

export const REASONING_SEARCH_OPEN = "<!-- reasoning:search -->";
export const REASONING_SEARCH_CLOSE = "<!-- /reasoning:search -->";
export const REASONING_THINKING_OPEN = "<!-- reasoning:thinking -->";
export const REASONING_THINKING_CLOSE = "<!-- /reasoning:thinking -->";

/** 两段皆空返回 undefined；空段不写键。 */
export function buildReasoning(
  search?: string | null,
  thinking?: string | null,
): MessageReasoning | undefined {
  const s = typeof search === "string" ? search.trim() : "";
  const t = typeof thinking === "string" ? thinking.trim() : "";
  if (!s && !t) return undefined;
  const out: MessageReasoning = {};
  if (s) out.search = s;
  if (t) out.thinking = t;
  return out;
}

/** 合并同角色相邻消息时按段以空行拼接；非空段与空段合并取非空段。 */
export function mergeReasoning(
  a?: MessageReasoning | null,
  b?: MessageReasoning | null,
): MessageReasoning | undefined {
  const searchParts = [a?.search, b?.search]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const thinkParts = [a?.thinking, b?.thinking]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return buildReasoning(
    searchParts.length ? searchParts.join("\n\n") : undefined,
    thinkParts.length ? thinkParts.join("\n\n") : undefined,
  );
}

/**
 * 落盘：成对 HTML 注释，先 search 后 thinking；段为空整块不写。
 * 返回末尾带 `\n\n` 的块字符串，便于直接拼在 msg-ts 之后、正文之前。
 */
export function formatReasoningForMd(reasoning?: MessageReasoning | null): string {
  if (!reasoning) return "";
  const parts: string[] = [];
  if (reasoning.search?.trim()) {
    parts.push(
      `${REASONING_SEARCH_OPEN}\n${reasoning.search.trim()}\n${REASONING_SEARCH_CLOSE}`,
    );
  }
  if (reasoning.thinking?.trim()) {
    parts.push(
      `${REASONING_THINKING_OPEN}\n${reasoning.thinking.trim()}\n${REASONING_THINKING_CLOSE}`,
    );
  }
  if (parts.length === 0) return "";
  return `${parts.join("\n")}\n\n`;
}

/**
 * 从消息正文（已剥离 msg-ts）开头剥离 reasoning 注释块。
 * 未闭合注释按普通正文处理，不吞后文。
 */
export function extractReasoningFromBody(body: string): {
  reasoning?: MessageReasoning;
  content: string;
} {
  let rest = body;
  let search: string | undefined;
  let thinking: string | undefined;

  const tryExtract = (kind: "search" | "thinking"): string | undefined => {
    const re = new RegExp(
      `^<!--\\s*reasoning:${kind}\\s*-->\\s*\\n?([\\s\\S]*?)\\n?<!--\\s*/reasoning:${kind}\\s*-->\\s*(?:\\n|$)`,
    );
    const m = rest.match(re);
    if (!m) return undefined;
    rest = rest.slice(m[0].length);
    const val = m[1].trim();
    return val || undefined;
  };

  search = tryExtract("search");
  thinking = tryExtract("thinking");

  return {
    reasoning: buildReasoning(search, thinking),
    content: rest.trim(),
  };
}

/** 全文检索等：剥离全文中的 reasoning 注释块（不要求在开头）。 */
export function stripReasoningBlocks(text: string): string {
  return text
    .replace(
      /<!--\s*reasoning:search\s*-->[\s\S]*?<!--\s*\/reasoning:search\s*-->/g,
      "",
    )
    .replace(
      /<!--\s*reasoning:thinking\s*-->[\s\S]*?<!--\s*\/reasoning:thinking\s*-->/g,
      "",
    );
}

/**
 * 豆包 search_query_result_block → reasoning.search Markdown。
 * 版式：summary / 搜索词 / 参考资料（仅标题链接，无摘要、无 sitename）；
 * 结果条数不截断；链接用空格串成一行，便于面板渲染为胶囊行。
 */
export function renderDoubaoSearchBlock(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, any>;
  const search = root.search_query_result_block ?? root;

  const sections: string[] = [];

  const summary =
    typeof search?.summary === "string" ? search.summary.trim() : "";
  if (summary) sections.push(summary);

  const queries = Array.isArray(search?.queries)
    ? search.queries
        .map((q: any) =>
          typeof q === "string" ? q : q?.query || q?.text || "",
        )
        .map((q: string) => String(q).trim())
        .filter(Boolean)
    : [];
  if (queries.length > 0) {
    sections.push(["**搜索词**", ...queries.map((q: string) => `- ${q}`)].join("\n"));
  }

  const results = Array.isArray(search?.results) ? search.results : [];
  const links: string[] = [];
  for (const r of results) {
    const card = r?.text_card ?? r ?? {};
    const title = String(card?.title || card?.name || "").trim();
    const url = typeof card?.url === "string" ? card.url.trim() : "";
    if (!title && !url) continue;
    const label = title || url;
    // 只保留标题；有 URL 才生成链接（面板侧渲染为浅灰胶囊）
    links.push(url ? `[${label}](${url})` : label);
  }
  if (links.length > 0) {
    sections.push(["**参考资料**", links.join(" ")].join("\n"));
  }

  return sections.join("\n\n").trim();
}
