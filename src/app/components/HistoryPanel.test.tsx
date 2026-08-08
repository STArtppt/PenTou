/**
 * HistoryPanel 运行态与终止控件（task 6.4）。
 * 通过导出的 sessionRunDisplayStatus 钉住：运行中才有终止 affordance。
 */
import { describe, expect, it } from "vitest";
import type { AiChatSession } from "../ai-chats";
import { sessionRunDisplayStatus } from "./AiSidebar";

function buildRunSession(id: string, status: "streaming" | "done" | "error" | "aborted"): AiChatSession {
  return {
    id,
    title: `Run ${id}`,
    kind: "run",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "u", role: "user", status: "done", content: "intent" },
      { id: "a", role: "assistant", status, content: "…", runSkillId: "topic-digest" },
    ],
  };
}

describe("HistoryPanel run status / abort affordance (task 6.4)", () => {
  it("运行中条目：display status 为 running，应展示终止控件", () => {
    const session = buildRunSession("r1", "streaming");
    expect(sessionRunDisplayStatus(session, "running")).toBe("running");
    // 控件条件：runStatus === "running" → 渲染 abort 按钮（见 HistoryPanel）
    const showAbort = sessionRunDisplayStatus(session, "running") === "running";
    expect(showAbort).toBe(true);
  });

  it("非运行条目：无终止控件", () => {
    for (const status of ["done", "error", "aborted"] as const) {
      const session = buildRunSession(`r-${status}`, status);
      expect(sessionRunDisplayStatus(session, null)).toBe(status);
      expect(sessionRunDisplayStatus(session, null) === "running").toBe(false);
    }
  });

  it("普通 chat 会话：不展示运行态/终止", () => {
    const chat: AiChatSession = {
      id: "c1",
      title: "chat",
      createdAt: "t",
      updatedAt: "t",
      messages: [{ id: "m", role: "user", status: "done", content: "hi" }],
    };
    expect(sessionRunDisplayStatus(chat, null)).toBeNull();
  });
});
