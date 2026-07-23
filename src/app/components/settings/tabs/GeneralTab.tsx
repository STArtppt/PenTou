import { Button } from "@/components/ui/button";
import { useTranslation } from "../../../i18n";
import { Field } from "../Field";

export function GeneralTab({
  theme,
  setTheme,
  language,
  setLanguage,
}: {
  theme: "light" | "dark";
  setTheme: (v: "light" | "dark") => void;
  language: "en" | "zh";
  setLanguage: (v: "en" | "zh") => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 p-6">
      <Field label={t("settings.general.theme")}>
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={theme === v ? "segment-active" : "segment"}
              className="capitalize"
              onClick={() => setTheme(v)}
            >
              {v === "light" ? t("settings.general.themeLight") : t("settings.general.themeDark")}
            </Button>
          ))}
        </div>
      </Field>
      <Field label={t("settings.general.language")}>
        <div className="flex gap-2">
          {(["en", "zh"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={language === v ? "segment-active" : "segment"}
              onClick={() => setLanguage(v)}
            >
              {v === "en" ? t("settings.general.langEn") : t("settings.general.langZh")}
            </Button>
          ))}
        </div>
      </Field>
    </div>
  );
}
