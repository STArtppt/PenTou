/**
 * tool-executor.ts — `/api/tools` 目录的**客户端**执行器（spec skill-runtime）。
 *
 * 模型请求的每次工具调用都在这里落到既有 `/api/*`；不经任何服务端 LLM 通道。
 * 工具目录（名称 / 描述 / 入参 schema）是 src/shared/agent-tools.ts，本文件只负责「怎么执行」。
 *
 * `read_current_view` 依赖的是应用内的「当前在看什么」，不是某个端点能回答的问题，
 * 因此由调用方（AI 侧栏 / chip 派发）注入 `ViewResolver`，其余工具一律走 HTTP。
 */
import type { ExecutableToolCall, SkillDeps } from "../skill-runtime";
import { findAgentTool } from "@/shared/agent-tools";
import {
  DEFAULT_PROJECT_KEY,
  aiWorkspaceFolderId,
  isAiWorkspaceFolderId,
  isOrganizeCandidate,
  memoryDocId,
  projectKey,
} from "@/shared/ai-workspace";
import { assertBodyRewrite, assertCanAssignFolder, auditFolderAnomalies } from "./agent-write-policy";
import {
  PLAN_FORMAT_VERSION,
  renderPlanBody,
  serializePlan,
  type AgentPlan,
  type PlanItem,
} from "./plan-doc";
import { apiGet, apiSend, newDocId, newFolderId, type DocMeta, type FolderRow } from "./skill-api";

/** 当前视图正文的提供者：返回 null 表示当前没有可读的视图。 */
export interface ViewResolver {
  read: (section?: string) => Promise<{ kind: "doc" | "chat"; title: string; text: string } | null>;
}

export interface ToolEnv {
  view?: ViewResolver;
  /** 计划文档的标题；由派发方按「整理哪个项目」给出，比让模型自己起名稳定。 */
  planTitle?: string;
}

