/**
 * annotation-driven-rewrite — plane B 产品技能（批注驱动重写）。
 * 权威描述见 data/skills/annotation-driven-rewrite/SKILL.md。
 *
 * 本技能**只产出提案，不落盘**：确认与写入仍由既有的 `RewriteConfirmDialog` 完成
 * （design D5 —— 那个对话框就是这件事的「计划」，不该再套一层计划文档）。
 * 因此这里没有 commitVersion 调用；写权限校验先行，做不到就早失败，而不是等用户点了确认才报错。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { DEFAULT_PROMPT_REWRITE, buildRewritePrompt } from "../llm";
import { assertCanRewriteBody } from "./agent-write-policy";
import { apiGet } from "./skill-api";

export interface AnnotationDrivenRewriteOutput {
  docId: string;
  /** 提案正文，交给确认框展示与落盘；技能本身不写。 */
  proposedBody: string;
  annotationCount: number;
  usedAnnotationIds: string[];
}

interface DocPayload {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  generatedBy?: string;
  sourceConversationId?: string;
  sourceAiChatId?: string;
}

interface AnnotationPayload {
  id: string;
  comment?: string;
  range: { start: number; end: number };
}

export const annotationDrivenRewrite: SkillDef = {
  id: "annotation-driven-rewrite",
  inputSchema: {
    type: "object",
    properties: {
      docId: { type: "string" },
      annotationIds: { type: "array", items: { type: "string" } },
    },
    required: ["docId"],
    additionalProperties: false,
  },
  steps: [
    {
      id: "load",
      kind: "api",
      run: async (ctx: RunCtx): Promise<{ doc: DocPayload; annotations: AnnotationPayload[] }> => {
        const { docId, annotationIds } = ctx.input as { docId: string; annotationIds?: string[] };
        const [doc, stored] = await Promise.all([
          apiGet<DocPayload>(ctx.deps, `/api/documents/${docId}`),
          apiGet<{ annotations?: AnnotationPayload[] }>(ctx.deps, `/api/documents/${docId}/annotations`),
        ]);
        // 出身校验先行：改不了的文档不该让用户先等一次 LLM 调用再被拒绝
        assertCanRewriteBody(doc);

        const wanted = annotationIds?.length ? new Set(annotationIds) : null;
        const annotations = (stored.annotations ?? [])
          .filter((a) => a.comment?.trim())
          .filter((a) => !wanted || wanted.has(a.id));
        if (!annotations.length) throw new Error("这篇文档还没有带评论的批注，没有可依据的修改意见");
        return { doc, annotations };
      },
    },
    {
      id: "prompt",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<ChatMessage[]> => {
        const { doc, annotations } = ctx.results.load as { doc: DocPayload; annotations: AnnotationPayload[] };
        const system = ctx.deps.llmConfig.systemPromptRewriteByAnnotations || DEFAULT_PROMPT_REWRITE;
        return [
          { role: "system", content: system },
          { role: "user", content: buildRewritePrompt(doc as never, annotations as never) },
        ];
      },
    },
    {
      id: "rewrite",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<string> => {
        const messages = ctx.results.prompt as ChatMessage[];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        if (!content.trim()) throw new Error("模型没有产出任何内容");
        return content;
      },
    },
  ],
  buildOutput: (ctx: RunCtx): AnnotationDrivenRewriteOutput => {
    const { doc, annotations } = ctx.results.load as { doc: DocPayload; annotations: AnnotationPayload[] };
    return {
      docId: doc.id,
      proposedBody: ctx.results.rewrite as string,
      annotationCount: annotations.length,
      usedAnnotationIds: annotations.map((a) => a.id),
    };
  },
};
