/**
 * 采集源扩展 normalizer 测试（spec collector-source-expansion §6.1）。
 * 覆盖 6 个新 normalizer 的正常/畸形输入、hermes 导出格式回退、
 * parseJsonl 的 Codex rollout 输出 platform "ChatGPT"（决策 2）。
 */
import { describe, expect, it } from "vitest";
import { normalizeGrokCli, parseGrokTurns } from "./grok-cli";
import { normalizeOpencode } from "./opencode";
import { normalizeCopilot } from "./copilot";
import { normalizeCopilotVscode } from "./copilot-vscode";
import { normalizeHermes } from "./hermes";
import { normalizeCursor } from "./cursor";
import { normalizePi } from "./pi";
import { normalizeAntigravityCli } from "./antigravity-cli";
import { parseJsonl, parseMarkdown } from "../parsers";
import { EmptyPayloadError } from "./util";

describe("grok-cli normalizer (US-02)", () => {
  it("keeps real user/assistant turns, strips user_query wrapper, skips synthetic lines", () => {
    const data = [
      JSON.stringify({ type: "system", content: "You are Grok" }),
      JSON.stringify({ type: "user", synthetic_reason: "reminder", content: [{ type: "text", text: "<system-reminder>x</system-reminder>" }] }),
      JSON.stringify({ type: "user", prompt_index: 0, content: [{ type: "text", text: "<user_query>\n帮我看看这个 bug\n</user_query>" }] }),
      JSON.stringify({ type: "reasoning", encrypted_content: "…" }),
      JSON.stringify({ type: "assistant", content: "", tool_calls: [{}] }),
      JSON.stringify({ type: "assistant", content: "已定位到问题" }),
    ].join("\n");
    const [conv] = normalizeGrokCli(data);
    expect(conv.platform).toBe("Grok");
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "帮我看看这个 bug"],
      ["ai", "已定位到问题"],
    ]);
    expect(conv.title).toBe("帮我看看这个 bug");
  });

  it("throws when nothing parseable", () => {
    expect(() => normalizeGrokCli("not json")).toThrow(/no messages/);
  });

  it("throws EmptyPayloadError for system-only sessions (空会话归 skipped)", () => {
    const systemOnly = JSON.stringify({ type: "system", content: "You are Grok" });
    expect(() => normalizeGrokCli(systemOnly)).toThrow(EmptyPayloadError);
  });

  it("drops pure user_info/git_status injection lines so title is real user query", () => {
    // 真实 Grok 首轮：无 synthetic_reason 的 user_info/git_status 独立成行，
    // 再跟 <user_query>；旧实现会把注入行当 U1，标题变成 "<user_info>"。
    const data = [
      JSON.stringify({
        type: "user",
        content: [{
          type: "text",
          text: "<user_info>\nOS Version: macos\nShell: /bin/zsh\nWorkspace Path: /tmp/pentou\nToday's date: 2026-07-14\n</user_info>\n\n<git_status>\nOn branch main\nnothing to commit\n</git_status>",
        }],
      }),
      JSON.stringify({
        type: "user",
        synthetic_reason: "project_instructions",
        content: [{ type: "text", text: "<system-reminder>Agents.md</system-reminder>" }],
      }),
      JSON.stringify({
        type: "user",
        prompt_index: 0,
        content: [{ type: "text", text: "<user_query>\n请根据 guide.md 写 waylog 登记示例\n</user_query>" }],
      }),
      JSON.stringify({ type: "assistant", content: "可以这样写…" }),
    ].join("\n");
    const [conv] = normalizeGrokCli(data);
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "请根据 guide.md 写 waylog 登记示例"],
      ["ai", "可以这样写…"],
    ]);
    expect(conv.title).toBe("请根据 guide.md 写 waylog 登记示例");
    expect(conv.messages[0].content).not.toContain("user_info");
    expect(conv.messages[0].content).not.toContain("git_status");
  });

  it("drops Grok <rules> injection so U1/title are the real user_query", () => {
    // 2026-08 起 Grok CLI 把 AGENTS.md / user_rules 包进 <rules>，无 synthetic_reason；
    // 旧清洗剥完 user_info/git_status 后 leftover 非空，U1 变成系统提示词。
    const data = [
      JSON.stringify({ type: "system", content: "You are Grok 4.6 released by xAI." }),
      JSON.stringify({
        type: "user",
        content: [{
          type: "text",
          text: `<user_info>
OS Version: macos
Workspace Path: /tmp/pentou
</user_info>

<git_status>
## main
</git_status>

<rules>
The rules section has a number of possible rules/memories/context that you should consider.

<always_applied_workspace_rules description="workspace-level rules">
<always_applied_workspace_rule name="Agents.md"># AGENTS.md
Pentou 是本地优先的 AI 对话管理器。
</always_applied_workspace_rule>
</always_applied_workspace_rules>

<user_rules>
<user_rule>When implementing UI, verify in the browser.</user_rule>
</user_rules>
</rules>`,
        }],
      }),
      JSON.stringify({
        type: "user",
        prompt_index: 0,
        content: [{ type: "text", text: "<user_query>\ncli 采集器会把系统提示词带进用户首条消息\n</user_query>" }],
      }),
      JSON.stringify({ type: "assistant", content: "先查 grok-cli normalizer。" }),
    ].join("\n");
    const [conv] = normalizeGrokCli(data);
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "cli 采集器会把系统提示词带进用户首条消息"],
      ["ai", "先查 grok-cli normalizer。"],
    ]);
    expect(conv.title).toBe("cli 采集器会把系统提示词带进用户首条消息");
    expect(conv.messages[0].content).not.toContain("rules");
    expect(conv.messages[0].content).not.toContain("AGENTS.md");
    expect(conv.messages[0].content).not.toContain("You are Grok");
  });

  it("uses grok-cli-v1 envelope session.created_at when no turns (session-level fallback)", () => {
    const history = [
      JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>\n旧会话\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "答" }),
    ].join("\n");
    const envelope = JSON.stringify({
      schema: "grok-cli-v1",
      session: {
        created_at: "2026-07-13T03:50:41.719462Z",
        updated_at: "2026-07-13T03:53:14.410275Z",
        title: "summary title",
      },
      history,
    });
    const [conv] = normalizeGrokCli(envelope);
    expect(conv.date).toBe("2026-07-13T03:50:41.719Z");
    expect(conv.dateFromSource).toBe(true);
    expect(conv.title).toBe("summary title");
    // 无 turns 时消息全部回退会话时间
    expect(conv.messages.every((m) => m.timestamp === "2026-07-13T03:50:41.719Z")).toBe(true);
  });

  it("envelope without session times still parses history (legacy fallback path for date)", () => {
    const history = [
      JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>\nx\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "y" }),
    ].join("\n");
    const [conv] = normalizeGrokCli(JSON.stringify({ schema: "grok-cli-v1", session: {}, history }));
    expect(conv.messages).toHaveLength(2);
    expect(conv.dateFromSource).toBeUndefined();
    // 无源时间时用入库时刻，不应远在过去
    expect(Date.now() - Date.parse(conv.date)).toBeLessThan(5_000);
  });

  it("aligns multi-turn messages to turn_started / first_token / turn_ended", () => {
    const history = [
      JSON.stringify({ type: "user", prompt_index: 0, content: [{ type: "text", text: "<user_query>\n你是什么模型\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "我是 Grok" }),
      JSON.stringify({ type: "user", prompt_index: 1, content: [{ type: "text", text: "<user_query>\n第二问\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "第二答" }),
      JSON.stringify({ type: "user", prompt_index: 2, content: [{ type: "text", text: "<user_query>\n第三问\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "第三答" }),
    ].join("\n");
    const turns = [
      { turnNumber: 0, startedAt: "2026-07-13T03:50:46.108Z", firstTokens: ["2026-07-13T03:50:53.509Z"], endedAt: "2026-07-13T03:50:53.515Z" },
      { turnNumber: 1, startedAt: "2026-07-13T03:51:10.583Z", firstTokens: ["2026-07-13T03:51:20.889Z"], endedAt: "2026-07-13T03:51:28.446Z" },
      { turnNumber: 2, startedAt: "2026-07-13T03:52:48.862Z", firstTokens: ["2026-07-13T03:53:05.324Z"], endedAt: "2026-07-13T03:53:14.404Z" },
    ];
    const [conv] = normalizeGrokCli(JSON.stringify({
      schema: "grok-cli-v1",
      session: { created_at: "2026-07-13T03:50:41.719Z" },
      turns,
      history,
    }));
    expect(conv.date).toBe("2026-07-13T03:50:41.719Z");
    expect(conv.messages.map((m) => [m.role, m.timestamp])).toEqual([
      ["user", "2026-07-13T03:50:46.108Z"],
      ["ai", "2026-07-13T03:50:53.509Z"],
      ["user", "2026-07-13T03:51:10.583Z"],
      ["ai", "2026-07-13T03:51:20.889Z"],
      ["user", "2026-07-13T03:52:48.862Z"],
      ["ai", "2026-07-13T03:53:05.324Z"],
    ]);
    // 多轮 user 时间严格递增
    const userTs = conv.messages.filter((m) => m.role === "user").map((m) => Date.parse(m.timestamp));
    expect(userTs[0]).toBeLessThan(userTs[1]);
    expect(userTs[1]).toBeLessThan(userTs[2]);
  });

  it("interpolates multiple AI messages within a single turn window", () => {
    const history = [
      JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>\n评审\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "", tool_calls: [{}] }),
      JSON.stringify({ type: "assistant", content: "先对齐实现" }),
      JSON.stringify({ type: "assistant", content: "", tool_calls: [{}] }),
      JSON.stringify({ type: "assistant", content: "完整评审意见" }),
    ].join("\n");
    const turns = [{
      turnNumber: 0,
      startedAt: "2026-07-13T06:19:09.617Z",
      firstTokens: [
        "2026-07-13T06:19:36.019Z",
        "2026-07-13T06:19:38.436Z",
        "2026-07-13T06:19:42.869Z",
        "2026-07-13T06:19:47.075Z",
      ],
      endedAt: "2026-07-13T06:20:15.156Z",
    }];
    const [conv] = normalizeGrokCli(JSON.stringify({
      schema: "grok-cli-v1",
      session: { created_at: "2026-07-13T06:19:00.000Z" },
      turns,
      history,
    }));
    expect(conv.messages).toHaveLength(3); // 1 user + 2 non-empty AI
    expect(conv.messages[0].timestamp).toBe("2026-07-13T06:19:09.617Z");
    // firstTokens 条数 ≠ AI 条数 → 在 [firstToken0, endedAt] 插值，两条时间不同且落在窗内
    const a0 = Date.parse(conv.messages[1].timestamp);
    const a1 = Date.parse(conv.messages[2].timestamp);
    const lo = Date.parse("2026-07-13T06:19:36.019Z");
    const hi = Date.parse("2026-07-13T06:20:15.156Z");
    expect(a0).toBe(lo);
    expect(a1).toBe(hi);
    expect(a0).toBeLessThan(a1);
  });

  it("falls back to session date when turn count mismatches message groups", () => {
    const history = [
      JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>\na\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "A" }),
      JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>\nb\n</user_query>" }] }),
      JSON.stringify({ type: "assistant", content: "B" }),
    ].join("\n");
    // 只有 1 个 turn，但 2 个逻辑轮 → 全部 session 时间
    const [conv] = normalizeGrokCli(JSON.stringify({
      schema: "grok-cli-v1",
      session: { created_at: "2026-07-13T03:50:41.719Z" },
      turns: [{ startedAt: "2026-07-13T03:50:46.108Z", firstTokens: ["2026-07-13T03:50:53.509Z"], endedAt: "2026-07-13T03:50:53.515Z" }],
      history,
    }));
    expect(conv.messages.every((m) => m.timestamp === "2026-07-13T03:50:41.719Z")).toBe(true);
  });
});

describe("parseGrokTurns", () => {
  it("extracts turn windows ignoring phase_changed noise", () => {
    const events = [
      JSON.stringify({ type: "mcp_config_resolved", ts: "2026-07-13T03:50:42.000Z" }),
      JSON.stringify({ type: "phase_changed", ts: "2026-07-13T03:50:45.000Z", phase: "x" }),
      JSON.stringify({ type: "turn_started", ts: "2026-07-13T03:50:46.108Z", turn_number: 0 }),
      JSON.stringify({ type: "phase_changed", ts: "2026-07-13T03:50:50.000Z", phase: "y" }),
      JSON.stringify({ type: "first_token", ts: "2026-07-13T03:50:53.509Z" }),
      JSON.stringify({ type: "turn_ended", ts: "2026-07-13T03:50:53.515Z", outcome: "completed" }),
      JSON.stringify({ type: "turn_started", ts: "2026-07-13T03:51:10.583Z", turn_number: 1 }),
      JSON.stringify({ type: "first_token", ts: "2026-07-13T03:51:20.889Z" }),
      JSON.stringify({ type: "turn_ended", ts: "2026-07-13T03:51:28.446Z", outcome: "completed" }),
    ].join("\n");
    expect(parseGrokTurns(events)).toEqual([
      { turnNumber: 0, startedAt: "2026-07-13T03:50:46.108Z", firstTokens: ["2026-07-13T03:50:53.509Z"], endedAt: "2026-07-13T03:50:53.515Z" },
      { turnNumber: 1, startedAt: "2026-07-13T03:51:10.583Z", firstTokens: ["2026-07-13T03:51:20.889Z"], endedAt: "2026-07-13T03:51:28.446Z" },
    ]);
  });
});

describe("opencode normalizer (US-03)", () => {
  const envelope = JSON.stringify({
    schema: "opencode-v1",
    session: { id: "s1", title: "Fix bug", time_created: 1700000000000 },
    messages: [
      { role: "user", time: { created: 1700000001000 }, parts: [{ type: "text", text: "你好" }] },
      { role: "assistant", time: { created: 1700000002000 }, parts: [] }, // 纯工具轮
      { role: "assistant", time: { created: 1700000003000 }, parts: [{ type: "text", text: "hi" }] },
    ],
  });

  it("maps parts text into messages and keeps session title/date", () => {
    const [conv] = normalizeOpencode(envelope);
    expect(conv.platform).toBe("OpenCode");
    expect(conv.title).toBe("Fix bug");
    expect(conv.date).toBe(new Date(1700000000000).toISOString());
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([["user", "你好"], ["ai", "hi"]]);
    expect(conv.messages[0].timestamp).toBe(new Date(1700000001000).toISOString());
  });

  it("skips synthetic text parts (tool narration / file dumps / system-reminder)", () => {
    const data = JSON.stringify({
      schema: "opencode-v1",
      session: { id: "s2", title: "绩效", time_created: 1700000000000 },
      messages: [
        {
          role: "user",
          time: { created: 1700000001000 },
          parts: [
            { type: "text", text: "帮我完成6月绩效目标的填写" },
            { type: "text", synthetic: true, text: 'Called the Read tool with the following input: {"filePath":"/x.md"}' },
            {
              type: "text",
              synthetic: true,
              text: "<path>/x.md</path>\n<content>\nlog\n</content>\n\n<system-reminder>\nInstructions from AGENTS.md\n</system-reminder>",
            },
          ],
        },
        { role: "assistant", time: { created: 1700000002000 }, parts: [{ type: "text", text: "好的" }] },
      ],
    });
    const [conv] = normalizeOpencode(data);
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "帮我完成6月绩效目标的填写"],
      ["ai", "好的"],
    ]);
    expect(conv.messages[0].content).not.toContain("Called the");
    expect(conv.messages[0].content).not.toContain("system-reminder");
  });

  it("rejects payload without schema", () => {
    expect(() => normalizeOpencode('{"messages":[]}')).toThrow(/schema/);
  });
});

describe("copilot normalizer (US-04)", () => {
  it("expands turns into user/ai pairs with sqlite utc timestamps", () => {
    const envelope = JSON.stringify({
      schema: "copilot-v1",
      session: { id: "c1", summary: "帮助与指南", created_at: "2026-07-14 01:58:03" },
      messages: [{ turn_index: 0, user_message: "你好", assistant_response: "我能帮你…", timestamp: "2026-07-14 01:58:10" }],
    });
    const [conv] = normalizeCopilot(envelope);
    expect(conv.platform).toBe("Copilot");
    expect(conv.title).toBe("帮助与指南");
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([["user", "你好"], ["ai", "我能帮你…"]]);
    expect(conv.messages[0].timestamp).toBe(new Date("2026-07-14T01:58:10Z").toISOString());
  });

  it("throws when all turns are empty", () => {
    const envelope = JSON.stringify({ schema: "copilot-v1", session: {}, messages: [{ turn_index: 0 }] });
    expect(() => normalizeCopilot(envelope)).toThrow(/no messages/);
  });
});

describe("copilot-vscode normalizer (US-04)", () => {
  it("extracts request text and string-ish response parts", () => {
    const data = JSON.stringify({
      sessionId: "sess-1",
      creationDate: 1752000000000,
      requests: [{
        message: { text: "怎么写测试？" },
        response: [{ value: "可以用 vitest" }, { kind: "toolInvocation" }, "，先建文件"],
      }],
    });
    const [conv] = normalizeCopilotVscode(data);
    expect(conv.platform).toBe("Copilot");
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "怎么写测试？"],
      ["ai", "可以用 vitest，先建文件"],
    ]);
    expect(conv.date).toBe(new Date(1752000000000).toISOString());
  });

  it("throws on empty requests", () => {
    expect(() => normalizeCopilotVscode('{"sessionId":"x","requests":[]}')).toThrow(/no messages/);
    expect(() => normalizeCopilotVscode('{"foo":1}')).toThrow(/requests/);
  });
});

