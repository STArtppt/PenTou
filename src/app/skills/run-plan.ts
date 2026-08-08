/**
 * run-plan.ts — 执行一份被批准的行动计划（spec agent-write-policy）。
 *
 * 这不是一个技能（没有 LLM 参与）—— 计划已经写死了要做什么，执行阶段**不该再问模型**。
 * 它把 `plan-doc` 的纯逻辑接到 `/api/*` 上：读最新正文取勾选状态、校验快照与文件夹基底、
 * 只增不改删地补文件夹、最后逐条改归属。任何校验失败都发生在写入之前，因此中止即零变更。
 */
import type { SkillDeps } from "../skill-runtime";
import { executePlan, parsePlan, type PlanExecutionResult } from "./plan-doc";
import { WritePolicyError } from "./agent-write-policy";
import { apiGet, apiSend, newFolderId, type DocMeta, type FolderRow } from "./skill-api";

export async function runPlanDoc(deps: SkillDeps, planDocId: string): Promise<PlanExecutionResult> {
  // 读最新正文：用户很可能刚刚勾完复选框，客户端缓存里的还是旧的
  const doc = await apiGet<DocMeta & { body: string; aiPlan?: string }>(deps, `/api/documents/${planDocId}`);
  const plan = parsePlan(doc.aiPlan);
  if (!plan) throw new WritePolicyError("这篇文档不是可执行的行动计划（缺少结构化绑定）。");

  return executePlan(plan, doc.body, {
    listFolders: () => apiGet<FolderRow[]>(deps, "/api/document-folders"),
    saveFolders: async (folders) => {
      await apiSend(deps, "POST", "/api/document-folders", folders);
    },
    readDocMeta: async (docId) => {
      try {
        const meta = await apiGet<DocMeta>(deps, `/api/documents/${docId}`);
        return { updatedAt: meta.updatedAt };
      } catch {
        return null; // 文档已不存在 → 计划过期，由 assertSnapshotFresh 报出
      }
    },
    assignFolder: async (docId, folderId, projectId) => {
      await apiSend(deps, "PUT", `/api/documents/${docId}`, { folderId, projectId });
    },
    newFolderId,
  });
}
