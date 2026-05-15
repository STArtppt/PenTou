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

function AppContent() {
  const { theme, isDrawerOpen, settingsOpen } = useAppContext();
  const [drawerEverOpened, setDrawerEverOpened] = useState(false);
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);

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

          .rightnav-scrollbar::-webkit-scrollbar {
            width: 9px;
            height: 9px;
          }
          .rightnav-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .rightnav-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.15);
            border-radius: 20px;
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 15px solid transparent;
            border-bottom: 15px solid transparent;
            background-clip: padding-box;
          }
          .dark .rightnav-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.05);
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 15px solid transparent;
            border-bottom: 15px solid transparent;
            background-clip: padding-box;
          }
          .rightnav-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(161, 161, 170, 0.25);
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 15px solid transparent;
            border-bottom: 15px solid transparent;
            background-clip: padding-box;
          }
          .dark .rightnav-scrollbar:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.1);
            border-right: 2px solid transparent;
            border-left: 2px solid transparent;
            border-top: 15px solid transparent;
            border-bottom: 15px solid transparent;
            background-clip: padding-box;
          }
        `}} />
        <Sidebar />
        <MainContent />
        <Suspense fallback={null}>
          {drawerEverOpened && <ImportDrawer />}
          {settingsEverOpened && <SettingsModal />}
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
