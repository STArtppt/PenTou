import { useEffect, useState } from "react";

/**
 * 追踪 visualViewport 的可见区域（`top` = offsetTop，`height` = 可见高度，`keyboard` = 软键盘遮挡高度）。
 * 供底部抽屉 / 全屏面板贴合软键盘。两种消费方式：
 * - BottomSheet（底部抽屉）用 top+height 让容器贴合可见视口；
 * - AiSidebar 全屏面板用 `keyboard`：容器保持 `fixed inset-0` 不动（iOS Safari 上移动容器会与系统滚动打架、
 *   出现闪烁/露底），只给内容列加 `paddingBottom=keyboard` 把 footer 输入框抬到键盘之上。
 *
 * `active=false` 或环境不支持（无 window / visualViewport）时返回 null，调用方回退到 CSS。
 */
export function useVisualViewport(active: boolean): { top: number; height: number; keyboard: number } | null {
  const [rect, setRect] = useState<{ top: number; height: number; keyboard: number } | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined" || !window.visualViewport) {
      setRect(null);
      return;
    }
    const vv = window.visualViewport;
    const update = () =>
      setRect({
        top: vv.offsetTop,
        height: vv.height,
        // 键盘遮挡 = 布局视口高度 − 可见视口底边（offsetTop+height）。iOS/Android 一致。
        keyboard: Math.max(0, window.innerHeight - vv.offsetTop - vv.height),
      });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return rect;
}
