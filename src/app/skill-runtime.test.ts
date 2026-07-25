import { describe, expect, it } from "vitest";
import {
  executeSkill,
  validateInput,
  type RunEvent,
  type SkillDeps,
  type SkillDef,
} from "./skill-runtime";

function mockDeps(over: Partial<SkillDeps> = {}): SkillDeps {
  return {
    apiBase: "",
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    callLLM: async () => "answer",
    llmConfig: {} as SkillDeps["llmConfig"],
    ...over,
  };
}

async function collect(gen: AsyncGenerator<RunEvent, void, void>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("validateInput (JSON-schema subset)", () => {
  const schema = {
    type: "object" as const,
    properties: { query: { type: "string" as const }, topK: { type: "integer" as const } },
    required: ["query"],
    additionalProperties: false,
  };

  it("accepts a valid object", () => {
    expect(validateInput(schema, { query: "hi", topK: 3 }).ok).toBe(true);
  });
  it("rejects missing required field", () => {
    const r = validateInput(schema, { topK: 3 });
    expect(r.ok).toBe(false);
  });
  it("rejects unexpected field when additionalProperties is false", () => {
    expect(validateInput(schema, { query: "hi", nope: 1 }).ok).toBe(false);
  });
  it("rejects wrong type", () => {
    expect(validateInput(schema, { query: 123 }).ok).toBe(false);
  });
  it("rejects non-integer for integer field", () => {
    expect(validateInput(schema, { query: "hi", topK: 1.5 }).ok).toBe(false);
  });
});

const linearDef: SkillDef = {
  id: "linear-test",
  inputSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false },
  steps: [
    { id: "a", kind: "api", run: async (ctx) => (ctx.input.n as number) + 1 },
    { id: "b", kind: "transform", run: async (ctx) => (ctx.results.a as number) * 10 },
    { id: "c", kind: "llm", run: async (ctx) => `v=${ctx.results.b}` },
  ],
  buildOutput: (ctx) => ({ final: ctx.results.c }),
};

describe("executeSkill", () => {
  it("runs a linear workflow in order and chains context", async () => {
    const evs = await collect(executeSkill(linearDef, { n: 1 }, mockDeps()));
    const done = evs.filter((e) => e.type === "step" && e.step.status === "done");
    expect(done.map((e) => (e as any).step.id)).toEqual(["a", "b", "c"]);
    const result = evs.find((e) => e.type === "result");
    expect(result && (result as any).output).toEqual({ final: "v=20" });
  });

  it("emits progressive running→done events per step", async () => {
    const evs = await collect(executeSkill(linearDef, { n: 1 }, mockDeps()));
    const aRunning = evs.find((e) => e.type === "step" && (e as any).step.id === "a" && (e as any).step.status === "running");
    const aDone = evs.find((e) => e.type === "step" && (e as any).step.id === "a" && (e as any).step.status === "done");
    expect(aRunning).toBeTruthy();
    expect(aDone).toBeTruthy();
  });

  it("aborts before any step when input is invalid", async () => {
    const evs = await collect(executeSkill(linearDef, { n: "bad" as unknown as number }, mockDeps()));
    expect(evs.some((e) => e.type === "step")).toBe(false);
    expect(evs.at(-1)?.type).toBe("error");
  });

  it("yields error for unknown skill (undefined def)", async () => {
    const evs = await collect(executeSkill(undefined, { n: 1 }, mockDeps()));
    expect(evs).toEqual([{ type: "error", error: "unknown skill" }]);
  });

  it("stops at a throwing step and does not run later steps", async () => {
    const def: SkillDef = {
      id: "boom",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      steps: [
        { id: "a", kind: "api", run: async () => { throw new Error("kaboom"); } },
        { id: "b", kind: "transform", run: async () => "should-not-run" },
      ],
      buildOutput: () => ({}),
    };
    const evs = await collect(executeSkill(def, {}, mockDeps()));
    expect(evs.some((e) => e.type === "step" && (e as any).step.id === "b")).toBe(false);
    expect(evs.at(-1)).toEqual({ type: "error", error: "kaboom" });
  });
});
