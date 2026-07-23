/**
 * 采集源扩展 normalizer 测试（spec collector-source-expansion §6.1）。
 * 覆盖 6 个新 normalizer 的正常/畸形输入、hermes 导出格式回退、
 * parseJsonl 的 Codex rollout 输出 platform "ChatGPT"（决策 2）。
 */
import { describe, expect, it } from "vitest";
import { normalizeGrokCli } from "./grok-cli";
import { normalizeOpencode } from "./opencode";
import { normalizeCopilot } from "./copilot";
import { normalizeCopilotVscode } from "./copilot-vscode";
import { normalizeHermes } from "./hermes";
import { normalizeCursor } from "./cursor";
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
