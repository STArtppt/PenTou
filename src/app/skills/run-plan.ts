/**
 * run-plan.ts — 执行一份被批准的行动计划（spec agent-write-policy / plan-run-status）。
 *
 * 这不是一个技能（没有 LLM 参与）—— 计划已经写死了要做什么，执行阶段**不该再问模型**。
 * 它把 `plan-doc` 的纯逻辑接到 `/api/*` 上：读最新正文取勾选状态、校验快照与文件夹基底、
 * 只增不改删地补文件夹、最后逐条改归属。任何校验失败都发生在写入之前，因此中止即零变更。
 *
 * 执行完把**终态**回写到计划文档的 `aiPlanRun`（design D3：回写在这里而非 `executePlan` 里，
 * 后者保持「纯逻辑 + 注入 api」的形态）。回写 PUT **不带 `body`**，因此走不到建版本分支。
 */
import type { SkillDeps } from "../skill-runtime";
import {
  executePlan,
  parsePlan,
  serializePlanRun,
  PlanWriteInterrupted,
  PLAN_FORMAT_VERSION,
  type AgentPlanRun,
  type PlanExecutionResult,
} from "./plan-doc";
import { WritePolicyError } from "./agent-write-policy";
import { apiGet, apiSend, newFolderId, type DocMeta, type FolderRow } from "./skill-api";

/** 把终态写回计划文档自身。载荷只有 `aiPlanRun` —— 不带 `body` 就不建版本、正文一个字不动。 */
async function recordRun(
  deps: SkillDeps,
  planDocId: string,
  result: PlanExecutionResult,
  status: AgentPlanRun["status"],
  sessionId?: string,
  error?: string,
): Promise<void> {
  const run: AgentPlanRun = {
    version: PLAN_FORMAT_VERSION,
    status,
    ranAt: new Date().toISOString(),
    approved: result.approved,
    skipped: result.skipped,
    cleaned: result.cleaned,
    createdFolders: result.createdFolders,
    assigned: result.assigned,
    ...(sessionId ? { sessionId } : {}),
    ...(error ? { error } : {}),
  };
  await apiSend(deps, "PUT", `/api/documents/${planDocId}`, { aiPlanRun: serializePlanRun(run) });
}

export async function runPlanDoc(
  deps: SkillDeps,
  planDocId: string,
  sessionId?: string,
): Promise<PlanExecutionResult> {
  // 读最新正文：用户很可能刚刚勾完复选框，客户端缓存里的还是旧的
  const doc = await apiGet<DocMeta & { body: string; aiPlan?: string }>(deps, `/api/documents/${planDocId}`);
  const plan = parsePlan(doc.aiPlan);
  if (!plan) throw new WritePolicyError("这篇文档不是可执行的行动计划（缺少结构化绑定）。");

  let result: PlanExecutionResult;
  try {
    result = await executePlan(plan, doc.body, {
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
  } catch (e) {
    if (!(e instanceof PlanWriteInterrupted)) throw e; // 校验阶段失败：零改动，不留终态
    // 中断原因一并存下：run 会话可被删，不存就再也查不到为什么断的（design D8）
    // 记 partial 是尽力而为 —— 它失败了也绝不能盖掉真正的执行错误
    await recordRun(deps, planDocId, e.result, "partial", sessionId, e.message).catch((err) =>
      console.error({ module: "run-plan", op: "recordPartialRun", err, context: { planDocId } }),
    );
    throw e.reason; // 原样重抛：错误照旧冒泡到 run 会话
  }

  // 一条都没勾 = 零改动，仍是「未执行」（spec plan-run-status）
  if (!result.approved) return result;

  try {
    await recordRun(deps, planDocId, result, "done", sessionId);
  } catch (e) {
    // 改动已经生效了。这里必须说清「跑完了但状态没记上」，绝不能让它读起来像执行失败。
    throw new WritePolicyError(
      `计划已执行完毕，但执行状态没能写回计划文档（${e instanceof Error ? e.message : String(e)}）。` +
        `改动已经生效，请勿重复执行。`,
    );
  }
  return result;
}
