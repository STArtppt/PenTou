/**
 * skill-run.ts — 执行会话的内存态与事件归并（spec agent-run-session / visibility）。
 * 纯逻辑，供 data.tsx registry 与单测共用；不含 React。
 */
import type { AiChatSession, AiSidebarMessage } from "./ai-chats";
import { generateAiChatId, generateAiMessageId } from "./ai-chats";
import { buildRunSummary, summaryStringsFor } from "./build-run-summary";
import {
  buildCompactTrace,
  renderTraceFence,
  summarizeToolArgs,
  type CompactRunTrace,
  type CompactTraceCall,
  type CompactTraceStep,
} from "./run-trace";
import type { RunEvent, RunStep, StepKind } from "./skill-runtime";

export type SkillRunStatus = "running" | "done" | "error" | "aborted";

export interface SkillRunSeed {
  title: string;
  /** 用户消息：意图的自然语言描述 */
  userContent: string;
  skillId: string;
  model?: string;
  contextType?: "chat" | "doc";
  contextId?: string;
}

export interface LiveToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "running" | "ok" | "error";
  error?: string;
}

export interface LiveRunMemory {
  skillId: string;
  steps: Map<string, { id: string; kind: StepKind; status: RunStep["status"]; startedAt: number; ms?: number }>;
  stepOrder: string[];
  calls: LiveToolCall[];
  /** stepId → 思考增量（仅内存，不落盘） */
  thinkingByStep: Map<string, string>;
  output?: unknown;
  error?: string;
}

export function createLiveRunMemory(skillId: string): LiveRunMemory {
  return {
    skillId,
    steps: new Map(),
    stepOrder: [],
    calls: [],
    thinkingByStep: new Map(),
  };
}

/** 将一次 RunEvent 归并进内存态（可变）。 */
export function applyRunEvent(mem: LiveRunMemory, event: RunEvent): void {
  if (event.type === "step") {
    const prev = mem.steps.get(event.step.id);
    if (!prev) {
      mem.stepOrder.push(event.step.id);
      mem.steps.set(event.step.id, {
        id: event.step.id,
        kind: event.step.kind,
        status: event.step.status,
        startedAt: Date.now(),
      });
    } else {
      const ms =
        event.step.status === "done" || event.step.status === "error"
          ? Date.now() - prev.startedAt
          : prev.ms;
      mem.steps.set(event.step.id, {
        ...prev,
        status: event.step.status,
        ms,
      });
    }
    return;
  }
  if (event.type === "chunk") {
    const prev = mem.thinkingByStep.get(event.stepId) ?? "";
    mem.thinkingByStep.set(event.stepId, prev + event.text);
    return;
  }
  if (event.type === "tool") {
    const idx = mem.calls.findIndex((c) => c.id === event.call.id);
    const next: LiveToolCall = {
      id: event.call.id,
      name: event.call.name,
      arguments: event.call.arguments,
      status: event.call.status,
      error: event.call.error,
    };
    if (idx >= 0) mem.calls[idx] = next;
    else mem.calls.push(next);
    return;
  }
  if (event.type === "result") {
    mem.output = event.output;
    return;
  }
  if (event.type === "error") {
    mem.error = event.error;
  }
}

export function liveTraceFromMemory(mem: LiveRunMemory): CompactRunTrace {
  const steps: CompactTraceStep[] = mem.stepOrder.map((id) => {
    const s = mem.steps.get(id)!;
    return {
      id: s.id,
      kind: s.kind,
      status: s.status === "running" ? "running" : s.status,
      ...(typeof s.ms === "number" ? { ms: s.ms } : {}),
    };
  });
  const calls: CompactTraceCall[] = mem.calls.map((c) => ({
    name: c.name,
    argsSummary: summarizeToolArgs(c.arguments),
    status: c.status === "running" ? "running" : c.status === "ok" ? "ok" : "error",
  }));
  return buildCompactTrace({ skillId: mem.skillId, steps, calls });
}

/**
 * 组装助手消息 content：
 * - 运行中：思考增量 + 轨迹围栏（临时，便于 UI 解析）
 * - 终态：总结 + 压缩轨迹围栏（思考全文不进落盘前可再剥）
 *
 * 落盘时用 `contentForPersist`（去掉思考、只留总结+压缩轨迹）。
 */
export function contentForDisplay(
  mem: LiveRunMemory,
  status: SkillRunStatus,
  language: "en" | "zh" = "zh",
): string {
  const trace = liveTraceFromMemory(mem);
  const fence = renderTraceFence(trace);
  if (status === "running") {
    const thinking = [...mem.thinkingByStep.values()].join("");
    const parts = [thinking.trim() ? thinking : "", fence].filter(Boolean);
    return parts.join("\n\n");
  }
  const summary = buildRunSummary({
    skillId: mem.skillId,
    output: mem.output,
    trace,
    status: status === "done" ? "done" : status === "aborted" ? "aborted" : "error",
    error: mem.error,
    strings: summaryStringsFor(language),
  });
  return `${summary}\n\n${fence}`;
}

/** 落盘内容：总结 + 压缩轨迹（无思考全文）。 */
export function contentForPersist(
  mem: LiveRunMemory,
  status: SkillRunStatus,
  language: "en" | "zh" = "zh",
): string {
  if (status === "running") {
    // 检查点：只落压缩轨迹，不落思考
    return renderTraceFence(liveTraceFromMemory(mem));
  }
  return contentForDisplay(mem, status, language);
}

export function createRunSession(seed: SkillRunSeed, now = new Date().toISOString()): {
  session: AiChatSession;
  assistantId: string;
} {
  const userMessage: AiSidebarMessage = {
    id: generateAiMessageId(),
    role: "user",
    content: seed.userContent,
    status: "done",
  };
  const assistantId = generateAiMessageId();
  const assistantMessage: AiSidebarMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    status: "streaming",
    runSkillId: seed.skillId,
  };
  const session: AiChatSession = {
    id: generateAiChatId(),
    title: seed.title,
    kind: "run",
    messages: [userMessage, assistantMessage],
    createdAt: now,
    updatedAt: now,
    model: seed.model,
    contextType: seed.contextType,
    contextId: seed.contextId,
  };
  return { session, assistantId };
}

export function patchAssistant(
  session: AiChatSession,
  assistantId: string,
  patch: Partial<AiSidebarMessage>,
): AiChatSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: session.messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
  };
}

/** 同 sessionId 已有 running 时禁止再起（D8）。 */
export function assertCanStartRun(
  statuses: Map<string, SkillRunStatus> | Iterable<[string, { status: SkillRunStatus }]>,
  sessionId: string,
): { ok: true } | { ok: false; reason: "already-running" } {
  const map =
    statuses instanceof Map
      ? statuses
      : new Map([...statuses].map(([id, v]) => [id, v.status] as const));
  if (map.get(sessionId) === "running") return { ok: false, reason: "already-running" };
  return { ok: true };
}

/** 步骤终结事件（done/error）或终态才应落盘（D6）。 */
export function shouldPersistEvent(event: RunEvent): boolean {
  if (event.type === "result" || event.type === "error") return true;
  if (event.type === "step" && (event.step.status === "done" || event.step.status === "error")) {
    return true;
  }
  return false;
}
