import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";

export function AboutTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { version?: unknown } | null) => {
        if (cancelled) return;
        const v = body?.version;
        if (typeof v === "string" && v.trim()) setVersion(v.trim());
        else setVersion("0.0.0-dev");
      })
      .catch(() => {
        if (!cancelled) setVersion("0.0.0-dev");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3 p-6">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {version
          ? t("settings.about.version", { version })
          : t("settings.about.versionLoading")}
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.about.desc")}</p>
    </div>
  );
}
