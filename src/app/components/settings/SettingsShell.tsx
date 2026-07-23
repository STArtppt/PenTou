import { useState } from "react";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppContext } from "../../data";
import { useTranslation } from "../../i18n";
import { SettingsNav } from "./SettingsNav";
import type { SettingsTabId } from "./types";
import { GeneralTab } from "./tabs/GeneralTab";
import { LLMTab } from "./tabs/LLMTab";
import { EmbeddingTab } from "./tabs/EmbeddingTab";
import { IngestTab } from "./tabs/IngestTab";
import { MigrationTab } from "./tabs/MigrationTab";
import { ObsidianTab } from "./tabs/ObsidianTab";
import { AboutTab } from "./tabs/AboutTab";

export function SettingsShell() {
  const {
    settingsOpen,
    setSettingsOpen,
    llmConfig,
    setLlmConfig,
    obsidianConfig,
    setObsidianConfig,
    theme,
    setTheme,
    language,
    setLanguage,
  } = useAppContext();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent
        className="flex h-[min(720px,80vh)] max-h-[80vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-white/10">
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogCloseButton />
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
            {activeTab === "llm" && <LLMTab config={llmConfig} setConfig={setLlmConfig} />}
            {activeTab === "search" && <EmbeddingTab />}
            {activeTab === "ingest" && <IngestTab />}
            {activeTab === "migration" && <MigrationTab />}
            {activeTab === "obsidian" && (
              <ObsidianTab config={obsidianConfig} onSave={setObsidianConfig} />
            )}
            {activeTab === "about" && <AboutTab />}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
