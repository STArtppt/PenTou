/**
 * plane B 技能注册表 + 公共入口 runSkill（spec skill-runtime）。
 * runner 的可执行定义在此内建注册；SKILL.md（data/skills/）是权威描述。
 */
import { executeSkill, type RunEvent, type SkillDef, type SkillDeps } from "../skill-runtime";
import { chatCompletion, type LLMConfig } from "../llm";
import { getActiveLLMConfig, loadLLMSettingsFromLocalStorage } from "../llm-settings";
import { askAiContext } from "./ask-ai-context";
import { annotationDrivenRewrite } from "./annotation-driven-rewrite";
import { conversationToDoc } from "./conversation-to-doc";
import { docFolderOrganize } from "./doc-folder-organize";
import { topicDigest } from "./topic-digest";
import { createToolExecutor, type ToolEnv } from "./tool-executor";

export const SKILL_REGISTRY: Record<string, SkillDef> = {
  [askAiContext.id]: askAiContext,
  [conversationToDoc.id]: conversationToDoc,
  [topicDigest.id]: topicDigest,
  [docFolderOrganize.id]: docFolderOrganize,
  [annotationDrivenRewrite.id]: annotationDrivenRewrite,
};

export interface RunSkillOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  callLLM?: SkillDeps["callLLM"];
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
  /** 工具执行的环境（当前视图等）；不给则只有不依赖视图的工具可用。 */
  toolEnv?: ToolEnv;
}

/**
 * 运行一个 plane B 技能。返回逐步产出的事件流（step → result | error）。
 * 未知 skillId 由 executeSkill 产出 error 事件（不抛异常）。
 */
export function runSkill(
  skillId: string,
  input: Record<string, unknown>,
  opts: RunSkillOptions = {},
): AsyncGenerator<RunEvent, void, void> {
  const def = SKILL_REGISTRY[skillId];
  const deps: SkillDeps = {
    apiBase: opts.apiBase ?? "",
    fetchImpl: opts.fetchImpl ?? fetch.bind(globalThis),
    callLLM: opts.callLLM ?? chatCompletion,
    llmConfig: opts.llmConfig ?? getActiveLLMConfig(loadLLMSettingsFromLocalStorage()),
    signal: opts.signal,
    executeTool: createToolExecutor(opts.toolEnv ?? {}),
  };
  return executeSkill(def, input, deps);
}

export type { RunEvent };
