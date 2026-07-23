import { useEffect, useState } from "react";

/**
 * 移动断点判定（spec mobile-responsive §4.1 决策 3）：唯一分界 md=768px，
 * `< md`（max-width:767px）走移动布局。仅用于**结构性**渲染分支（FAB vs 右侧栏、
 * 侧栏抽屉 vs 常驻、禁用 DnD 等）；纯样式差异优先用 Tailwind `md:` 响应式类。
 *
 * SSR 安全：无 window / matchMedia 时回落 false（桌面）。集中一处封装，避免散落多份
 * matchMedia 监听（vite-react-best-practices）。
 */
const MOBILE_QUERY = "(max-width: 767px)";

function getMatch(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange(); // 同步一次，覆盖挂载前的断点变化
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
