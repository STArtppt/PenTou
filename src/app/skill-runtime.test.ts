import { describe, expect, it } from "vitest";
import {
  executeSkill,
  runWithTools,
  validateInput,
  type ExecutableToolCall,
  type RunEvent,
  type SkillDeps,
  type SkillDef,
} from "./skill-runtime";
import type { ChatMessage } from "./llm";

function mockDeps(over: Partial<SkillDeps> = {}): SkillDeps {
  return {
    apiBase: "",
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    callLLM: async () => ({ content: "answer", toolCalls: [] }),
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

describe("runWithTools（工具往返）", () => {
  const tools = [{ type: "function" as const, function: { name: "search_corpus" } }];

  it("模型请求工具 → 客户端执行 → 结果回灌后继续作答", async () => {
    const seen: ChatMessage[][] = [];
    const executed: ExecutableToolCall[] = [];
    let round = 0;
    const deps = mockDeps({
      callLLM: async (_cfg, messages) => {
        seen.push(messages);
        round += 1;
        return round === 1
          ? { content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: '{"query":"本地优先"}' }] }
          : { content: "根据检索结果……", toolCalls: [] };
      },
      executeTool: async (call) => {
        executed.push(call);
        return { hits: [{ title: "选型" }] };
      },
    });

    const out = await runWithTools(deps, [{ role: "user", content: "我聊过什么" }], { tools });

    expect(out.content).toBe("根据检索结果……");
    expect(executed).toEqual([{ id: "c1", name: "search_corpus", arguments: { query: "本地优先" } }]);
    // 第二轮的消息里带上了 assistant 的 tool_calls 与 role="tool" 的回执
    const second = seen[1];
    expect(second.at(-2)?.role).toBe("assistant");
    expect(second.at(-2)?.tool_calls?.[0].function.name).toBe("search_corpus");
    expect(second.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({ hits: [{ title: "选型" }] }),
    });
    expect(out.calls[0].result).toEqual({ hits: [{ title: "选型" }] });
  });

  it("工具报错回灌给模型而不是中止整轮", async () => {
    let round = 0;
    const deps = mockDeps({
      callLLM: async (_cfg, messages) => {
        round += 1;
        if (round === 1) return { content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: "{}" }] };
        return { content: `saw:${messages.at(-1)?.content}`, toolCalls: [] };
      },
      executeTool: async () => { throw new Error("search failed: 500"); },
    });

    const out = await runWithTools(deps, [{ role: "user", content: "q" }], { tools });

    expect(out.content).toBe(`saw:${JSON.stringify({ error: "search failed: 500" })}`);
    expect(out.calls[0].error).toBe("search failed: 500");
  });

  it("坏 JSON 参数退化为空对象，不炸掉整轮", async () => {
    let round = 0;
    let received: Record<string, unknown> | undefined;
    const deps = mockDeps({
      callLLM: async () => {
        round += 1;
        return round === 1
          ? { content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: "{not json" }] }
          : { content: "done", toolCalls: [] };
      },
      executeTool: async (call) => { received = call.arguments; return null; },
    });

    await runWithTools(deps, [{ role: "user", content: "q" }], { tools });
    expect(received).toEqual({});
  });

  it("触达 maxRounds 后撤掉工具声明，循环必然收敛", async () => {
    const declaredPerRound: boolean[] = [];
    const deps = mockDeps({
      callLLM: async (_cfg, _messages, opts) => {
        declaredPerRound.push(!!opts?.tools);
        return { content: "final", toolCalls: opts?.tools ? [{ id: "c", name: "search_corpus", arguments: "{}" }] : [] };
      },
      executeTool: async () => ({}),
    });

    const out = await runWithTools(deps, [{ role: "user", content: "q" }], { tools, maxRounds: 2 });

    expect(declaredPerRound).toEqual([true, true, false]);
    expect(out.content).toBe("final");
  });

  it("模型不要工具时只调一次 LLM，行为等同普通对话", async () => {
    let calls = 0;
    const deps = mockDeps({
      callLLM: async () => { calls += 1; return { content: "直接回答", toolCalls: [] }; },
    });
    const out = await runWithTools(deps, [{ role: "user", content: "q" }], { tools });
    expect(calls).toBe(1);
    expect(out).toEqual({ content: "直接回答", calls: [] });
  });

  it("未注入 executeTool 时明确报错，而不是静默跳过工具", async () => {
    const deps = mockDeps({
      callLLM: async () => ({ content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: "{}" }] }),
    });
    await expect(runWithTools(deps, [{ role: "user", content: "q" }], { tools })).rejects.toThrow(
      "tool step requires deps.executeTool",
    );
  });

  it("订阅 onEvent 时产出成对的 tool 事件（running → ok）", async () => {
    let round = 0;
    const events: RunEvent[] = [];
    const deps = mockDeps({
      callLLM: async () => {
        round += 1;
        return round === 1
          ? { content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: '{"q":"x"}' }] }
          : { content: "done", toolCalls: [] };
      },
      executeTool: async () => ({ hits: 1 }),
      onEvent: (e) => events.push(e),
    });

    const out = await runWithTools(deps, [{ role: "user", content: "q" }], { tools });

    const toolEvents = events.filter((e) => e.type === "tool");
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0]).toMatchObject({
      type: "tool",
      call: { id: "c1", name: "search_corpus", status: "running", arguments: { q: "x" } },
    });
    expect(toolEvents[1]).toMatchObject({
      type: "tool",
      call: { id: "c1", name: "search_corpus", status: "ok", result: { hits: 1 } },
    });
    expect(out.calls[0].result).toEqual({ hits: 1 });
  });

  it("工具失败时仍产出 tool 结束事件（status: error），且失败回灌不中止", async () => {
    let round = 0;
    const events: RunEvent[] = [];
    const deps = mockDeps({
      callLLM: async (_cfg, messages) => {
        round += 1;
        if (round === 1) return { content: "", toolCalls: [{ id: "c1", name: "search_corpus", arguments: "{}" }] };
        return { content: `saw:${messages.at(-1)?.content}`, toolCalls: [] };
      },
      executeTool: async () => {
        throw new Error("search failed: 500");
      },
      onEvent: (e) => events.push(e),
    });

    const out = await runWithTools(deps, [{ role: "user", content: "q" }], { tools });

    const toolEvents = events.filter((e) => e.type === "tool");
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0]).toMatchObject({ call: { status: "running" } });
    expect(toolEvents[1]).toMatchObject({
      call: { status: "error", error: "search failed: 500" },
    });
    expect(out.content).toBe(`saw:${JSON.stringify({ error: "search failed: 500" })}`);
    expect(out.calls[0].error).toBe("search failed: 500");
  });
});

