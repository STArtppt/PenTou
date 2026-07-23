import { useState } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppContext } from "../../data";
import { useTranslation } from "../../i18n";
import { useIsMobile } from "../../hooks/useIsMobile";
import { BottomSheet } from "../BottomSheet";
import { SettingsNav, SETTINGS_TABS } from "./SettingsNav";
import type { SettingsTabId } from "./types";
import { GeneralTab } from "./tabs/GeneralTab";
import { LLMTab } from "./tabs/LLMTab";
import { EmbeddingTab } from "./tabs/EmbeddingTab";
import { IngestTab } from "./tabs/IngestTab";
import { MigrationTab } from "./tabs/MigrationTab";
import { ObsidianTab } from "./tabs/ObsidianTab";
import { AboutTab } from "./tabs/AboutTab";

// 移动端仅暴露四类配置（spec mobile-responsive US-06 AC2）：通用 / LLM / 语义检索 / 关于。
const MOBILE_SETTINGS_TAB_IDS: SettingsTabId[] = ["general", "llm", "search", "about"];

export function SettingsShell() {
  const {
    settingsOpen,
    setSettingsOpen,
    llmSettings,
    setLlmSettings,
    obsidianConfig,
    setObsidianConfig,
    theme,
    setTheme,
    language,
    setLanguage,
  } = useAppContext();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  // 移动端：底部抽屉 + 横向四类 Tab（超出四类的桌面态 activeTab 回落 general）。行为/持久化与桌面一致（AC3）。
  if (isMobile) {
    const mobileTab = MOBILE_SETTINGS_TAB_IDS.includes(activeTab) ? activeTab : "general";
    const mobileTabs = SETTINGS_TABS.filter((tab) => MOBILE_SETTINGS_TAB_IDS.includes(tab.id));
    return (
      <BottomSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t("settings.title")}>
        <div className="flex flex-col">
          <div className="sticky top-0 z-10 flex gap-1 border-b border-border bg-white px-3 pb-2 dark:bg-[#1A1A1A]">
            {mobileTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={mobileTab === tab.id ? "page" : undefined}
                className={clsx(
                  "min-h-11 flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors",
                  mobileTab === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {t(tab.labelKey as any)}
              </button>
            ))}
          </div>
          <div className="p-1">
            {mobileTab === "general" && (
              <GeneralTab theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} />
            )}
            {mobileTab === "llm" && <LLMTab settings={llmSettings} setSettings={setLlmSettings} />}
            {mobileTab === "search" && <EmbeddingTab />}
            {mobileTab === "about" && <AboutTab />}
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className="flex h-[min(720px,80vh)] max-h-[80vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogClose
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X size={18} />
            </DialogClose>
          </div>

          <div className="flex min-h-0 flex-1">
            <SettingsNav activeTab={activeTab} onChange={setActiveTab} />
            <ScrollArea className="min-w-0 flex-1">
              {activeTab === "general" && (
                <GeneralTab
                  theme={theme}
                  setTheme={setTheme}
                  language={language}
                  setLanguage={setLanguage}
                />
              )}
              {activeTab === "llm" && (
                <LLMTab settings={llmSettings} setSettings={setLlmSettings} />
              )}
              {activeTab === "search" && <EmbeddingTab />}
              {activeTab === "ingest" && <IngestTab />}
              {activeTab === "migration" && <MigrationTab />}
              {activeTab === "obsidian" && (
                <ObsidianTab config={obsidianConfig} onSave={setObsidianConfig} />
              )}
              {activeTab === "about" && <AboutTab />}
            </ScrollArea>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
