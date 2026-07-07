import React, { lazy, Suspense, useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Sidebar } from "./components/Sidebar";
import { MainContent } from "./components/MainContent";
import { AppProvider, useAppContext } from "./data";
import { Toaster } from "sonner";

const ImportDrawer = lazy(() =>
  import("./components/ImportDrawer").then(m => ({ default: m.ImportDrawer }))
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then(m => ({ default: m.SettingsModal }))
);
const SearchPalette = lazy(() =>
  import("./components/SearchPalette").then(m => ({ default: m.SearchPalette }))
);
const AiSidebar = lazy(() =>
  import("./components/AiSidebar").then(m => ({ default: m.AiSidebar }))
);

function AppContent() {
  const { theme, isDrawerOpen, settingsOpen, searchOpen, setSearchOpen, aiSidebarOpen, toggleAiSidebar } = useAppContext();
  const [drawerEverOpened, setDrawerEverOpened] = useState(false);
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
  const [searchEverOpened, setSearchEverOpened] = useState(false);
  const [aiSidebarEverOpened, setAiSidebarEverOpened] = useState(false);

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
      <div className="flex h-screen w-full bg-white dark:bg-[#1A1A1A] text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans selection:bg-orange-200 selection:text-zinc-900 dark:selection:bg-yellow-500/30 dark:selection:text-yellow-100 transition-colors duration-200">
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
          {drawerEverOpened && <ImportDrawer />}
          {settingsEverOpened && <SettingsModal />}
          {searchEverOpened && <SearchPalette />}
          {aiSidebarEverOpened && <AiSidebar />}
        </Suspense>
        <Toaster position="bottom-right" richColors />
      </div>
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