describe("RunEvent 出口（chunk / tool 可选）", () => {
  const streamingLlmDef: SkillDef = {
    id: "stream-llm",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    steps: [
      {
        id: "generate",
        kind: "llm",
        run: async (ctx) => {
          const { content } = await ctx.deps.callLLM(ctx.deps.llmConfig, [{ role: "user", content: "hi" }], {
            signal: ctx.deps.signal,
          });
          return content;
        },
      },
    ],
    buildOutput: (ctx) => ({ text: ctx.results.generate }),
  };

  it("订阅时收到 llm 步的 chunk 事件（带 stepId）", async () => {
    const sideEvents: RunEvent[] = [];
    const deps = mockDeps({
      callLLM: async (_cfg, _messages, opts) => {
        opts?.onChunk?.("hello");
        opts?.onChunk?.(" world");
        return { content: "hello world", toolCalls: [] };
      },
      onEvent: (e) => sideEvents.push(e),
    });

    const evs = await collect(executeSkill(streamingLlmDef, {}, deps));
    const chunks = sideEvents.filter((e) => e.type === "chunk");
    expect(chunks).toEqual([
      { type: "chunk", stepId: "generate", text: "hello" },
      { type: "chunk", stepId: "generate", text: " world" },
    ]);
    expect(evs.find((e) => e.type === "result")).toEqual({
      type: "result",
      output: { text: "hello world" },
    });
  });

  it("不订阅 onEvent 时产物与订阅时一致（契约：可选性）", async () => {
    const callLLM = async (_cfg: unknown, _messages: unknown, opts?: { onChunk?: (c: string) => void }) => {
      opts?.onChunk?.("partial");
      return { content: "full-answer", toolCalls: [] as [] };
    };

    const withSub: RunEvent[] = [];
    const without = await collect(
      executeSkill(streamingLlmDef, {}, mockDeps({ callLLM: callLLM as SkillDeps["callLLM"] })),
    );
    const withOn = await collect(
      executeSkill(
        streamingLlmDef,
        {},
        mockDeps({
          callLLM: callLLM as SkillDeps["callLLM"],
          onEvent: (e) => withSub.push(e),
        }),
      ),
    );

    const strip = (evs: RunEvent[]) =>
      evs.map((e) => {
        if (e.type === "step") {
          const { output: _o, ...step } = e.step;
          return { type: e.type, step: { ...step, output: e.step.output } };
        }
        return e;
      });
    expect(strip(without)).toEqual(strip(withOn));
    expect(withSub.some((e) => e.type === "chunk")).toBe(true);
  });
});
