import { describe, expect, it } from "vitest";
import { parseFileContent, parseHermesExport } from "./parsers";

describe("Hermes JSON import", () => {
  const hermesSession = {
    exported_at: "2026-06-17T02:09:25.981Z",
    session_id: "20260617_100341_d49919",
    title: "如何设置中文",
    session: null,
    message_count: 4,
    messages: [
      {
        id: 1,
        session_id: "20260617_100341_d49919",
        role: "user",
        content: "如何设置中文",
        timestamp: 1781661831.149601,
      },
      {
        id: 2,
        session_id: "20260617_100341_d49919",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", type: "function" }],
        timestamp: 1781661854.585419,
      },
      {
        id: 3,
        session_id: "20260617_100341_d49919",
        role: "tool",
        content: "side-effect output",
        timestamp: 1781661856.1,
      },
      {
        id: 4,
        session_id: "20260617_100341_d49919",
        role: "assistant",
        content: "可以在设置里切换语言。",
        timestamp: 1781661860.2,
      },
    ],
  };

  it("parses a Hermes session object into one conversation", () => {
    const [conv] = parseHermesExport(hermesSession);

    expect(conv).toMatchObject({
      title: "如何设置中文",
      platform: "Hermes",
      folderId: null,
    });
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "如何设置中文"],
      ["ai", "可以在设置里切换语言。"],
    ]);
    expect(conv.date).toBe(new Date(1781661831.149601 * 1000).toISOString());
  });

  it("routes Hermes .json files before ChatGPT fallback", () => {
    const convs = parseFileContent("session-20260617.json", JSON.stringify(hermesSession));

    expect(convs).toHaveLength(1);
    expect(convs[0].platform).toBe("Hermes");
  });
});
