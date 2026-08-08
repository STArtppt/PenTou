/**
 * RunTrace — 执行轨迹展示（spec agent-run-visibility）。
 * 解析 compact JSON（围栏块 language=pentou-run-trace），展示步骤 / 工具 / 思考增量区。
 */
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, X, Wrench } from "lucide-react";
import clsx from "clsx";
import { useTranslation } from "../i18n";
import type { CompactRunTrace, CompactTraceCall, CompactTraceStep } from "../run-trace";
import { parseTraceFence } from "../run-trace";

export function parseRunTraceSource(source: string): CompactRunTrace | null {
  // source 可能是纯 JSON（react-markdown 传入的 code children）
  try {
    const parsed = JSON.parse(source) as CompactRunTrace;
    if (parsed && Array.isArray(parsed.steps) && Array.isArray(parsed.calls)) return parsed;
  } catch {
    /* fall through */
  }
  return parseTraceFence("```pentou-run-trace\n" + source + "\n```");
}

function StepIcon({ status }: { status: CompactTraceStep["status"] }) {
  if (status === "running") return <Loader2 size={12} className="animate-spin text-blue-500" />;
  if (status === "done") return <Check size={12} className="text-emerald-600 dark:text-emerald-400" />;
  if (status === "error") return <X size={12} className="text-red-600 dark:text-red-400" />;
  return <X size={12} className="text-zinc-400" />;
}

function CallIcon({ status }: { status: CompactTraceCall["status"] }) {
  if (status === "running") return <Loader2 size={11} className="animate-spin text-blue-500" />;
  if (status === "ok") return <Check size={11} className="text-emerald-600 dark:text-emerald-400" />;
  return <X size={11} className="text-red-600 dark:text-red-400" />;
}

function kindLabel(kind: string, t: (k: string) => string): string {
  switch (kind) {
    case "api":
      return t("runTrace.kindApi");
    case "llm":
      return t("runTrace.kindLlm");
    case "transform":
      return t("runTrace.kindTransform");
    case "tool":
      return t("runTrace.kindTool");
    default:
      return kind;
  }
}

export function RunTrace({
  source,
  thinking,
}: {
  /** 围栏块内 JSON 文本，或完整 compact trace JSON */
  source: string;
  /** 运行中的思考增量（可选，仅内存态由气泡传入） */
  thinking?: string;
}) {
  const { t } = useTranslation();
  const trace = parseRunTraceSource(source);
  const [open, setOpen] = useState(true);
  const [thinkingOpen, setThinkingOpen] = useState(true);

  if (!trace) {
    return (
      <pre className="my-2 overflow-x-auto rounded border border-border bg-muted p-2 text-xs">
        {source}
      </pre>
    );
  }

  return (
    <div
      data-testid="run-trace"
      className="my-3 overflow-hidden rounded-lg border border-border bg-muted/50 text-xs"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t("runTrace.title")}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">{trace.skillId}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-2">
          {/* 步骤 */}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("runTrace.steps")}
            </div>
            <ul className="space-y-1">
              {trace.steps.map((step) => (
                <li key={step.id} className="flex items-center gap-2 text-foreground/90">
                  <StepIcon status={step.status} />
                  <span className="font-mono text-xs">{step.id}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{kindLabel(step.kind, t)}</span>
                  {typeof step.ms === "number" && (
                    <span className="ml-auto tabular-nums text-muted-foreground">{step.ms}ms</span>
                  )}
                </li>
              ))}
              {!trace.steps.length && (
                <li className="text-muted-foreground">{t("runTrace.emptySteps")}</li>
              )}
            </ul>
          </div>

          {/* 工具调用 */}
          {trace.calls.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("runTrace.tools")}
              </div>
              <ul className="space-y-1">
                {trace.calls.map((call, i) => (
                  <li
                    key={`${call.name}-${i}`}
                    className="flex flex-wrap items-start gap-1.5 text-foreground/90"
                  >
                    <Wrench size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <CallIcon status={call.status} />
                    <span className="font-mono">{call.name}</span>
                    {call.argsSummary && (
                      <span className="min-w-0 break-all text-muted-foreground">({call.argsSummary})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 思考增量（可折叠） */}
          {thinking?.trim() && (
            <div>
              <button
                type="button"
                className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                onClick={() => setThinkingOpen((v) => !v)}
              >
                {thinkingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t("runTrace.thinking")}
              </button>
              {thinkingOpen && (
                <div
                  className={clsx(
                    "max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border",
                    "bg-background p-2 text-xs leading-5 text-muted-foreground custom-scrollbar",
                  )}
                >
                  {thinking}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
