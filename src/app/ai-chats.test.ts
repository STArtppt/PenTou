import { describe, expect, it } from "vitest";
import {
  aiChatSessionToMd,
  convergeInterruptedMessages,
  parseAiChatSessionMd,
  type AiChatSession,
} from "./ai-chats";
import { renderTraceFence } from "./run-trace";

describe("ai chat markdown serialization", () => {
  it("round-trips messages with html comment anchors", () => {
    const session: AiChatSession = {
      id: "chat_1_abcd",
      title: "Discuss markdown",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:01:00.000Z",
      model: "gpt-test",
      contextType: "doc",
      contextId: "doc_20260610_abcd",
      messages: [
        {
          id: "m1",
          role: "user",
          status: "done",
          content: "Can this contain headings?\n\n## user\n\nYes.",
          contextLabel: 'Context: Chat "A"',
        },
        {
          id: "m2",
          role: "assistant",
          status: "aborted",
          content: "It should not split on Markdown headings.\n\n## assistant\n\nStill content.",
        },
      ],
    };

    const parsed = parseAiChatSessionMd(session.id, aiChatSessionToMd(session));

    expect(parsed).toEqual(session);
  });

  it("round-trips kind、runSkillId 与轨迹围栏块", () => {
    const fence = renderTraceFence({
      skillId: "topic-digest",
      steps: [{ id: "search", kind: "api", status: "done", ms: 12 }],
      calls: [{ name: "search", argsSummary: "q=排序", status: "ok" }],
    });
    const session: AiChatSession = {
      id: "chat_run_1",
      title: "整理会话 · 检索排序",
      kind: "run",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:01:00.000Z",
      messages: [
        { id: "u1", role: "user", status: "done", content: "整理主题：检索排序" },
        {
          id: "a1",
          role: "assistant",
          status: "done",
          runSkillId: "topic-digest",
          content: `已从 3 条相关内容生成文档。\n\n${fence}`,
        },
      ],
    };

    const parsed = parseAiChatSessionMd(session.id, aiChatSessionToMd(session));
    expect(parsed.kind).toBe("run");
    expect(parsed.messages[1].runSkillId).toBe("topic-digest");
    expect(parsed.messages[1].content).toContain("```pentou-run-trace");
    expect(parsed.messages[1].content).toContain('"skillId":"topic-digest"');
  });

  it("旧格式 md（无 kind / runSkillId）解析结果与今天一致", () => {
    const legacy = `---
id: chat_old
title: Old chat
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:01:00.000Z
---

<!-- ai-msg role=user id=m1 status=done -->
hello
<!-- /ai-msg -->

<!-- ai-msg role=assistant id=m2 status=done -->
world
<!-- /ai-msg -->
`;
    const parsed = parseAiChatSessionMd("chat_old", legacy);
    expect(parsed.kind).toBeUndefined();
    expect(parsed.messages).toEqual([
      { id: "m1", role: "user", status: "done", content: "hello" },
      { id: "m2", role: "assistant", status: "done", content: "world" },
    ]);
  });

  it("convergeInterruptedMessages 把 streaming 改 aborted 并附注，不改终态消息", () => {
    const note = "因页面刷新中断";
    const messages = convergeInterruptedMessages(
      [
        { id: "u", role: "user", status: "done", content: "q" },
        { id: "a", role: "assistant", status: "streaming", content: "partial" },
        { id: "b", role: "assistant", status: "done", content: "ok" },
      ],
      note,
    );
    expect(messages[1].status).toBe("aborted");
    expect(messages[1].content).toContain(note);
    expect(messages[2].status).toBe("done");
  });
});