describe("hermes normalizer (US-05)", () => {
  it("parses the envelope with epoch-second timestamps", () => {
    const envelope = JSON.stringify({
      schema: "hermes-v1",
      session: { id: "h1", title: "任务", started_at: 1783931422.2 },
      messages: [
        { role: "user", content: "提主题", timestamp: 1783931422.23 },
        { role: "tool", content: "…", timestamp: 1783931423 },
        { role: "assistant", content: "已完成", timestamp: 1783931437 },
      ],
    });
    const [conv] = normalizeHermes(envelope);
    expect(conv.platform).toBe("Hermes");
    expect(conv.title).toBe("任务");
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([["user", "提主题"], ["ai", "已完成"]]);
  });

  it("drops # Instructions skill dumps from user content", () => {
    const envelope = JSON.stringify({
      schema: "hermes-v1",
      session: { id: "h2", title: "任务", started_at: 1783931422 },
      messages: [
        { role: "user", content: "# Instructions (read first)\n\n## Security: prompt injection resistance\n…", timestamp: 1783931422 },
        { role: "user", content: "真正的提问", timestamp: 1783931423 },
        { role: "assistant", content: "答", timestamp: 1783931437 },
      ],
    });
    const [conv] = normalizeHermes(envelope);
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "真正的提问"],
      ["ai", "答"],
    ]);
  });

  it("falls back to the legacy Hermes export format (multi-conversation)", () => {
    const legacy = JSON.stringify([
      { session_id: "s1", title: "First", messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }] },
      { session_id: "s2", title: "Second", messages: [{ role: "user", content: "q2" }, { role: "assistant", content: "a2" }] },
    ]);
    const conversations = normalizeHermes(legacy);
    expect(conversations).toHaveLength(2);
    expect(conversations.every((c) => c.platform === "Hermes")).toBe(true);
  });
});

