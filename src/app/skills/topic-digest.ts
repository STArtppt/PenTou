/**
 * topic-digest — plane B 产品技能（主题会话汇总）。
 * 权威描述见 data/skills/topic-digest/SKILL.md。
 *
 * 本期由**用户点名主题**（design D9）：给主题 → `/api/search` 检索 → 汇总成一篇文档。
 * 刻意不做无监督聚类 —— 826 条会话做 map-reduce 要 826 次客户端 LLM 调用，
 * 而自动发现出来的簇多半有一半是噪音。点名这条路今天就能用现成基础设施交付。
 *
 * 汇总是 **AI 自主产物**，因此落 AI 空间；被引用的会话一个字都不动（spec agent-write-policy）。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { apiSend, newDocId } from "./skill-api";
import { fetchRetrievalHits, type RetrievalHit } from "./ask-ai-context";
import { aiWorkspaceFolderId, projectKey } from "@/shared/ai-workspace";

const DEFAULT_TOP_K = 12;

const DIGEST_SYSTEM = `你在把一批零散的 AI 对话片段汇总成一篇可读的主题文档。要求：
1. 首行给一个 H1 标题，点出这个主题实际讨论了什么
2. 按子话题分 H2，把相关片段的结论合并，不要按片段罗列
3. 只写片段里确实有的内容；片段没覆盖到的地方明说「片段中未涉及」，不要补充常识
4. 结论优先，过程从简
5. 直接输出 Markdown，不要任何前后说明`;

export interface TopicDigestOutput {
  docId: string;
  folderId: string;
  topic: string;
  sourceCount: number;
  citations: { type: string; id: string; title: string }[];
}

export const topicDigest: SkillDef = {
  id: "topic-digest",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
      topK: { type: "integer" },
      projectId: { type: "string" },
    },
    required: ["topic"],
    additionalProperties: false,
  },
  steps: [
    {
      id: "search",
      kind: "api",
      run: async (ctx: RunCtx): Promise<RetrievalHit[]> => {
        const { topic, topK } = ctx.input as { topic: string; topK?: number };
        const hits = await fetchRetrievalHits(topic, ctx.deps, typeof topK === "number" ? topK : DEFAULT_TOP_K);
        if (!hits.length) throw new Error(`没有检索到与「${topic}」相关的内容，换个说法或换个主题试试`);
        return hits;
      },
    },
    {
      id: "prompt",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<ChatMessage[]> => {
        const { topic } = ctx.input as { topic: string };
        const hits = ctx.results.search as RetrievalHit[];
        const blocks = hits.map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.snippetText}`).join("\n\n");
        return [
          { role: "system", content: DIGEST_SYSTEM },
          { role: "user", content: `# 主题\n${topic}\n\n# 检索到的片段（共 ${hits.length} 条）\n\n${blocks}` },
        ];
      },
    },
    {
      id: "generate",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<string> => {
        const messages = ctx.results.prompt as ChatMessage[];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        if (!content.trim()) throw new Error("模型没有产出任何内容");
        return content;
      },
    },
    {
      id: "persist",
      kind: "api",
      run: async (ctx: RunCtx): Promise<{ docId: string; folderId: string }> => {
        const { topic, projectId } = ctx.input as { topic: string; projectId?: string };
        const hits = ctx.results.search as RetrievalHit[];
        const markdown = ctx.results.generate as string;
        const scope = projectId && projectId !== projectKey(null) ? projectId : null;
        const docId = newDocId();
        const folderId = aiWorkspaceFolderId(scope);
        const now = new Date().toISOString();

        // 来源清单落在正文里，用户一眼能查证汇总是从哪些东西来的
        const sources = hits.map((hit) => `- ${hit.title}（${hit.type === "conversation" ? "会话" : "文档"}）`).join("\n");
        await apiSend(ctx.deps, "POST", "/api/documents", {
          id: docId,
          title: `主题汇总 · ${topic}`,
          folderId,
          ...(scope ? { projectId: scope } : {}),
          createdAt: now,
          updatedAt: now,
          body: `${markdown.trimEnd()}\n\n---\n\n## 来源\n\n${sources}\n`,
          generatedBy: ctx.deps.llmConfig.model,
          generatedAt: now,
        });
        return { docId, folderId };
      },
    },
  ],
  buildOutput: (ctx: RunCtx): TopicDigestOutput => {
    const { topic } = ctx.input as { topic: string };
    const hits = (ctx.results.search as RetrievalHit[]) ?? [];
    const { docId, folderId } = ctx.results.persist as { docId: string; folderId: string };
    return {
      docId,
      folderId,
      topic,
      sourceCount: hits.length,
      citations: hits.map((hit) => ({ type: hit.type, id: hit.id, title: hit.title })),
    };
  },
};
