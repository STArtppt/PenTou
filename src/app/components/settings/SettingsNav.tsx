import {
  Settings2,
  Bot,
  Search,
  Radio,
  ArrowLeftRight,
  BookOpen,
  Info,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "../../i18n";
import type { SettingsTabDef, SettingsTabId } from "./types";

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: "general", labelKey: "settings.tab.general", icon: Settings2 },
  { id: "llm", labelKey: "settings.tab.llm", icon: Bot },
  { id: "search", labelKey: "settings.tab.search", icon: Search },
  { id: "ingest", labelKey: "settings.tab.ingest", icon: Radio },
  { id: "migration", labelKey: "settings.tab.migration", icon: ArrowLeftRight },
  { id: "obsidian", labelKey: "settings.tab.obsidian", icon: BookOpen },
  { id: "about", labelKey: "settings.tab.about", icon: Info },
];

export function SettingsNav({
  activeTab,
  onChange,
}: {
  activeTab: SettingsTabId;
  onChange: (id: SettingsTabId) => void;
}) {
  const { t } = useTranslation();

  return (
    <nav
      className="flex w-48 shrink-0 flex-col overflow-y-auto"
      aria-label={t("settings.title")}
    >
      <Tabs
        value={activeTab}
        onValueChange={(v) => onChange(v as SettingsTabId)}
        orientation="vertical"
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList variant="vertical" className="h-full w-full rounded-none border-r border-border">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                icon={<Icon size={16} />}
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                {t(tab.labelKey as any)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </nav>
  );
}
