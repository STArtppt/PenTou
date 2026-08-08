import { describe, expect, it } from "vitest";
import {
  applyRunEvent,
  assertCanStartRun,
  contentForPersist,
  createLiveRunMemory,
  createRunSession,
  shouldPersistEvent,
} from "./skill-run";
import { parseTraceFence, stripTraceFence } from "./run-trace";

describe("skill-run", () => {
  it("一会话一执行：已 running 时拒绝再起", () => {
    const map = new Map([["s1", "running" as const]]);
    expect(assertCanStartRun(map, "s1")).toEqual({ ok: false, reason: "already-running" });
    expect(assertCanStartRun(map, "s2")).toEqual({ ok: true });
  });

  it("chunk 只进内存，persist 内容不含思考全文", () => {
    const mem = createLiveRunMemory("topic-digest");
    applyRunEvent(mem, {
      type: "step",
      step: { id: "generate", kind: "llm", status: "running" },
    });
    applyRunEvent(mem, { type: "chunk", stepId: "generate", text: "思考中的长文……" });
    applyRunEvent(mem, {
      type: "step",
      step: { id: "generate", kind: "llm", status: "done" },
    });
    applyRunEvent(mem, {
      type: "result",
      output: { topic: "x", sourceCount: 1, citations: [] },
    });

    const persisted = contentForPersist(mem, "done");
    expect(persisted).not.toContain("思考中的长文");
    expect(parseTraceFence(persisted)?.steps[0].id).toBe("generate");
  });

  it("shouldPersistEvent：chunk 不落盘，step 终结与终态落盘", () => {
    expect(shouldPersistEvent({ type: "chunk", stepId: "a", text: "x" })).toBe(false);
    expect(
      shouldPersistEvent({ type: "step", step: { id: "a", kind: "api", status: "running" } }),
    ).toBe(false);
    expect(
      shouldPersistEvent({ type: "step", step: { id: "a", kind: "api", status: "done" } }),
    ).toBe(true);
    expect(shouldPersistEvent({ type: "result", output: {} })).toBe(true);
  });

  it("createRunSession 标记 kind=run 且助手 streaming", () => {
    const { session, assistantId } = createRunSession({
      title: "整理目录",
      userContent: "整理默认目录",
      skillId: "doc-folder-organize",
    });
    expect(session.kind).toBe("run");
    expect(session.messages[1].id).toBe(assistantId);
    expect(session.messages[1].status).toBe("streaming");
    expect(session.messages[1].runSkillId).toBe("doc-folder-organize");
  });

  it("转文档路径：strip 后不含围栏块", () => {
    const mem = createLiveRunMemory("conversation-to-doc");
    applyRunEvent(mem, { type: "result", output: { docId: "d1", title: "T", created: true } });
    const content = contentForPersist(mem, "done");
    expect(content).toContain("pentou-run-trace");
    expect(stripTraceFence(content)).not.toContain("pentou-run-trace");
  });
});
