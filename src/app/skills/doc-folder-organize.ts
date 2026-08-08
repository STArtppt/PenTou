/**
 * doc-folder-organize — plane B 产品技能（整理文档目录）。
 * 权威描述见 data/skills/doc-folder-organize/SKILL.md。
 *
 * 工作流：列目录 → LLM 判定项目类型并提议归类与清理 → 客户端强制数量约束 → 产出**行动计划文档**。
 * 这是本期唯一「批量且改动既有数据」的操作，因此必须先出计划、由用户勾选批准后才执行
 * （spec agent-write-policy）；本技能到产出计划为止，**一篇文档都不改**。
 *
 * 三道客户端护栏，一道都不指望模型自觉：
 *   1. 模型编造的 `docId` —— 不在候选集里的一律丢弃；
 *   2. 「新增 ≤3、总数 ≤10」—— `enforceFolderBudget` 强制裁剪，裁掉什么写进 notes；
 *   3. 记忆与 AI 空间里的东西不进候选集；孤儿 / 重名文件夹只如实报告，绝不顺手清理。
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
  DEV_FOLDERS,
  DEV_FOLDERS_EN,
  KNOWLEDGE_FOLDERS,
  KNOWLEDGE_FOLDERS_EN,
  MAX_NEW_FOLDERS,
  MAX_TOTAL_FOLDERS,
  enforceFolderBudget,
  isProjectType,
  typicalFoldersFor,
  type ProjectType,
} from "./project-taxonomy";
import { normalizeSkillLang, skillStrings } from "./skill-i18n";
import {
  DEFAULT_PROJECT_KEY,
  aiWorkspaceFolderId,
  isAiWorkspaceFolderId,
  isOrganizeCandidate,
  projectKey,
} from "@/shared/ai-workspace";

function proposeSystem(lang: "zh" | "en"): string {
  const dev = (lang === "en" ? DEV_FOLDERS_EN : DEV_FOLDERS).join(" / ");
  const knowledge = (lang === "en" ? KNOWLEDGE_FOLDERS_EN : KNOWLEDGE_FOLDERS).join(" / ");
  return `你在为一个项目的文档提议目录划分。分两步：

## 第一步：判定项目类型

看文档标题的整体面貌，判断这是哪一类项目：

- \`dev\`（开发项目）：文档主要记录一个软件的开发过程 —— 设计、开发进度、部署、接口、问题排查
- \`knowledge\`（知识工作项目）：文档主要是知识工作的产出物与素材 —— 资料、成稿、归档

## 第二步：按对应的典型结构提议归类

- \`dev\` 的典型结构：${dev}
- \`knowledge\` 的典型结构：${knowledge}

规则：
1. **优先用对应类型的典型目录**，其次复用该项目已有文件夹，最后才提议新目录
2. 新目录（既不在典型结构、也不在已有文件夹里的）最多 ${MAX_NEW_FOLDERS} 个；执行后目录总数不超过 ${MAX_TOTAL_FOLDERS} 个
3. 名要具体（「检索与排序」而不是「技术」），控制在 6 个字以内
4. 一篇文档只归一个目录；实在判断不了就不要提议它
5. 确实已无保留价值的文档（一次性的临时记录、重复的草稿、明显作废的内容）放进 \`cleanup\`，每条给一句理由。**这不是删除** —— 批准后只会被归入一个待清理目录
6. 不要提议改名或合并任何既有文件夹
7. 只输出 JSON，形如：
{"projectType":"dev","typeReason":"一句话依据","items":[{"docId":"doc_x","folderName":"设计文档","reason":"一句话理由"}],"cleanup":[{"docId":"doc_y","reason":"一句话理由"}]}`;
}

export interface DocFolderOrganizeOutput {
  planDocId: string;
  folderId: string;
  itemCount: number;
  cleanupCount: number;
  projectType: ProjectType;
  candidateCount: number;
  notes: string[];
}

interface Inventory {
  projectId: string | null;
  candidates: DocMeta[];
  folders: FolderRow[];
  notes: string[];
}

interface Proposal {
  projectType: ProjectType;
  typeReason: string;
  items: { docId: string; folderName: string; reason?: string }[];
  cleanup: { docId: string; reason?: string }[];
  notes: string[];
}

export const docFolderOrganize: SkillDef = {
  id: "doc-folder-organize",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      planTitle: { type: "string" },
      lang: { type: "string" },
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
        const lang = normalizeSkillLang((ctx.input as { lang?: string }).lang);
        const { candidates, folders } = ctx.results.inventory as Inventory;
        const folderList = folders.length
          ? folders.map((f) => `- ${f.name}`).join("\n")
          : "（还没有任何文件夹）";
        const docList = candidates
          .map((doc) => `- ${doc.id} · ${doc.title}${doc.folderId ? "（已归类）" : "（未分类）"}`)
          .join("\n");
        return [
          { role: "system", content: proposeSystem(lang) },
          { role: "user", content: `# 已有文件夹\n${folderList}\n\n# 待归类文档\n${docList}` },
        ];
      },
    },
    {
      id: "propose",
      kind: "llm",
      run: async (ctx: RunCtx): Promise<Proposal> => {
        const lang = normalizeSkillLang((ctx.input as { lang?: string }).lang);
        const messages = ctx.results.prompt as ChatMessage[];
        const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, messages, { signal: ctx.deps.signal });
        const parsed = extractJson<{
          projectType?: unknown;
          typeReason?: unknown;
          items?: unknown[];
          cleanup?: unknown[];
        }>(content);

        const items = Array.isArray(parsed?.items) ? parsed!.items : [];
        const cleanup = Array.isArray(parsed?.cleanup) ? parsed!.cleanup : [];
        if (!items.length && !cleanup.length) throw new Error("模型没有给出可用的归类提议");

        // 类型判错的兜底是**可见的**：回退到知识工作并记 note，而不是静默选一个
        const notes: string[] = [];
        let projectType: ProjectType = "knowledge";
        if (isProjectType(parsed?.projectType)) {
          projectType = parsed!.projectType as ProjectType;
        } else if (parsed?.projectType !== undefined) {
          notes.push(skillStrings(lang).plan.typeFallbackNote(String(parsed.projectType)));
        }

        return {
          projectType,
          typeReason: typeof parsed?.typeReason === "string" ? parsed.typeReason : "",
          items: items as Proposal["items"],
          cleanup: cleanup as Proposal["cleanup"],
          notes,
        };
      },
    },
    {
      id: "plan",
      kind: "api",
      run: async (ctx: RunCtx): Promise<{ docId: string; folderId: string; plan: AgentPlan }> => {
        const lang = normalizeSkillLang((ctx.input as { lang?: string }).lang);
        const inventory = ctx.results.inventory as Inventory;
        const proposal = ctx.results.propose as Proposal;
        const byId = new Map(inventory.candidates.map((doc) => [doc.id, doc]));
        const notes = [...inventory.notes, ...proposal.notes];

        // 一次过滤：模型可能编出不存在的 docId、把记忆列进来、或给空目录名
        const normalized = proposal.items
          .map((p) => ({
            doc: byId.get(String(p?.docId ?? "")),
            folderName: String(p?.folderName ?? "").trim(),
            reason: p?.reason ? String(p.reason) : undefined,
          }))
          .filter((p): p is { doc: DocMeta; folderName: string; reason?: string } => {
            if (!p.doc || !p.folderName) return false;
            // 已经在同名目录里的不必再动
            return !(
              p.doc.folderId &&
              inventory.folders.find((f) => f.id === p.doc!.folderId)?.name === p.folderName
            );
          });

        // 数量约束在客户端强制（design D6），裁剪结果如实写进 notes
        const budget = enforceFolderBudget(
          normalized,
          inventory.folders.map((f) => f.name),
          typicalFoldersFor(proposal.projectType, lang),
          lang,
        );
        if (budget.note) notes.push(budget.note);

        const items: PlanItem[] = [];
        const snapshot: AgentPlan["snapshot"] = [];
        const seen = new Set<string>();
        for (const p of budget.kept) {
          items.push({
            kind: "assign-folder",
            docId: p.doc.id,
            docTitle: p.doc.title,
            folderName: p.folderName,
            folderId: inventory.folders.find((f) => f.name === p.folderName)?.id ?? null,
            reason: p.reason,
          });
          snapshot.push({ docId: p.doc.id, updatedAt: p.doc.updatedAt });
          seen.add(p.doc.id);
        }

        for (const c of proposal.cleanup) {
          const doc = byId.get(String(c?.docId ?? ""));
          // 同一篇既提议归类又提议清理时以归类为准 —— 两条会在正文里读成互相矛盾的指令
          if (!doc || seen.has(doc.id)) continue;
          items.push({
            kind: "suggest-cleanup",
            docId: doc.id,
            docTitle: doc.title,
            reason: c?.reason ? String(c.reason) : undefined,
          });
          snapshot.push({ docId: doc.id, updatedAt: doc.updatedAt });
          seen.add(doc.id);
        }

        if (!items.length) throw new Error("没有需要调整的归类 —— 现有目录已经合适");

        const plan: AgentPlan = {
          version: PLAN_FORMAT_VERSION,
          projectId: projectKey(inventory.projectId),
          createdAt: new Date().toISOString(),
          items,
          snapshot,
          folderBaseline: inventory.folders.map((f) => ({ id: f.id, name: f.name })),
          notes,
          projectType: proposal.projectType,
          typeReason: proposal.typeReason || undefined,
          lang,
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
      itemCount: plan.items.filter((i) => i.kind === "assign-folder").length,
      cleanupCount: plan.items.filter((i) => i.kind === "suggest-cleanup").length,
      projectType: plan.projectType ?? "knowledge",
      candidateCount: inventory.candidates.length,
      notes: plan.notes,
    };
  },
};
