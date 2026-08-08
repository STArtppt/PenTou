import { afterEach, describe, expect, it, vi } from "vitest";
import { requestChatCompletions, type LLMConfig, type ToolDef } from "./llm";

const cfg: LLMConfig = { endpoint: "http://llm.test/v1", apiKey: "k", model: "m" };

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_current_view",
      description: "读取当前视图正文",
      parameters: { type: "object", properties: { section: { type: "string" } } },
    },
  },
];

/** 把若干 SSE 事件行拼成一个 ReadableStream，模拟 /chat/completions 的流式响应。 */
function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n`).join("") + "data: [DONE]\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

/** 测试 mock 的 fetch 响应体：body 用独立字段，避开 Response.body 的 ArrayBuffer 泛型收窄。 */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  body?: ReadableStream<Uint8Array>;
}) {
  const spy = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", ...response }));
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

function bodyOf(spy: ReturnType<typeof stubFetch>): Record<string, unknown> {
  return JSON.parse((spy.mock.calls[0] as any)[1].body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestChatCompletions — 声明工具", () => {
  it("非流式下解析出工具调用与文本", async () => {
    const spy = stubFetch({
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "read_current_view", arguments: '{"section":"设计"}' } },
              ],
            },
          },
        ],
      }),
    });

    const out = await requestChatCompletions(cfg, [{ role: "user", content: "总结这一节" }], { tools: TOOLS });

    expect(out.content).toBe("");
    expect(out.toolCalls).toEqual([
      { id: "call_1", name: "read_current_view", arguments: '{"section":"设计"}' },
    ]);
    expect(bodyOf(spy).tools).toEqual(TOOLS);
  });

  it("流式下按 index 累加分片后的 tool_calls", async () => {
    stubFetch({
      body: sseStream([
        { choices: [{ delta: { content: "让我看一下" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "read_", arguments: '{"sec' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "current_view", arguments: 'tion":"A"}' } }] } }] },
      ]),
    });

    const chunks: string[] = [];
    const out = await requestChatCompletions(cfg, [{ role: "user", content: "q" }], {
      onChunk: (c) => chunks.push(c),
      tools: TOOLS,
    });

    expect(chunks).toEqual(["让我看一下"]);
    expect(out.content).toBe("让我看一下");
    expect(out.toolCalls).toEqual([
      { id: "call_9", name: "read_current_view", arguments: '{"section":"A"}' },
    ]);
  });

  it("透传 tool_choice，并接受 role=tool 的回执消息", async () => {
    const spy = stubFetch({ json: async () => ({ choices: [{ message: { content: "好的" } }] }) });

    const out = await requestChatCompletions(
      cfg,
      [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "read_current_view", arguments: "{}" } }],
        },
        { role: "tool", content: "正文…", tool_call_id: "call_1" },
      ],
      { tools: TOOLS, toolChoice: "auto" },
    );

    expect(out).toEqual({ content: "好的", toolCalls: [] });
    const body = bodyOf(spy);
    expect(body.tool_choice).toBe("auto");
    expect((body.messages as any[])[2]).toEqual({ role: "tool", content: "正文…", tool_call_id: "call_1" });
  });
});

describe("requestChatCompletions — 不声明工具时行为不变", () => {
  it("请求体不含 tools / tool_choice", async () => {
    const spy = stubFetch({ json: async () => ({ choices: [{ message: { content: "hi" } }] }) });

    const out = await requestChatCompletions(cfg, [{ role: "user", content: "q" }]);

    expect(out).toEqual({ content: "hi", toolCalls: [] });
    const body = bodyOf(spy);
    expect(body).toEqual({ model: "m", messages: [{ role: "user", content: "q" }], stream: false });
    expect("tools" in body).toBe(false);
    expect("tool_choice" in body).toBe(false);
  });

  it("空 tools 数组同样不写进请求体", async () => {
    const spy = stubFetch({ json: async () => ({ choices: [{ message: { content: "hi" } }] }) });
    await requestChatCompletions(cfg, [{ role: "user", content: "q" }], { tools: [], toolChoice: "auto" });
    expect("tools" in bodyOf(spy)).toBe(false);
  });

  it("流式逐块回调并返回全文", async () => {
    stubFetch({
      body: sseStream([
        { choices: [{ delta: { content: "a" } }] },
        { choices: [{ delta: { content: "b" } }] },
      ]),
    });

    const chunks: string[] = [];
    const out = await requestChatCompletions(cfg, [{ role: "user", content: "q" }], {
      onChunk: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(["a", "b"]);
    expect(out).toEqual({ content: "ab", toolCalls: [] });
  });

  it("中断时 resolve 已累积内容而非抛错", async () => {
    vi.stubGlobal("fetch", (async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch);

    await expect(requestChatCompletions(cfg, [{ role: "user", content: "q" }])).resolves.toEqual({
      content: "",
      toolCalls: [],
    });
  });

  it("HTTP 失败抛 LLMError", async () => {
    stubFetch({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad key" } as any);
    await expect(requestChatCompletions(cfg, [{ role: "user", content: "q" }])).rejects.toMatchObject({
      name: "LLMError",
      context: { status: 401 },
    });
  });
});
