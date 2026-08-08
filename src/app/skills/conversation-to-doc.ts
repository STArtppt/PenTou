/**
 * conversation-to-doc — plane B 产品技能（会话转文档）。
 * 权威描述见 data/skills/conversation-to-doc/SKILL.md；本文件是 runner 的可执行定义，须与之对齐。
 *
 * 落位按 design D3：产物是**用户点名要的**，所以落用户的地盘而不是 AI 空间 ——
 * 来源带项目属性就继承该项目，跨项目或没有项目属性则落默认目录。
 *
 * 「同一会话再转一次」会覆盖既有正文。在新权限模型下这属于「AI 改自己生成的文档」，允许；
 * 但**必须**走 commit-version，回滚路径可用是该行为可被接受的唯一前提。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { serializeConversation, DEFAULT_PROMPT_CONVERT } from "../llm";
import { assertBodyRewrite } from "./agent-write-policy";
import { apiGet, apiSend, newDocId, titleFromMarkdown, type DocMeta } from "./skill-api";
import { resolveProductProjectId } from "@/shared/ai-workspace";

export interface ConversationToDocOutput {
  docId: string;
  title: string;
  /** true = 新建；false = 覆盖既有产物（已落新版本，可回滚）。 */
  created: boolean;
  projectId: string | null;
  versionId?: string;
}

interface ConversationPayload {
  id: string;
  title: string;
  platform?: string;
  projectId?: string | null;
  messages: { role: string; content: string }[];
}

export const conversationToDoc: SkillDef = {
  id: "conversation-to-doc",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      projectId: { type: "string" },
    },
    required: ["conversationId"],
    additionalProperties: false,
  },
  steps: [
    {
      id: "load",
      kind: "api",
      run: async (ctx: RunCtx): Promise<ConversationPayload> => {
        const { conversationId } = ctx.input as { conversationId: string };
        return apiGet<ConversationPayload>(ctx.deps, `/api/conversations/${conversationId}`);
      },
    },
    {
      id: "prompt",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<ChatMessage[]> => {
        const conv = ctx.results.load as ConversationPayload;
        return [
          { role: "system", content: DEFAULT_PROMPT_CONVERT },
          { role: "user", content: serializeConversation(conv as never) },
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
      run: async (ctx: RunCtx): Promise<ConversationToDocOutput> => {
        const conv = ctx.results.load as ConversationPayload;
        const markdown = ctx.results.generate as string;
        const title = titleFromMarkdown(markdown, conv.title);
        const projectId = resolveProductProjectId([
          (ctx.input as { projectId?: string }).projectId ?? conv.projectId ?? null,
        ]);

        const docs = await apiGet<DocMeta[]>(ctx.deps, "/api/documents?fields=meta");
        const existing = docs.find((doc) => doc.sourceConversationId === conv.id);
        const now = new Date().toISOString();

        if (existing) {
          // 覆盖既有产物：先过写权限，再落新版本 —— 旧正文永远留得下来
          const endpoint = `/api/documents/${existing.id}/commit-version`;
          assertBodyRewrite(existing, endpoint);
          const saved = await apiSend<{ version?: { id: string } }>(ctx.deps, "POST", endpoint, {
            body: markdown,
            type: "llm-rewrite",
          });
          await apiSend(ctx.deps, "PUT", `/api/documents/${existing.id}`, {
            title,
            generatedBy: ctx.deps.llmConfig.model,
            generatedAt: now,
          });
          return {
            docId: existing.id,
            title,
            created: false,
            projectId: existing.projectId ?? null,
            versionId: saved.version?.id,
          };
        }

        const docId = newDocId();
        await apiSend(ctx.deps, "POST", "/api/documents", {
          id: docId,
          title,
          folderId: null, // 落用户地盘的「未分类」，不是 AI 空间（design D3）
          ...(projectId ? { projectId } : {}),
          createdAt: now,
          updatedAt: now,
          body: markdown,
          sourceConversationId: conv.id,
          ...(conv.platform ? { sourcePlatform: conv.platform } : {}),
          generatedBy: ctx.deps.llmConfig.model,
          generatedAt: now,
        });
        return { docId, title, created: true, projectId };
      },
    },
  ],
  buildOutput: (ctx: RunCtx): ConversationToDocOutput => ctx.results.persist as ConversationToDocOutput,
};
