import { describe, expect, it } from "vitest";
import { aiChatSessionToMd, parseAiChatSessionMd, type AiChatSession } from "./ai-chats";

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
});