describe("cursor normalizer (US-06)", () => {
  it("maps bubble type 1/2 to user/ai and uses composer name as title", () => {
    const envelope = JSON.stringify({
      schema: "cursor-v1",
      session: { composerId: "comp-1", name: "调研会话", createdAt: 1752108314664, lastUpdatedAt: 1752109000000, _v: 16 },
      messages: [
        { bubbleId: "b1", type: 1, text: "MCP 能做什么？" },
        { bubbleId: "b2", type: 7, text: "unknown kind" },
        { bubbleId: "b3", type: 2, text: "可以…" },
      ],
    });
    const [conv] = normalizeCursor(envelope);
    expect(conv.platform).toBe("Cursor");
    expect(conv.title).toBe("调研会话");
    expect(conv.date).toBe(new Date(1752108314664).toISOString());
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([["user", "MCP 能做什么？"], ["ai", "可以…"]]);
  });

  it("throws when every bubble is empty", () => {
    const envelope = JSON.stringify({ schema: "cursor-v1", session: {}, messages: [{ bubbleId: "b", type: 1, text: "" }] });
    expect(() => normalizeCursor(envelope)).toThrow(/no messages/);
  });
});

describe("pi normalizer", () => {
  const line = (obj: unknown) => JSON.stringify(obj);

  it("keeps user/assistant text, drops thinking / toolCall / toolResult and control events", () => {
    const data = [
      line({ type: "session", version: 3, id: "019fa2f4", timestamp: "2026-07-27T09:43:03.653Z", cwd: "/Users/me/code/pentou" }),
      line({ type: "model_change", id: "m1", timestamp: "2026-07-27T09:43:03.682Z", provider: "volcengine", modelId: "kimi-k2.7-code" }),
      line({ type: "thinking_level_change", id: "t1", timestamp: "2026-07-27T09:43:03.682Z", thinkingLevel: "off" }),
      line({
        type: "message",
        id: "u1",
        timestamp: "2026-07-27T09:43:33.240Z",
        message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1785145413237 },
      }),
      line({
        type: "message",
        id: "a1",
        timestamp: "2026-07-27T09:43:36.071Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "内部推理不入正文" },
            { type: "text", text: "你好！有什么可以帮你的？" },
            { type: "toolCall", id: "read_0", name: "read", arguments: { path: "/x" } },
          ],
        },
      }),
      line({
        type: "message",
        id: "r1",
        timestamp: "2026-07-27T09:43:36.100Z",
        message: { role: "toolResult", toolCallId: "read_0", toolName: "read", content: [{ type: "text", text: "文件内容" }] },
      }),
      // 纯工具调用轮：无 text part，整条丢弃
      line({
        type: "message",
        id: "a2",
        timestamp: "2026-07-27T09:43:40.000Z",
        message: { role: "assistant", content: [{ type: "toolCall", id: "bash_1", name: "bash", arguments: {} }] },
      }),
    ].join("\n");

    const [conv] = normalizePi(data);
    expect(conv.platform).toBe("Pi");
    expect(conv.date).toBe("2026-07-27T09:43:03.653Z");
    expect(conv.dateFromSource).toBe(true);
    expect(conv.sourceProject).toBe("pentou");
    expect(conv.title).toBe("你好");
    expect(conv.messages.map((m) => [m.role, m.content, m.timestamp])).toEqual([
      ["user", "你好", "2026-07-27T09:43:33.240Z"],
      ["ai", "你好！有什么可以帮你的？", "2026-07-27T09:43:36.071Z"],
    ]);
  });

  it("falls back to message.timestamp (epoch ms) and strips agent-injected blocks from user text", () => {
    const data = [
      line({ type: "session", id: "s", cwd: "" }),
      line({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "<system-reminder>噪声</system-reminder>\n真实提问" }], timestamp: 1785145413237 },
      }),
      // 清洗后为空 → 丢弃
      line({ type: "message", message: { role: "user", content: [{ type: "text", text: "<system-reminder>只有噪声</system-reminder>" }] } }),
      "半行 not json",
    ].join("\n");

    const [conv] = normalizePi(data);
    expect(conv.sourceProject).toBeUndefined();
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ content: "真实提问", timestamp: new Date(1785145413237).toISOString() });
    expect(conv.dateFromSource).toBe(true);
  });

  it("throws EmptyPayloadError when the session holds no user/assistant text", () => {
    const data = [
      line({ type: "session", id: "s", timestamp: "2026-07-27T09:43:03.653Z", cwd: "/tmp/x" }),
      line({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "只有工具回显" }] } }),
    ].join("\n");
    expect(() => normalizePi(data)).toThrow(EmptyPayloadError);
  });
});

