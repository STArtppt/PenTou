import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "motion/react";
import { X } from "lucide-react";
import clsx from "clsx";
import { useVisualViewport } from "../hooks/useVisualViewport";

/**
 * 移动端共享底部抽屉（spec mobile-responsive §4.1 / US-04,06）。承载设置 / 导入两处下抽屉，统一：
 * - 点遮罩 / 关闭按钮 / **下滑关闭**（拖拽仅从顶部抓手触发，避免与内容滚动冲突）
 * - 底部避让 `env(safe-area-inset-bottom)`；`md:hidden` 兜底（桌面永不出现）
 * - **软键盘避让**（调整批次 issue 1）：外层容器由 useVisualViewport 贴合“可见视口”，抽屉 `justify-end` 贴容器底、
 *   高度取容器减顶部约一个状态栏（46px）→ 键盘弹出时底边升到键盘之上、标题栏顶端不动，仅内容区被压缩上顶。
 *
 * 只在 `open` 时挂载内容；调用方仅在移动端打开（App 断点映射会在跨越 768px 时收起，见 §5 M5）。
 * （Ask AI 移动端已改为全屏面板，不再走本组件，见 AiSidebar。）
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  bodyClassName?: string;
}) {
  const dragControls = useDragControls();
  const viewport = useVisualViewport(open);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-x-0 z-[60] flex flex-col justify-end md:hidden"
          style={viewport ? { top: viewport.top, height: viewport.height } : { top: 0, bottom: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            /* 固定高度：占满“可见视口容器”减去顶部一个状态栏的留白（US 调整批次 issue 1）。
               容器高度由 visualViewport 驱动，故键盘弹出时本抽屉自动收缩至键盘之上，顶部不动。
               Ask AI / 导入 / 设置 三处共享此高度，内容不足时底部留白，超出时内部滚动。 */
            className="relative flex h-[calc(100%-46px)] flex-col overflow-hidden rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1A1A1A]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 340 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          >
            {/* 抓手 + 可选标题栏：唯一的拖拽起点（下滑关闭） */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
            >
              <div className="flex justify-center pb-1 pt-2.5">
                <div className="h-1 w-9 rounded-full bg-zinc-300 dark:bg-white/20" />
              </div>
              {title && (
                <div className="flex items-center justify-between px-4 pb-2 pt-1">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="flex size-11 items-center justify-center -mr-2 rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                  >
                    <X size={20} />
                  </button>
                </div>
              )}
            </div>

            <div
              className={clsx(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar pb-[env(safe-area-inset-bottom)]",
                bodyClassName,
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
