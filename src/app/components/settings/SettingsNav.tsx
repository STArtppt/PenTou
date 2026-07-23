import {
  Settings2,
  Bot,
  Search,
  Radio,
  ArrowLeftRight,
  BookOpen,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-zinc-200 bg-muted/30 p-2 dark:border-white/10" aria-label={t("settings.title")}>
      {SETTINGS_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <Button
            key={tab.id}
            type="button"
            size="nav"
            variant={active ? "nav-active" : "ghost"}
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={16} />
            <span className="truncate">{t(tab.labelKey as any)}</span>
          </Button>
        );
      })}
    </nav>
  );
}