describe("antigravity-cli normalizer (spec collector-antigravity US-02)", () => {
  const line = (obj: unknown) => JSON.stringify(obj);

  const transcript = [
    line({
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-08-19T09:51:10Z",
      content: "<USER_REQUEST>\n理解一下本项目\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-08-19T17:51:10+08:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.6 Flash (High).\n</USER_SETTINGS_CHANGE>",
    }),
    line({
      step_index: 1,
      source: "SYSTEM",
      type: "CHECKPOINT",
      status: "DONE",
      created_at: "2026-08-19T09:51:10Z",
      content: "{{ CHECKPOINT 0 }} The earlier parts of this conversation have been truncated...",
    }),
    // 工具调用轮：只有 tool_calls，无正文 → 跳过
    line({
      step_index: 2,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-08-19T09:51:12Z",
      tool_calls: [{ name: "list_dir", args: { DirectoryPath: "/Users/x/proj" } }],
    }),
    // 工具结果 → 跳过
    line({
      step_index: 3,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-08-19T09:51:13Z",
      content: "Created At: ... Completed At: ... File Path: `file:///Users/x/proj/package.json`",
    }),
    // 带 thinking + content 的最终回答
    line({
      step_index: 4,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-08-19T09:51:20Z",
      thinking: "先看 package.json 再下结论。",
      content: "这是一个 Vite 项目。",
    }),
    // 进行中的步（RUNNING）→ 跳过，避免半写内容
    line({
      step_index: 5,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "RUNNING",
      created_at: "2026-08-19T09:51:21Z",
      content: "半截回答不该入库",
    }),
  ].join("\n");

  it("maps USER_INPUT / final PLANNER_RESPONSE to messages, drops tool & system noise", () => {
    const [conv] = normalizeAntigravityCli(transcript);
    expect(conv.platform).toBe("Antigravity");
    expect(conv.title).toBe("理解一下本项目");
    expect(conv.date).toBe("2026-08-19T09:51:10.000Z");
    expect(conv.dateFromSource).toBe(true);
    expect(conv.messages.map((m) => [m.role, m.content, m.timestamp])).toEqual([
      ["user", "理解一下本项目", "2026-08-19T09:51:10.000Z"],
      ["ai", "这是一个 Vite 项目。", "2026-08-19T09:51:20.000Z"],
    ]);
    expect(conv.messages[1].reasoning).toEqual({ thinking: "先看 package.json 再下结论。" });
  });

  it("envelope carries workspace → sourceProject (independent from Gemini brand)", () => {
    const envelope = JSON.stringify({
      schema: "antigravity-cli-v1",
      conversationId: "77b9ef85-035e-450c-942e-027bfcbb9f22",
      workspace: "/Users/x/Desktop/LIFE/coding/myproj/startist-ui",
      history: transcript,
    });
    const [conv] = normalizeAntigravityCli(envelope);
    expect(conv.platform).toBe("Antigravity");
    expect(conv.sourceProject).toBe("startist-ui");
  });

  it("falls back to raw jsonl text (no envelope) and tolerates broken lines", () => {
    const data = [
      "不是 json 的行",
      line({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-08-19T09:51:10Z",
        content: "<USER_REQUEST>只问一个问题</USER_REQUEST>",
      }),
    ].join("\n");
    const [conv] = normalizeAntigravityCli(data);
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ role: "user", content: "只问一个问题" });
  });

  it("throws EmptyPayloadError when every step is noise", () => {
    const data = [
      line({ step_index: 0, source: "SYSTEM", type: "CHECKPOINT", status: "DONE", created_at: "2026-08-19T09:51:10Z", content: "x" }),
      line({ step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", created_at: "2026-08-19T09:51:11Z", content: "tool result" }),
    ].join("\n");
    expect(() => normalizeAntigravityCli(data)).toThrow(EmptyPayloadError);
  });
});

