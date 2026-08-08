/**
 * PlanRunBanner — 计划文档的执行状态条（spec plan-run-status）。
 *
 * 位置在 AI 侧边栏的上下文条幅正下方、同一张卡片样式（design D4 修订）：
 * 状态与**操作**必须同处一条 —— 它要回答的就是「这份计划跑没跑、现在能干什么」，
 * 把二者拆到屏幕两端只会让人来回找。
 *
 * 三态各给**恰好一个**按钮（D6 修订）：未执行 → 执行；`done` → 查记录；`partial` → 详情。
 * `partial` 刻意**不给重试**：快照已被它自己那次执行改脏，重试在物理上不可能成功，
 * 给一个必然失败的入口比不给更糟。
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, History, Info, Play } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "../i18n";
import type { AgentPlanRun } from "../skills/plan-doc";

export interface PlanRunBannerProps {
  /** 已解析的执行终态；`null` = 尚未执行。 */
  run: AgentPlanRun | null;
  /** 已格式化的执行时间。 */
  ranAtLabel: string;
  /** 那次执行的 run 会话是否还在 —— 不在就不渲染「查记录」。 */
  canViewTrace: boolean;
  /** 执行中（run registry 里该计划正在跑）时按钮禁用。 */
  running: boolean;
  onRun: () => void;
  onViewTrace: () => void;
}

export function PlanRunBanner({
  run,
  ranAtLabel,
  canViewTrace,
  running,
  onRun,
  onViewTrace,
}: PlanRunBannerProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const partial = run?.status === "partial";
  const label = t(partial ? "planRun.partialLabel" : run ? "planRun.doneLabel" : "planRun.pendingLabel");
  const summary = !run
    ? t("planRun.pending")
    : partial
      ? t("planRun.partial", { at: ranAtLabel, done: run.assigned.length })
      : t("planRun.done", { at: ranAtLabel, done: run.approved, skipped: run.skipped });
  // 「归入待清理」而非「已删除」：清理条目从头到尾没有任何删除调用（spec agent-write-policy D7）
  const cleanedNote = run && run.cleaned > 0 ? t("planRun.cleanedNote", { cleaned: run.cleaned }) : null;

  const Icon = partial ? AlertTriangle : run ? CheckCircle2 : CircleDashed;

  return (
    <div className="mb-4">
      <div
        data-slot="plan-run-banner"
        className={clsx(
          "flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-none",
          partial
            ? "border-destructive/25 bg-destructive/10 text-destructive"
            : "border-zinc-200 bg-white text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
        )}
      >
        <Icon size={14} className="shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{label}</div>
          <p className="mt-0.5 text-xs leading-snug">
            {summary}
            {cleanedNote ? ` ${cleanedNote}` : null}
          </p>
        </div>

        {!run ? (
          <Button
            variant="primary"
            size="sm"
            disabled={running}
            onClick={onRun}
            className="h-auto shrink-0 gap-1 px-2.5 py-1.5 text-xs"
          >
            <Play size={12} />
            {t("planRun.actionRun")}
          </Button>
        ) : partial ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDetailsOpen(true)}
            className="h-auto shrink-0 gap-1 px-2.5 py-1.5 text-xs"
          >
            <Info size={12} />
            {t("planRun.actionDetails")}
          </Button>
        ) : canViewTrace ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onViewTrace}
            className="h-auto shrink-0 gap-1 px-2.5 py-1.5 text-xs"
          >
            <History size={12} />
            {t("planRun.actionViewTrace")}
          </Button>
        ) : null}
      </div>

      {detailsOpen ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setDetailsOpen(false);
          }}
        >
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("planRun.detailsTitle")}</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {t("planRun.detailsIntro", { at: ranAtLabel, done: run?.assigned.length ?? 0 })}
                </p>
                {/* 原因是原始错误消息，可能很长也可能是英文技术串 —— 原样呈现，不加工不猜测 */}
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
                  {run?.error || t("planRun.detailsNoReason")}
                </pre>
                <p className="text-muted-foreground">{t("planRun.detailsNextStep")}</p>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t("planRun.detailsClose")}
                </DialogClose>
              </DialogFooter>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ) : null}
    </div>
  );
}
