/**
 * ask-ai-context — plane B 产品技能（spec ask-ai-context）。
 * 工作流（线性）：api 语义检索 → transform 组上下文+套 prompt → llm 客户端作答。
 * 权威描述见 data/skills/ask-ai-context/SKILL.md；本文件是 runner 的可执行定义，须与之对齐。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { DEFAULT_PROMPT_AI_SIDEBAR } from "../llm";

/** /api/search 命中片段（与 src/server/search-service SearchHit 的消费子集）。 */
export interface RetrievalHit {
  type: "conversation" | "document";
  id: string;
  title: string;
  snippetText: string;
  /** 命中时间与相关度评分（topic-digest 的统计与排序要用；侧栏问答不消费）。 */
  date?: string;
  score?: number;
  /** 注意力信号回显（spec content-favorites）：服务端已按权重排过序，客户端不再另排。 */
  favorite?: boolean;
  weight?: number;
}

const DEFAULT_TOP_K_INTERNAL = 6;

/**
 * 语义检索 building block：经 `GET /api/search` 取命中片段。
 * 技能的 `search` 步与前端 Ask AI 侧栏共用同一路径（同一 `/api/*` 契约）。
 */
export async function fetchRetrievalHits(
  query: string,
  deps: { apiBase: string; fetchImpl: typeof fetch },
  topK: number = DEFAULT_TOP_K_INTERNAL,
): Promise<RetrievalHit[]> {
  const url = `${deps.apiBase}/api/search?q=${encodeURIComponent(query)}&mode=hybrid&limit=${topK}`;
  const res = await deps.fetchImpl(url);
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  const data = (await res.json()) as { hits?: RetrievalHit[] };
  return data.hits ?? [];
}

/**
 * 把命中片段格式化为可注入上下文的文本块；无命中返回明确标记。
 *
 * 收藏项标 `★`（spec content-favorites）：**只标「有」不标「无」** —— 给每条挂一句
 * 「未收藏」纯属 token 噪声，还会让模型把未收藏读成负面信号。
 * 顺序直接沿用服务端返回的顺序（已按权重加权），客户端 MUST NOT 另立一套权重规则。
 */
export function formatContextBlock(hits: RetrievalHit[]): string {
  if (!hits.length) return "（无检索命中）";
  const block = hits
    .map((h, i) => `[${i + 1}]${h.favorite ? " ★" : ""} ${h.title}\n${h.snippetText}`)
    .join("\n\n");
  return hits.some((h) => h.favorite) ? `${block}\n\n（★ = 我收藏的，优先阅读）` : block;
}

export interface AskAiCitation {
  type: "conversation" | "document";
  id: string;
  title: string;
}
export interface AskAiOutput {
  answer: string;
  citations: AskAiCitation[];
}

export const askAiContext: SkillDef = {
  id: "ask-ai-context",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      scope: { type: "string" },
      topK: { type: "integer" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  steps: [
    {
      id: "search",
      kind: "api",
      run: async (ctx: RunCtx): Promise<RetrievalHit[]> => {
        const { query, topK } = ctx.input as { query: string; topK?: number };
        return fetchRetrievalHits(query, ctx.deps, typeof topK === "number" ? topK : undefined);
      },
    },
    {
      id: "context",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<ChatMessage[]> => {
        const { query, scope } = ctx.input as { query: string; scope?: string };
        const hits = (ctx.results.search as RetrievalHit[]) ?? [];
        const contextBlock = formatContextBlock(hits);
        const userContent = [
          scope ? `# 当前上下文\n${scope}` : "",
          `# 检索片段\n${contextBlock}`,
          `# 问题\n${query}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        return [
          { role: "system", content: DEFAULT_PROMPT_AI_SIDEBAR },
          { role: "user", content: userContent },
        ];
      },
    },
    {
      id: "answer",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<string> => {
        const messages = ctx.results.context as ChatMessage[];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        return content;
      },
    },
  ],
  buildOutput: (ctx: RunCtx): AskAiOutput => {
    const answer = (ctx.results.answer as string) ?? "";
    const hits = (ctx.results.search as RetrievalHit[]) ?? [];
    const citations: AskAiCitation[] = hits.map((h) => ({ type: h.type, id: h.id, title: h.title }));
    return { answer, citations };
  },
};
