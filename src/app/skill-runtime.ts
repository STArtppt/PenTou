/**
 * skill-runtime.ts — plane B 客户端技能 runner（spec skill-runtime）。
 *
 * 加载一个技能定义（SkillDef），按线性 workflow 顺序执行步骤：
 *   - `api`       调 Pentou `/api/*` 取数据
 *   - `llm`       在客户端调用 LLM（复用 src/app/llm.ts）
 *   - `transform` 纯变换（拼上下文 / 套 prompt）
 * 逐步产出进度事件以便 UI 展示；执行前用输入 schema 校验入参。
 * 不依赖服务端 LLM 通道 —— LLM 由消费者自备（内部 runner=客户端 llm.ts；外部 agent=自带）。
 */
import type { LLMConfig, ChatMessage } from "./llm";

export type StepKind = "api" | "llm" | "transform";

export interface RunStep {
  id: string;
  kind: StepKind;
  status: "running" | "done" | "error";
  output?: unknown;
  error?: string;
}

/** runner 逐步产出的事件：step 进度 → 终态 result 或 error。 */
export type RunEvent =
  | { type: "step"; step: RunStep }
  | { type: "result"; output: unknown }
  | { type: "error"; error: string };

/** JSON Schema（draft-07）子集：够校验本项目技能入参，避免引入 ajv 等重依赖。 */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
}

/** runner 的可注入依赖（测试可 mock；不写死内部函数以保外部分发的契约边界）。 */
export interface SkillDeps {
  /** `/api/*` 前缀，浏览器同源默认 ""；测试注入 mock base。 */
  apiBase: string;
  fetchImpl: typeof fetch;
  callLLM: (
    cfg: LLMConfig,
    messages: ChatMessage[],
    onChunk?: (c: string) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  llmConfig: LLMConfig;
  signal?: AbortSignal;
}

export interface RunCtx {
  input: Record<string, unknown>;
  /** 步骤 id → 产物，供后续步骤读取（串联上下文）。 */
  results: Record<string, unknown>;
  deps: SkillDeps;
}

export interface StepDef {
  id: string;
  kind: StepKind;
  run: (ctx: RunCtx) => Promise<unknown>;
}

export interface SkillDef {
  id: string;
  inputSchema: JsonSchema;
  steps: StepDef[];
  buildOutput: (ctx: RunCtx) => unknown;
}

const JS_TYPEOF: Record<string, string> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
  object: "object",
  array: "object",
};

/** 校验入参是否满足 schema（object/required/属性类型/additionalProperties 子集）。 */
export function validateInput(
  schema: JsonSchema,
  input: unknown,
): { ok: true } | { ok: false; error: string } {
  if (schema.type && schema.type !== "object") {
    // 本项目入参一律 object；其余类型不在子集内
    return { ok: false, error: `unsupported input schema type: ${schema.type}` };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "input must be an object" };
  }
  const obj = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined) return { ok: false, error: `missing required field: ${key}` };
  }
  const props = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) return { ok: false, error: `unexpected field: ${key}` };
    }
  }
  for (const [key, sub] of Object.entries(props)) {
    if (obj[key] === undefined) continue;
    const want = sub.type ? JS_TYPEOF[sub.type] : undefined;
    if (want) {
      const got = Array.isArray(obj[key]) ? "object" : typeof obj[key];
      const isArr = sub.type === "array";
      if (isArr ? !Array.isArray(obj[key]) : got !== want || (sub.type === "object" && Array.isArray(obj[key]))) {
        return { ok: false, error: `field ${key} must be ${sub.type}` };
      }
      if (sub.type === "integer" && !Number.isInteger(obj[key])) {
        return { ok: false, error: `field ${key} must be an integer` };
      }
    }
  }
  return { ok: true };
}

/**
 * 执行一个技能定义。async generator：逐步 yield step 进度，最后 yield result 或 error。
 * 校验失败 / 未知技能 / 步骤抛错 → 立即 yield error 并停止，不再执行后续步骤。
 */
export async function* executeSkill(
  def: SkillDef | undefined,
  input: Record<string, unknown>,
  deps: SkillDeps,
): AsyncGenerator<RunEvent, void, void> {
  if (!def) {
    yield { type: "error", error: "unknown skill" };
    return;
  }
  if (!def.inputSchema) {
    yield { type: "error", error: `skill ${def.id} is missing an input schema` };
    return;
  }
  const valid = validateInput(def.inputSchema, input);
  if (!valid.ok) {
    yield { type: "error", error: valid.error };
    return;
  }

  const ctx: RunCtx = { input, results: {}, deps };
  for (const step of def.steps) {
    yield { type: "step", step: { id: step.id, kind: step.kind, status: "running" } };
    try {
      const out = await step.run(ctx);
      ctx.results[step.id] = out;
      yield { type: "step", step: { id: step.id, kind: step.kind, status: "done", output: out } };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      yield { type: "step", step: { id: step.id, kind: step.kind, status: "error", error } };
      yield { type: "error", error };
      return;
    }
  }
  yield { type: "result", output: def.buildOutput(ctx) };
}
