/**
 * run-plan.ts — 执行一份被批准的行动计划（spec agent-write-policy / plan-run-status）。
 *
 * 这不是一个技能（没有 LLM 参与）—— 计划已经写死了要做什么，执行阶段**不该再问模型**。
 * 它把 `plan-doc` 的纯逻辑接到 `/api/*` 上：读最新正文取勾选状态、校验快照与文件夹基底、
 * 只增不改删地补文件夹、最后逐条改归属。任何校验失败都发生在写入之前，因此中止即零变更。
 *
 * 执行完把**终态**回写到计划文档的 `aiPlanRun`（design D3：回写在这里而非 `executePlan` 里，
 * 后者保持「纯逻辑 + 注入 api」的形态）。回写 PUT **不带 `body`**，因此走不到建版本分支。
 *
 * UI 约定（预检）：点「执行」先 `preflightPlanDoc`；校验失败只更新状态条、**不建** AI 会话，
 * 下方不出现「执行意图」用户气泡与错误消息——失败原因走状态条「详情」。
 */
import type { SkillDeps } from "../skill-runtime";
import {
  executePlan,
  parsePlan,
  serializePlanRun,
  PlanWriteInterrupted,
  PLAN_FORMAT_VERSION,
  validatePlanBeforeWrite,
  type AgentPlanRun,
  type PlanExecutionResult,
} from "./plan-doc";
import { WritePolicyError } from "./agent-write-policy";
import { apiGet, apiSend, newFolderId, type DocMeta, type FolderRow } from "./skill-api";

const EMPTY_RESULT: PlanExecutionResult = {
  approved: 0,
  skipped: 0,
  cleaned: 0,
  createdFolders: [],
  assigned: [],
};

function planExecutorApi(deps: SkillDeps) {
  return {
    listFolders: () => apiGet<FolderRow[]>(deps, "/api/document-folders"),
    saveFolders: async (folders: FolderRow[]) => {
      await apiSend(deps, "POST", "/api/document-folders", folders);
    },
    readDocMeta: async (docId: string) => {
      try {
        const meta = await apiGet<DocMeta>(deps, `/api/documents/${docId}`);
        return { updatedAt: meta.updatedAt };
      } catch {
        return null; // 文档已不存在 → 计划过期，由 assertSnapshotFresh 报出
      }
    },
    assignFolder: async (docId: string, folderId: string, projectId: string | null) => {
      await apiSend(deps, "PUT", `/api/documents/${docId}`, { folderId, projectId });
    },
    newFolderId,
  };
}

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

export type PlanPreflight =
  | { ok: true; /** 零勾选：可执行但无事可做，不应建会话 */ noop: boolean }
  | { ok: false; error: string };

/**
 * 点「执行」时的预检：校验能否安全执行。
 * - 失败：写 `failed` 终态（无 sessionId），返回 error —— 调用方 **不得** 再建 run 会话
 * - 零勾选：ok + noop，不写终态、不建会话
 * - 通过：ok，调用方再 `startSkillRun` / `runPlanDoc`
 */
export async function preflightPlanDoc(
  deps: SkillDeps,
  planDocId: string,
): Promise<PlanPreflight> {
  try {
    const doc = await apiGet<DocMeta & { body: string; aiPlan?: string }>(
      deps,
      `/api/documents/${planDocId}`,
    );
    const plan = parsePlan(doc.aiPlan);
    if (!plan) {
      const error = "这篇文档不是可执行的行动计划（缺少结构化绑定）。";
      // 无 aiPlan 时状态条本就不渲染；仍尽量不写 failed 以免脏字段。直接返回。
      return { ok: false, error };
    }
    const { result } = await validatePlanBeforeWrite(plan, doc.body, planExecutorApi(deps));
    if (!result.approved) return { ok: true, noop: true };
    return { ok: true, noop: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordRun(deps, planDocId, EMPTY_RESULT, "failed", undefined, message).catch((err) =>
      console.error({ module: "run-plan", op: "recordFailedPreflight", err, context: { planDocId } }),
    );
    return { ok: false, error: message };
  }
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
    result = await executePlan(plan, doc.body, planExecutorApi(deps));
  } catch (e) {
    if (e instanceof PlanWriteInterrupted) {
      // 中断原因一并存下：run 会话可被删，不存就再也查不到为什么断的（design D8）
      // 记 partial 是尽力而为 —— 它失败了也绝不能盖掉真正的执行错误
      await recordRun(deps, planDocId, e.result, "partial", sessionId, e.message).catch((err) =>
        console.error({ module: "run-plan", op: "recordPartialRun", err, context: { planDocId } }),
      );
      throw e.reason; // 原样重抛：错误照旧冒泡到 run 会话
    }
    // 预检已挡住绝大多数校验失败；此处仍兜底记 failed（竞态：预检后快照又变了）
    const message = e instanceof Error ? e.message : String(e);
    await recordRun(deps, planDocId, EMPTY_RESULT, "failed", sessionId, message).catch((err) =>
      console.error({ module: "run-plan", op: "recordFailedRun", err, context: { planDocId } }),
    );
    throw e;
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