type Handler = (
  args: Record<string, unknown>,
  deps: SkillDeps,
  env: ToolEnv,
) => Promise<unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const HANDLERS: Record<string, Handler> = {
  read_current_view: async (args, _deps, env) => {
    if (!env.view) throw new Error("当前没有打开的文档或会话");
    const view = await env.view.read(str(args.section));
    if (!view) throw new Error("当前没有打开的文档或会话");
    return view;
  },

  search_corpus: async (args, deps) => {
    const query = str(args.query);
    if (!query) throw new Error("query is required");
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 20) : 6;
    const data = await apiGet<{ hits?: unknown[] }>(
      deps,
      `/api/search?q=${encodeURIComponent(query)}&mode=hybrid&limit=${limit}`,
    );
    return { hits: data.hits ?? [] };
  },

  list_documents: async (args, deps) => {
    const docs = await apiGet<DocMeta[]>(deps, "/api/documents?fields=meta");
    const projectId = str(args.projectId);
    const unfiledOnly = args.unfiledOnly === true;
    const filtered = docs.filter((doc) => {
      if (projectId && (doc.projectId ?? DEFAULT_PROJECT_KEY) !== projectId) return false;
      if (unfiledOnly && doc.folderId) return false;
      return true;
    });
    return {
      documents: filtered.map((doc) => ({
        id: doc.id,
        title: doc.title,
        folderId: doc.folderId ?? null,
        projectId: doc.projectId ?? DEFAULT_PROJECT_KEY,
        updatedAt: doc.updatedAt,
        aiGenerated: !!(doc.generatedBy || doc.sourceConversationId || doc.sourceAiChatId),
        // 记忆与 AI 空间内的文档不参与归类整理（spec ai-workspace）
        organizeCandidate: isOrganizeCandidate(doc),
      })),
    };
  },

  read_document: async (args, deps) => {
    const docId = str(args.docId);
    if (!docId) throw new Error("docId is required");
    const doc = await apiGet<{ id: string; title: string; body: string }>(deps, `/api/documents/${docId}`);
    return { id: doc.id, title: doc.title, body: doc.body };
  },

  list_folders: async (_args, deps) => {
    const [projects, folders] = await Promise.all([
      apiGet<{ id: string; name: string }[]>(deps, "/api/document-projects"),
      apiGet<{ id: string; name: string; projectId?: string }[]>(deps, "/api/document-folders"),
    ]);
    return { projects, folders };
  },

  // ── 写工具：一律先过 agent-write-policy，再落到既有 /api/* ──────────────────

  create_folder: async (args, deps) => {
    const name = str(args.name);
    if (!name) throw new Error("name is required");
    const projectId = normalizeProjectId(args.projectId);
    // 只增不改删（design D10）：写前重读为基底，只在其上追加。
    const folders = await apiGet<FolderRow[]>(deps, "/api/document-folders");
    const existing = folders.find(
      (f) => f.name === name && (f.projectId ?? DEFAULT_PROJECT_KEY) === projectKey(projectId),
    );
    if (existing) return { folder: existing, created: false };
    const folder: FolderRow = { id: newFolderId(), name, projectId };
    await apiSend(deps, "POST", "/api/document-folders", [...folders, folder]);
    return { folder, created: true };
  },

  assign_folder: async (args, deps) => {
    const docId = str(args.docId);
    if (!docId) throw new Error("docId is required");
    const doc = await apiGet<DocMeta & { title: string }>(deps, `/api/documents/${docId}`);
    assertCanAssignFolder(doc);

    const folderId = str(args.folderId) ?? null;
    const folders = await apiGet<FolderRow[]>(deps, "/api/document-folders");
    const folder = folderId ? folders.find((f) => f.id === folderId) : null;
    if (folderId && !folder) throw new Error(`unknown folder: ${folderId}`);
    // 归属不变量：folderId 非空时项目必须取该文件夹的项目（design 决策 8）
    const projectId = folder ? folder.projectId ?? null : doc.projectId ?? null;

    await apiSend(deps, "PUT", `/api/documents/${docId}`, { folderId, projectId });
    return { docId, folderId, projectId };
  },

  write_workspace_doc: async (args, deps) => {
    const title = str(args.title);
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) throw new Error("title is required");
    const projectId = normalizeProjectId(args.projectId);
    return createWorkspaceDoc(deps, { title, body, projectId });
  },

  propose_folder_plan: async (args, deps, env) => {
    const projectId = normalizeProjectId(args.projectId);
    const rawItems = Array.isArray(args.items) ? args.items : [];
    if (!rawItems.length) throw new Error("items is required");

    const [docs, folders, projects] = await Promise.all([
      apiGet<DocMeta[]>(deps, "/api/documents?fields=meta"),
      apiGet<FolderRow[]>(deps, "/api/document-folders"),
      apiGet<{ id: string }[]>(deps, "/api/document-projects"),
    ]);
    const byId = new Map(docs.map((doc) => [doc.id, doc]));
    const scopedFolders = folders.filter(
      (f) => (f.projectId ?? DEFAULT_PROJECT_KEY) === projectKey(projectId) && !isAiWorkspaceFolderId(f.id),
    );

    const items: PlanItem[] = [];
    const snapshot: AgentPlan["snapshot"] = [];
    for (const raw of rawItems as Record<string, unknown>[]) {
      const docId = str(raw.docId);
      const folderName = str(raw.folderName);
      const doc = docId ? byId.get(docId) : undefined;
      if (!docId || !folderName || !doc) continue;
      if (!isOrganizeCandidate(doc)) continue; // 记忆与 AI 空间内的东西不参与归类
      items.push({
        kind: "assign-folder",
        docId,
        docTitle: doc.title,
        folderName,
        folderId: scopedFolders.find((f) => f.name === folderName)?.id ?? null,
        reason: str(raw.reason),
      });
      snapshot.push({ docId, updatedAt: doc.updatedAt });
    }
    if (!items.length) throw new Error("没有可归类的候选文档（记忆与 AI 空间内的文档不参与整理）");

    // 孤儿 / 重名文件夹只如实报告，绝不自动清理或合并（spec agent-write-policy）
    const notes = [
      ...(Array.isArray(args.notes) ? (args.notes as unknown[]).map(String) : []),
      ...auditFolderAnomalies({ folders, projectIds: projects.map((p) => p.id) }),
    ];

    const plan: AgentPlan = {
      version: PLAN_FORMAT_VERSION,
      projectId: projectKey(projectId),
      createdAt: new Date().toISOString(),
      items,
      snapshot,
      folderBaseline: scopedFolders.map((f) => ({ id: f.id, name: f.name })),
      notes,
    };

    const created = await createWorkspaceDoc(deps, {
      title: env.planTitle ?? `整理计划 · ${new Date().toLocaleDateString("zh-CN")}`,
      body: renderPlanBody(plan),
      projectId,
      aiPlan: serializePlan(plan),
    });
    return { ...created, itemCount: items.length, notes };
  },

  read_memory: async (args, deps) => {
    const docId = memoryDocId(normalizeProjectId(args.projectId));
    const doc = await apiGet<{ id: string; title: string; body: string }>(deps, `/api/documents/${docId}`);
    return { id: doc.id, body: doc.body };
  },

  write_memory: async (args, deps) => {
    const body = typeof args.body === "string" ? args.body : "";
    if (!body.trim()) throw new Error("body is required");
    const docId = memoryDocId(normalizeProjectId(args.projectId));
    const doc = await apiGet<DocMeta & { title: string }>(deps, `/api/documents/${docId}`);
    // 记忆在 AI 空间内 → 可改；且强制走 commitVersion，保证用户随时能回滚
    const endpoint = `/api/documents/${docId}/commit-version`;
    assertBodyRewrite(doc, endpoint);
    const saved = await apiSend<{ version: { id: string } }>(deps, "POST", endpoint, {
      body,
      type: "llm-rewrite",
    });
    return { id: docId, versionId: saved.version?.id };
  },
};

