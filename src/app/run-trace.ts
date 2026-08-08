/**
 * run-trace.ts — 执行轨迹的压缩载荷与围栏块序列化（spec agent-run-visibility D2）。
 *
 * 助手消息 content = 执行总结 Markdown + 末尾一个 ```` ```pentou-run-trace ```` 围栏块。
 * 只落压缩字段：步骤 id/kind/status/ms、工具 name/入参摘要/ok|error。
 * MUST NOT 落：思考 chunk 全文、工具完整返回体、完整入参 JSON。
 */

import type { StepKind } from "./skill-runtime";

export const RUN_TRACE_LANG = "pentou-run-trace";

const FENCE_OPEN = "```" + RUN_TRACE_LANG;
const FENCE_CLOSE = "```";

/** 围栏块匹配：独立成块的 pentou-run-trace 代码围栏。 */
const TRACE_FENCE_RE = /```pentou-run-trace\n([\s\S]*?)\n```/g;

export interface CompactTraceStep {
  id: string;
  kind: StepKind;
  status: "done" | "error" | "running" | "aborted";
  ms?: number;
}

export interface CompactTraceCall {
  name: string;
  /** 入参摘要（短字符串），不是完整 JSON。 */
  argsSummary: string;
  status: "ok" | "error" | "running";
}

export interface CompactRunTrace {
  skillId: string;
  steps: CompactTraceStep[];
  calls: CompactTraceCall[];
}

const ARGS_SUMMARY_MAX = 120;

/** 把工具入参压成短摘要：`key=value` 串联，截断到上限。 */
export function summarizeToolArgs(args: Record<string, unknown> | undefined | null): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    let text: string;
    if (value === null) text = "null";
    else if (typeof value === "string") text = value;
    else if (typeof value === "number" || typeof value === "boolean") text = String(value);
    else text = JSON.stringify(value);
    if (text.length > 40) text = `${text.slice(0, 37)}...`;
    parts.push(`${key}=${text}`);
  }
  const joined = parts.join(", ");
  return joined.length > ARGS_SUMMARY_MAX ? `${joined.slice(0, ARGS_SUMMARY_MAX - 3)}...` : joined;
}

/** 从运行期步骤/工具事件构建压缩轨迹（终态落盘用）。 */
export function buildCompactTrace(params: {
  skillId: string;
  steps: Array<{ id: string; kind: StepKind; status: CompactTraceStep["status"]; ms?: number }>;
  calls: Array<{ name: string; arguments?: Record<string, unknown>; argsSummary?: string; status: CompactTraceCall["status"] }>;
}): CompactRunTrace {
  return {
    skillId: params.skillId,
    steps: params.steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      ...(typeof s.ms === "number" ? { ms: s.ms } : {}),
    })),
    calls: params.calls.map((c) => ({
      name: c.name,
      argsSummary: c.argsSummary ?? summarizeToolArgs(c.arguments),
      status: c.status,
    })),
  };
}

/** 渲染为消息 content 末尾可追加的围栏块（含前后换行约定由调用方拼接）。 */
export function renderTraceFence(trace: CompactRunTrace): string {
  return `${FENCE_OPEN}\n${JSON.stringify(trace)}\n${FENCE_CLOSE}`;
}

/** 从消息 content 解析出压缩轨迹；没有或坏 JSON 时返回 null。 */
export function parseTraceFence(content: string): CompactRunTrace | null {
  TRACE_FENCE_RE.lastIndex = 0;
  const match = TRACE_FENCE_RE.exec(content);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as CompactRunTrace;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || !Array.isArray(parsed.calls)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 剥离所有 pentou-run-trace 围栏块，保留其余正文（含普通代码块）。
 * 用于「转成文档」等溢出点（D2）。
 */
export function stripTraceFence(content: string): string {
  TRACE_FENCE_RE.lastIndex = 0;
  return content
    .replace(TRACE_FENCE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
