import { describe, expect, it } from "vitest";
import { serializeAiThread } from "./AiSidebar";
import type { AiChatSession } from "../ai-chats";
import { renderTraceFence } from "../run-trace";
import { stripTraceFence } from "../run-trace";
import { sessionRunDisplayStatus } from "./AiSidebar";

describe("转文档剥离轨迹（D2 / task 5.8）", () => {
  it("serializeAiThread 产物不含 pentou-run-trace 围栏", () => {
    const fence = renderTraceFence({
      skillId: "topic-digest",
      steps: [{ id: "search", kind: "api", status: "done", ms: 1 }],
      calls: [],
    });
    const session: AiChatSession = {
      id: "chat_run",
      title: "run",
      kind: "run",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "u", role: "user", status: "done", content: "整理主题" },
        {
          id: "a",
          role: "assistant",
          status: "done",
          runSkillId: "topic-digest",
          content: `已生成文档。\n\n${fence}`,
        },
      ],
    };
    const body = serializeAiThread(session);
    expect(body).toContain("已生成文档");
    expect(body).not.toContain("pentou-run-trace");
    expect(body).not.toContain('"skillId"');
  });

  it("单条消息 strip 后不含围栏", () => {
    const fence = renderTraceFence({
      skillId: "x",
      steps: [],
      calls: [],
    });
    expect(stripTraceFence(`总结\n\n${fence}`)).toBe("总结");
  });
});

describe("sessionRunDisplayStatus", () => {
  const base = (status: "streaming" | "done" | "error" | "aborted"): AiChatSession => ({
    id: "s1",
    title: "run",
    kind: "run",
    createdAt: "t",
    updatedAt: "t",
    messages: [{ id: "a", role: "assistant", status, content: "" }],
  });

  it("registry running 优先", () => {
    expect(sessionRunDisplayStatus(base("done"), "running")).toBe("running");
  });

  it("无 live 时从消息 status 推导", () => {
    expect(sessionRunDisplayStatus(base("streaming"), null)).toBe("running");
    expect(sessionRunDisplayStatus(base("error"), null)).toBe("error");
    expect(sessionRunDisplayStatus(base("aborted"), null)).toBe("aborted");
    expect(sessionRunDisplayStatus(base("done"), null)).toBe("done");
  });

  it("非 run 会话返回 null", () => {
    const chat = { ...base("done"), kind: "chat" as const };
    expect(sessionRunDisplayStatus(chat, "running")).toBeNull();
  });
});