/** AI 的自主产物统一落所属项目的 AI 空间（spec ai-workspace 产物落位规则）。 */
async function createWorkspaceDoc(
  deps: SkillDeps,
  params: { title: string; body: string; projectId: string | null; aiPlan?: string },
): Promise<{ docId: string; folderId: string }> {
  const now = new Date().toISOString();
  const docId = newDocId();
  const folderId = aiWorkspaceFolderId(params.projectId);
  await apiSend(deps, "POST", "/api/documents", {
    id: docId,
    title: params.title,
    folderId,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    createdAt: now,
    updatedAt: now,
    body: params.body,
    generatedBy: deps.llmConfig?.model || "ai",
    generatedAt: now,
    ...(params.aiPlan ? { aiPlan: params.aiPlan } : {}),
  });
  return { docId, folderId };
}

function normalizeProjectId(value: unknown): string | null {
  const raw = str(value);
  return !raw || raw === DEFAULT_PROJECT_KEY ? null : raw;
}



/**
 * 组装一个 `SkillDeps.executeTool`。未知工具与未实现的工具都明确报错，
 * 让模型收到「做不到」而不是一个看起来成功的空结果。
 */
export function createToolExecutor(env: ToolEnv = {}) {
  return async (call: ExecutableToolCall, deps: SkillDeps): Promise<unknown> => {
    if (!findAgentTool(call.name)) throw new Error(`unknown tool: ${call.name}`);
    const handler = HANDLERS[call.name];
    if (!handler) throw new Error(`tool not available in this build: ${call.name}`);
    return handler(call.arguments, deps, env);
  };
}

/** 供 chip 派发按需裁剪工具集：只声明本次任务用得上的工具，模型表现更稳。 */
export function isToolExecutable(name: string): boolean {
  return name in HANDLERS;
}
