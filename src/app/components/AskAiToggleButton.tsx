import { createPortal } from "react-dom";
import clsx from "clsx";
import { IconTooltip } from "@/components/IconTooltip";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import type { AiSidebarSide } from "../ai-sidebar-prefs";
import aiSpaceIconUrl from "../../../assets/icons/icon-AIspace.svg";

/**
 * 收起态「问问 AI」悬浮按钮（桌面随停靠边左下/右下；移动端右下）。
 *
 * - portal 到 body：避免作为根 flex 子项被挤没
 * - z-[60]：高于导航 Sidebar 的 z-50
 * - 左右统一 bottom；悬停用 startist Tooltip（IconTooltip），不用 native title
 */
export function AskAiFab({
  side,
  className,
}: {
  side: AiSidebarSide;
  className?: string;
}) {
  const { setAiSidebarOpen } = useAppContext();
  const { t } = useTranslation();
  const label = t("toolbar.askAi");

  if (typeof document === "undefined") return null;

  return createPortal(
    <IconTooltip
      label={label}
      // 贴边 FAB：左下开向右、右下开向左，避免 top 被挤出视口
      side={side === "left" ? "right" : "left"}
      className={clsx(
        // 定位落在 tooltip 锚点上，保证 hover 区域与悬浮位置一致
        "fixed z-[60] size-14 bottom-[calc(1rem+env(safe-area-inset-bottom)+4rem)]",
        side === "left" ? "left-4" : "right-4",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setAiSidebarOpen(true)}
        aria-label={label}
        className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 ring-1 ring-black/10 transition-transform active:scale-95 dark:bg-card dark:text-card-foreground dark:ring-white/20"
      >
        {/* 单色黑稿：mask + currentColor，随按钮前景色反色（深色主题不再 invert 成白底白字） */}
        <span
          aria-hidden
          className="size-7 shrink-0 bg-current"
          style={{
            // 双引号必需：Vite 内联的 data URI 含单引号，裸 url() 会成为非法 CSS 被丢弃
            WebkitMaskImage: `url("${aiSpaceIconUrl}")`,
            maskImage: `url("${aiSpaceIconUrl}")`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      </button>
    </IconTooltip>,
    document.body,
  );
}
