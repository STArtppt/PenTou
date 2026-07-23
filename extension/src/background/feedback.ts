import type { IngestAction } from "../shared/types";

/** 成功态 badge 颜色（蓝）。失败态各自用红/橙，在 index.ts 内联。 */
export const SUCCESS_BADGE_COLOR = "#2563eb";

export function actionText(actions?: Partial<Record<IngestAction, number>>): string {
  if (!actions) return "OK";
  if (actions.created) return "NEW";
  if (actions.merged) return "UPD";
  if (actions.skipped) return "SKIP";
  return "OK";
}

export function successMessage(actions?: Partial<Record<IngestAction, number>>): string {
  if (actions?.created) return "Saved as a new conversation. Click to open Pentou.";
  if (actions?.merged) return "Existing conversation updated. Click to open Pentou.";
  if (actions?.skipped) return "Already up to date - nothing changed.";
  return "Capture accepted.";
}

/**
 * 采集成功后的反馈分工：
 * - **badge 始终设置**（含手动）。通知可能被操作系统屏蔽，此时 badge 是唯一可见反馈；
 *   早期"手动只通知"的分工会让屏蔽通知的用户看到"点了毫无反应"。
 * - 通知仅手动触发时弹，自动采集保持静默不打扰（spec US-02.1）。
 *
 * badge 不会长期滞留：队列为空时 `flushQueue`（5 分钟 alarm / 保存配置）会清空它。
 */
export function successFeedback(
  actions: Partial<Record<IngestAction, number>> | undefined,
  trigger: "manual" | "auto",
): { badge: string; badgeColor: string; notify: boolean; message: string } {
  return {
    badge: actionText(actions),
    badgeColor: SUCCESS_BADGE_COLOR,
    notify: trigger === "manual",
    message: successMessage(actions),
  };
}
