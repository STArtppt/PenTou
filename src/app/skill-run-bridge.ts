/**
 * skill-run-bridge — 把 plane B runner 注入给 data.tsx registry，
 * 避免 data.tsx 静态 import skills（server 经 type-import 拉 data 时会炸路径别名）。
 */
import type { LLMConfig } from "./llm";
import type { RunEvent, SkillDeps } from "./skill-runtime";

export type RunSkillFn = (
  skillId: string,
  input: Record<string, unknown>,
  opts?: {
    llmConfig?: LLMConfig;
    signal?: AbortSignal;
    onEvent?: (event: RunEvent) => void;
  },
) => AsyncGenerator<RunEvent, void, void>;

/** `sessionId` 会随执行终态写进计划文档，供状态条跳回那次 run 会话（spec plan-run-status D5）。 */
export type RunPlanDocFn = (deps: SkillDeps, planDocId: string, sessionId?: string) => Promise<unknown>;

let runSkillImpl: RunSkillFn | null = null;
let runPlanDocImpl: RunPlanDocFn | null = null;

export function bindSkillRunners(runners: { runSkill: RunSkillFn; runPlanDoc: RunPlanDocFn }): void {
  runSkillImpl = runners.runSkill;
  runPlanDocImpl = runners.runPlanDoc;
}

export function getRunSkill(): RunSkillFn {
  if (!runSkillImpl) throw new Error("skill runners not bound — call bindSkillRunners at app boot");
  return runSkillImpl;
}

export function getRunPlanDoc(): RunPlanDocFn {
  if (!runPlanDocImpl) throw new Error("skill runners not bound — call bindSkillRunners at app boot");
  return runPlanDocImpl;
}
