import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAppContext } from "../../../data";
import { useTranslation } from "../../../i18n";
import { Field } from "@/components/ui/field";
import { SettingsNote } from "../SettingsNote";

export function EmbeddingTab() {
  const { t } = useTranslation();
  const { embeddingConfig, refreshEmbeddingConfig, saveEmbeddingConfig } = useAppContext();
  const [endpoint, setEndpoint] = useState(embeddingConfig?.endpoint ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(embeddingConfig?.model ?? "text-embedding-3-small");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(!!embeddingConfig?.enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refreshEmbeddingConfig();
  }, [refreshEmbeddingConfig]);

  useEffect(() => {
    if (!embeddingConfig) return;
    setEnabled(embeddingConfig.enabled);
    if (embeddingConfig.endpoint) setEndpoint(embeddingConfig.endpoint);
    if (embeddingConfig.model) setModel(embeddingConfig.model);
  }, [embeddingConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveEmbeddingConfig({
        enabled,
        endpoint: endpoint.trim(),
        model: model.trim(),
        ...(apiKey ? { apiKey } : {}),
      });
      setApiKey("");
    } finally {
      setSaving(false);
    }
  };

  const phase = embeddingConfig?.phase ?? "disabled";
  const { done, total } = embeddingConfig?.embedding ?? { done: 0, total: 0 };
  const phaseLabel =
    phase === "partial"
      ? t("settings.embedding.phase.partial", { done, total })
      : t(`settings.embedding.phase.${phase}` as any);

  return (
    <div className="space-y-5 p-6">
      <SettingsNote>{t("settings.embedding.note")}</SettingsNote>

      <div className="flex items-start gap-3">
        <Switch id="embedding-enable" checked={enabled} onCheckedChange={setEnabled} className="mt-0.5" />
        <div className="space-y-0.5">
          <Label htmlFor="embedding-enable">
            {t("settings.embedding.enable")}
          </Label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("settings.embedding.enableHint")}</p>
        </div>
      </div>

      <Field label={t("settings.embedding.endpoint")}>
        <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
      </Field>
      <Field label={t("settings.embedding.model")}>
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="text-embedding-3-small" />
      </Field>
      <Field label={t("settings.embedding.apiKey")}>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={embeddingConfig?.hasKey ? "••••••••" : "sk-..."}
        />
        <span className="mt-1 block text-xs text-zinc-400 dark:text-zinc-500">{t("settings.embedding.apiKeyKeep")}</span>
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("settings.embedding.saving") : t("settings.embedding.save")}
        </Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("settings.embedding.status")}: {phaseLabel}
          {phase === "error" && embeddingConfig?.error ? ` — ${embeddingConfig.error}` : ""}
        </span>
      </div>
    </div>
  );
}
