import React, { lazy, Suspense, useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Sidebar } from "./components/Sidebar";
import { MainContent } from "./components/MainContent";
import { AppProvider, useAppContext } from "./data";
import { useIsMobile } from "./hooks/useIsMobile";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const ImportDrawer = lazy(() =>
  import("./components/ImportDrawer").then(m => ({ default: m.ImportDrawer }))
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then(m => ({ default: m.SettingsModal }))
);
const SearchPalette = lazy(() =>
  import("./components/SearchPalette").then(m => ({ default: m.SearchPalette }))
);
const RewriteConfirmDialog = lazy(() =>
  import("./components/RewriteConfirmDialog").then(m => ({ default: m.RewriteConfirmDialog }))
);
const AiSidebar = lazy(() =>
  import("./components/AiSidebar").then(m => ({ default: m.AiSidebar }))
);

function AppContent() {
  const {
    theme,
    isDrawerOpen,
    settingsOpen,
    searchOpen,
    setSearchOpen,
    aiSidebarOpen,
    toggleAiSidebar,
    setDrawerOpen,
    setSettingsOpen,
    setAiSidebarOpen,
    setMobileNavOpen,
    rewriteDialogOpen,
    setRewriteDialogOpen,
    documents,
    activeDocId,
    annotationsByDoc,
  } = useAppContext();
  const activeDoc = documents.find((doc) => doc.id === activeDocId) ?? null;
  const isMobile = useIsMobile();
  const [drawerEverOpened, setDrawerEverOpened] = useState(false);
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
  const [searchEverOpened, setSearchEverOpened] = useState(false);
  const [aiSidebarEverOpened, setAiSidebarEverOpened] = useState(false);
  // 首开动画修复（通用/B 方案）：空闲后以「关闭态」预挂四个懒加载面板，
  // 使首次打开有过渡起始帧（否则组件首挂载即打开态 → 闪现）。
  // 见 src/docs/debugging/2026-07-21-drawer-first-open-no-slide.md
  const [primed, setPrimed] = useState(false);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    if (isDrawerOpen) setDrawerEverOpened(true);
  }, [isDrawerOpen]);

  useEffect(() => {
    if (settingsOpen) setSettingsEverOpened(true);
  }, [settingsOpen]);

  useEffect(() => {
    if (searchOpen) setSearchEverOpened(true);
  }, [searchOpen]);

  useEffect(() => {
    if (aiSidebarOpen) setAiSidebarEverOpened(true);
  }, [aiSidebarOpen]);

  // 断点临界映射（spec mobile-responsive §5 M5）：跨越 768px 时收起所有覆盖层，回到 Reading。
  // `>= md → < md`：关闭桌面右侧栏（Ask AI 仅以 FAB 呈现，不自动展开）+ 导入/设置/搜索。
  // `< md → >= md`：关闭 NavDrawer / 各底部抽屉 / 搜索，恢复桌面三栏。两向都归零，语义一致。
  useEffect(() => {
    setAiSidebarOpen(false);
    setDrawerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMobileNavOpen(false);
  }, [isMobile, setAiSidebarOpen, setDrawerOpen, setSettingsOpen, setSearchOpen, setMobileNavOpen]);

  useEffect(() => {
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    });
    if (ric.requestIdleCallback) {
      const id = ric.requestIdleCallback(() => setPrimed(true), { timeout: 2000 });
      return () => ric.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setPrimed(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  // 全局快捷键 Cmd/Ctrl+K 唤起搜索浮层（spec hybrid-search US-01 AC1）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        toggleAiSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen, toggleAiSidebar]);

  return (
    <DndProvider backend={HTML5Backend}>
      <TooltipProvider delay={300}>
      <div className="flex h-dvh w-full bg-white dark:bg-[#1A1A1A] text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans selection:bg-foreground/25 selection:text-foreground transition-colors duration-200">
        <style dangerouslySetInnerHTML={{ __html: `
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.3);
            border-radius: 20px;
          }
          .dark .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.1);
          }
          .custom-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.5);
          }
          .dark .custom-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.2);
          }

          .subtle-scrollbar::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          .subtle-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .subtle-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0);
            border-radius: 999px;
            border-left: 2px solid transparent;
            border-right: 2px solid transparent;
            background-clip: padding-box;
            transition:
              background-color 220ms ease,
              border-left-width 220ms ease,
              opacity 220ms ease;
            opacity: 0;
          }
          .dark .subtle-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0);
          }
          .subtle-scrollbar.subtle-scrollbar-active::-webkit-scrollbar-thumb,
          .subtle-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.34);
            opacity: 1;
          }
          .dark .subtle-scrollbar.subtle-scrollbar-active::-webkit-scrollbar-thumb,
          .dark .subtle-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.18);
            opacity: 1;
          }
          .subtle-scrollbar:hover::-webkit-scrollbar-thumb {
            border-left-width: 0;
          }
          .subtle-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
          }
          .subtle-scrollbar.subtle-scrollbar-active,
          .subtle-scrollbar:hover {
            scrollbar-color: rgba(161, 161, 170, 0.34) transparent;
          }
          .dark .subtle-scrollbar.subtle-scrollbar-active,
          .dark .subtle-scrollbar:hover {
            scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
          }

          /* 搜索结果跳转后的临时高亮（spec hybrid-search US-03） */
          .search-hit-flash {
            animation: searchHitFlash 2.2s ease-out;
            border-radius: 8px;
          }
          @keyframes searchHitFlash {
            0%, 18% { background-color: rgba(250, 204, 21, 0.28); box-shadow: 0 0 0 6px rgba(250, 204, 21, 0.12); }
            100% { background-color: transparent; box-shadow: 0 0 0 6px transparent; }
          }

          .rightnav-scrollbar::-webkit-scrollbar {
            width: 9px;
            height: 9px;
          }
          .rightnav-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .rightnav-scrollbar::-webkit-scrollbar-thumb {
            background-color: transparent;
            border-radius: 20px;
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            background-clip: padding-box;
            transition: background-color 180ms ease;
          }
          .dark .rightnav-scrollbar::-webkit-scrollbar-thumb {
            background-color: transparent;
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            background-clip: padding-box;
          }
          .rightnav-scrollbar.toc-scrollbar-active::-webkit-scrollbar-thumb,
          .rightnav-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.25);
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            background-clip: padding-box;
          }
          .dark .rightnav-scrollbar.toc-scrollbar-active::-webkit-scrollbar-thumb,
          .dark .rightnav-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.1);
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            background-clip: padding-box;
          }
          .rightnav-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
          }
          .rightnav-scrollbar.toc-scrollbar-active,
          .rightnav-scrollbar:hover {
            scrollbar-color: rgba(161, 161, 170, 0.25) transparent;
          }
          .dark .rightnav-scrollbar.toc-scrollbar-active,
          .dark .rightnav-scrollbar:hover {
            scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
          }
        `}} />
        <Sidebar />
        <MainContent />
        <Suspense fallback={null}>
          {(primed || drawerEverOpened) && <ImportDrawer />}
          {(primed || settingsEverOpened) && <SettingsModal />}
          {(primed || searchEverOpened) && <SearchPalette />}
          {(primed || aiSidebarEverOpened) && <AiSidebar />}
          {/* 批注重写的确认框在应用层渲染，由 AI 侧栏的 chip 拉起（spec ai-intent-chips） */}
          {rewriteDialogOpen && activeDoc && (
            <RewriteConfirmDialog
              doc={activeDoc}
              annotations={(annotationsByDoc[activeDoc.id] ?? []).filter((a) => a.comment)}
              onClose={() => setRewriteDialogOpen(false)}
              onSuccess={() => setRewriteDialogOpen(false)}
            />
          )}
        </Suspense>
        {/* 统一 top-center（startist 默认）：顶部居中天然避开右下 Ask AI FAB（spec §5 I4） */}
        <Toaster position="top-center" />
      </div>
      </TooltipProvider>
    </DndProvider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
