import { useTranslation } from "../../../i18n";

export function AboutTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 p-6">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("settings.about.version")}</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.about.desc")}</p>
    </div>
  );
}
