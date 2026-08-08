/**
 * doc-folder-organize — plane B 产品技能（整理文档目录）。
 * 权威描述见 data/skills/doc-folder-organize/SKILL.md。
 *
 * 工作流：列目录 → LLM 提议归类 → 产出**行动计划文档**。
 * 这是本期唯一「批量且改动既有数据」的操作，因此必须先出计划、由用户勾选批准后才执行
 * （spec agent-write-policy）；本技能到产出计划为止，**一篇文档都不改**。
 *
 * 记忆与 AI 空间里的东西不进候选集；孤儿 / 重名文件夹只如实报告，绝不顺手清理 ——
 * 首次跑整理时那是最可能出事的地方。
 */
import type { SkillDef, RunCtx } from "../skill-runtime";
import type { ChatMessage } from "../llm";
import { apiGet, apiSend, extractJson, newDocId, type DocMeta, type FolderRow } from "./skill-api";
import { auditFolderAnomalies } from "./agent-write-policy";
import {
  PLAN_FORMAT_VERSION,
  renderPlanBody,
  serializePlan,
  type AgentPlan,
  type PlanItem,
} from "./plan-doc";
import {
  DEFAULT_PROJECT_KEY,
  aiWorkspaceFolderId,
  isAiWorkspaceFolderId,
  isOrganizeCandidate,
  projectKey,
} from "@/shared/ai-workspace";

const PROPOSE_SYSTEM = `你在为一批文档提议归类。规则：
1. 优先复用已有文件夹，只有确实放不进任何一个时才提议新建
2. 新建的文件夹名要具体（「检索与排序」而不是「技术」），控制在 6 个字以内
3. 一篇文档只归一个文件夹；实在判断不了就不要提议它
4. 不要提议删除、合并或改名任何东西
5. 只输出 JSON，形如 {"items":[{"docId":"doc_x","folderName":"开发指南","reason":"一句话理由"}]}`;

export interface DocFolderOrganizeOutput {
  planDocId: string;
  folderId: string;
  itemCount: number;
  candidateCount: number;
  notes: string[];
}

interface Inventory {
  projectId: string | null;
  candidates: DocMeta[];
  folders: FolderRow[];
  notes: string[];
}

export const docFolderOrganize: SkillDef = {
  id: "doc-folder-organize",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      planTitle: { type: "string" },
    },
    additionalProperties: false,
  },
  steps: [
    {
      id: "inventory",
      kind: "api",
      run: async (ctx: RunCtx): Promise<Inventory> => {
        const requested = (ctx.input as { projectId?: string }).projectId;
        const projectId = !requested || requested === DEFAULT_PROJECT_KEY ? null : requested;

        const [docs, folders, projects] = await Promise.all([
          apiGet<DocMeta[]>(ctx.deps, "/api/documents?fields=meta"),
          apiGet<FolderRow[]>(ctx.deps, "/api/document-folders"),
          apiGet<{ id: string }[]>(ctx.deps, "/api/document-projects"),
        ]);

        const candidates = docs.filter(
          (doc) => (doc.projectId ?? DEFAULT_PROJECT_KEY) === projectKey(projectId) && isOrganizeCandidate(doc),
        );
        if (!candidates.length) throw new Error("这个项目里没有可整理的文档");

        return {
          projectId,
          candidates,
          folders: folders.filter(
            (f) => (f.projectId ?? DEFAULT_PROJECT_KEY) === projectKey(projectId) && !isAiWorkspaceFolderId(f.id),
          ),
          // 不一致的既有数据只报告不处置（spec agent-write-policy）
          notes: auditFolderAnomalies({ folders, projectIds: projects.map((p) => p.id) }),
        };
      },
    },
    {
      id: "prompt",
      kind: "transform",
      run: async (ctx: RunCtx): Promise<ChatMessage[]> => {
        const { candidates, folders } = ctx.results.inventory as Inventory;
        const folderList = folders.length
          ? folders.map((f) => `- ${f.name}`).join("\n")
          : "（还没有任何文件夹）";
        const docList = candidates
          .map((doc) => `- ${doc.id} · ${doc.title}${doc.folderId ? "（已归类）" : "（未分类）"}`)
          .join("\n");
        return [
          { role: "system", content: PROPOSE_SYSTEM },
          { role: "user", content: `# 已有文件夹\n${folderList}\n\n# 待归类文档\n${docList}` },
        ];
      },
    },
    {
      id: "propose",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<{ docId: string; folderName: string; reason?: string }[]> => {
        const messages = ctx.results.prompt as ChatMessage[];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        const parsed = extractJson<{ items?: unknown[] }>(content);
        if (!parsed?.items?.length) throw new Error("模型没有给出可用的归类提议");
        return parsed.items as { docId: string; folderName: string; reason?: string }[];
      },
    },
    {
      id: "plan",
      kind: "api",
      run: async (ctx: RunCtx): Promise<{ docId: string; folderId: string; plan: AgentPlan }> => {
        const inventory = ctx.results.inventory as Inventory;
        const proposals = ctx.results.propose as { docId: string; folderName: string; reason?: string }[];
        const byId = new Map(inventory.candidates.map((doc) => [doc.id, doc]));

        const items: PlanItem[] = [];
        const snapshot: AgentPlan["snapshot"] = [];
        for (const proposal of proposals) {
          const doc = byId.get(String(proposal?.docId ?? ""));
          const folderName = String(proposal?.folderName ?? "").trim();
          // 模型可能编出不存在的 docId 或把记忆列进来 —— 这里是最后一道过滤
          if (!doc || !folderName) continue;
          if (doc.folderId && inventory.folders.find((f) => f.id === doc.folderId)?.name === folderName) continue;
          items.push({
            kind: "assign-folder",
            docId: doc.id,
            docTitle: doc.title,
            folderName,
            folderId: inventory.folders.find((f) => f.name === folderName)?.id ?? null,
            reason: proposal.reason ? String(proposal.reason) : undefined,
          });
          snapshot.push({ docId: doc.id, updatedAt: doc.updatedAt });
        }
        if (!items.length) throw new Error("没有需要调整的归类 —— 现有目录已经合适");

        const plan: AgentPlan = {
          version: PLAN_FORMAT_VERSION,
          projectId: projectKey(inventory.projectId),
          createdAt: new Date().toISOString(),
          items,
          snapshot,
          folderBaseline: inventory.folders.map((f) => ({ id: f.id, name: f.name })),
          notes: inventory.notes,
        };

        const docId = newDocId();
        const folderId = aiWorkspaceFolderId(inventory.projectId);
        const now = new Date().toISOString();
        await apiSend(ctx.deps, "POST", "/api/documents", {
          id: docId,
          title: (ctx.input as { planTitle?: string }).planTitle || `整理计划 · ${now.slice(0, 10)}`,
          folderId,
          ...(inventory.projectId ? { projectId: inventory.projectId } : {}),
          createdAt: now,
          updatedAt: now,
          body: renderPlanBody(plan),
          aiPlan: serializePlan(plan),
          generatedBy: ctx.deps.llmConfig.model,
          generatedAt: now,
        });
        return { docId, folderId, plan };
      },
    },
  ],
  buildOutput: (ctx: RunCtx): DocFolderOrganizeOutput => {
    const inventory = ctx.results.inventory as Inventory;
    const { docId, folderId, plan } = ctx.results.plan as { docId: string; folderId: string; plan: AgentPlan };
    return {
      planDocId: docId,
      folderId,
      itemCount: plan.items.length,
      candidateCount: inventory.candidates.length,
      notes: plan.notes,
    };
  },
};