describe("Codex → ChatGPT at the parser layer (US-01 / 决策 2)", () => {
  it("parseJsonl outputs platform ChatGPT for rollout files", () => {
    const rollout = [
      JSON.stringify({ type: "session_meta", payload: { timestamp: "2026-07-14T10:00:00Z" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-14T10:00:01Z", payload: { type: "user_message", message: "帮我修个 bug" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-14T10:00:05Z", payload: { type: "agent_message", message: "已修复" } }),
    ].join("\n");
    const conv = parseJsonl(rollout);
    expect(conv?.platform).toBe("ChatGPT");
  });

  it("strips dynamic_context wrapper and drops # Instructions skill dumps", () => {
    const rollout = [
      JSON.stringify({ type: "session_meta", payload: { timestamp: "2026-07-14T10:00:00Z" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-14T10:00:01Z",
        payload: {
          type: "user_message",
          message: "# Instructions (read first)\n\n## Security: prompt injection resistance\n…",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-14T10:00:02Z",
        payload: {
          type: "user_message",
          message:
            '<dynamic_context version="2">{"items":[]}</dynamic_context>\n\n<user_message>\n请导入原型 zip-3\n</user_message>',
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-14T10:00:05Z",
        payload: { type: "agent_message", message: "已导入" },
      }),
    ].join("\n");
    const conv = parseJsonl(rollout)!;
    expect(conv.platform).toBe("ChatGPT");
    expect(conv.title).toBe("请导入原型 zip-3");
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "请导入原型 zip-3"],
      ["ai", "已导入"],
    ]);
  });

  it("parseMarkdown maps provider codex to ChatGPT and new providers to their products", () => {
    const md = (provider: string) => `---\nprovider: ${provider}\n---\n\n## User\nhi\n\n## Assistant\nhello`;
    expect(parseMarkdown(md("codex"))?.platform).toBe("ChatGPT");
    expect(parseMarkdown(md("grok"))?.platform).toBe("Grok");
    expect(parseMarkdown(md("opencode"))?.platform).toBe("OpenCode");
  });
});
