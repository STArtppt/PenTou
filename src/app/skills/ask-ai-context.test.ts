import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { executeSkill, type RunEvent, type SkillDeps } from "../skill-runtime";
import { askAiContext, type AskAiOutput } from "./ask-ai-context";
import type { ChatMessage } from "../llm";

function run(input: Record<string, unknown>, over: Partial<SkillDeps>) {
  const deps: SkillDeps = {
    apiBase: "",
    fetchImpl: (async () => ({ ok: true, json: async () => ({ hits: [] }) })) as unknown as typeof fetch,
    callLLM: async () => "canned-answer",
    llmConfig: {} as SkillDeps["llmConfig"],
    ...over,
  };
  return executeSkill(askAiContext, input, deps);
}

async function collect(gen: AsyncGenerator<RunEvent, void, void>) {
  const out: RunEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
function resultOf(evs: RunEvent[]): AskAiOutput {
  const r = evs.find((e) => e.type === "result");
  if (!r) throw new Error("no result; events: " + JSON.stringify(evs));
  return (r as any).output as AskAiOutput;
}

describe("ask-ai-context skill", () => {
  it("answers with citations when search hits", async () => {
    let capturedMessages: ChatMessage[] | undefined;
    const evs = await collect(
      run(
        { query: "为什么本地优先？" },
        {
          fetchImpl: (async () => ({
            ok: true,
            json: async () => ({
              hits: [{ type: "conversation", id: "c1", title: "选型", snippetText: "本地优先片段" }],
            }),
          })) as unknown as typeof fetch,
          callLLM: async (_cfg, messages) => {
            capturedMessages = messages;
            return "answer-with-context";
          },
        },
      ),
    );
    const out = resultOf(evs);
    expect(out.answer).toBe("answer-with-context");
    expect(out.citations).toEqual([{ type: "conversation", id: "c1", title: "选型" }]);
    expect(capturedMessages?.[1].content).toContain("本地优先片段");
  });

  it("degrades with empty citations and a no-hit marker when nothing matches", async () => {
    let capturedMessages: ChatMessage[] | undefined;
    const evs = await collect(
      run(
        { query: "无关问题" },
        {
          fetchImpl: (async () => ({ ok: true, json: async () => ({ hits: [] }) })) as unknown as typeof fetch,
          callLLM: async (_cfg, messages) => {
            capturedMessages = messages;
            return "insufficient-context";
          },
        },
      ),
    );
    const out = resultOf(evs);
    expect(out.citations).toEqual([]);
    expect(capturedMessages?.[1].content).toContain("（无检索命中）");
  });

  it("passes topK through to the search limit", async () => {
    let calledUrl = "";
    await collect(
      run(
        { query: "q", topK: 3 },
        {
          fetchImpl: (async (url: string) => {
            calledUrl = url;
            return { ok: true, json: async () => ({ hits: [] }) };
          }) as unknown as typeof fetch,
        },
      ),
    );
    expect(calledUrl).toContain("mode=hybrid");
    expect(calledUrl).toContain("limit=3");
  });
});

describe("ask-ai-context schema alignment (SKILL.md as source of truth)", () => {
  it("runtime inputSchema matches data/skills/ask-ai-context/schema/input.schema.json", () => {
    const published = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "data/skills/ask-ai-context/schema/input.schema.json"),
        "utf-8",
      ),
    );
    expect(new Set(published.required)).toEqual(new Set(askAiContext.inputSchema.required));
    expect(new Set(Object.keys(published.properties))).toEqual(
      new Set(Object.keys(askAiContext.inputSchema.properties ?? {})),
    );
    expect(published.additionalProperties).toBe(askAiContext.inputSchema.additionalProperties);
  });
});
