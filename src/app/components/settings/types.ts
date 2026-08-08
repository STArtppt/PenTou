import type { LucideIcon } from "lucide-react";

export type SettingsTabId =
  | "general"
  | "llm"
  | "search"
  | "ingest"
  | "migration"
  | "obsidian"
  | "about";

export type SettingsTabDef = {
  id: SettingsTabId;
  /** i18n key，如 settings.tab.general */
  labelKey: string;
  icon: LucideIcon;
};
