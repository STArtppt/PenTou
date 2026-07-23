import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ObsidianConfig } from "../../../data";
import { useTranslation } from "../../../i18n";
import { Field } from "../Field";

const MANUAL_VAULT = "__manual__";
const EMPTY_VALUE = "__empty__";

export function ObsidianTab({
  config,
  onSave,
}: {
  config: ObsidianConfig;
  onSave: (cfg: ObsidianConfig) => void;
}) {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState<{ name: string; path: string }[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);
  const [selected, setSelected] = useState<string>(config.vaultPath || EMPTY_VALUE);
  const [manualPath, setManualPath] = useState(config.vaultPath ?? "");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchVaults = async (notify = false) => {
    setLoadingVaults(true);
    try {
      const res = await fetch("/api/obsidian/vaults");
      const data = await res.json();
      const list: { name: string; path: string }[] = Array.isArray(data?.vaults) ? data.vaults : [];
      setVaults(list);
      if (config.vaultPath && !list.some((v) => v.path === config.vaultPath)) {
        setSelected(MANUAL_VAULT);
      }
      if (notify) toast.success(t("settings.obsidian.refreshed", { n: list.length }));
    } catch {
      setVaults([]);
      if (notify) toast.error(t("settings.obsidian.refreshFailed"));
    } finally {
      setLoadingVaults(false);
    }
  };

  useEffect(() => {
    fetchVaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const basename = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p;

  const handleSave = async () => {
    setFeedback(null);
    if (selected && selected !== MANUAL_VAULT && selected !== EMPTY_VALUE) {
      const vault = vaults.find((v) => v.path === selected);
      if (!vault) return;
      onSave({ vaultName: vault.name, vaultPath: vault.path });
      setFeedback({ kind: "ok", text: t("settings.obsidian.saved") });
      return;
    }
    const path = manualPath.trim();
    if (!path) return;
    setSaving(true);
    try {
      const res = await fetch("/api/obsidian/validate-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          kind: "error",
          text: t("settings.obsidian.invalidPath", { error: String(data?.error ?? `HTTP ${res.status}`) }),
        });
        return;
      }
      onSave({ vaultName: basename(path), vaultPath: path });
      setFeedback(
        data?.isVault
          ? { kind: "ok", text: t("settings.obsidian.saved") }
          : { kind: "warn", text: t("settings.obsidian.notVaultWarning") },
      );
    } catch (e) {
      setFeedback({ kind: "error", text: t("settings.obsidian.invalidPath", { error: String(e) }) });
    } finally {
      setSaving(false);
    }
  };

  const placeholder = loadingVaults
    ? t("settings.obsidian.detecting")
    : vaults.length === 0
      ? t("settings.obsidian.noneDetected")
      : t("settings.obsidian.selectVault");

  const canSave =
    !saving &&
    ((selected !== EMPTY_VALUE && selected !== MANUAL_VAULT) ||
      (selected === MANUAL_VAULT && !!manualPath.trim()));

  return (
    <div className="space-y-5 p-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.obsidian.hint")}</p>
      <Field label={t("settings.obsidian.vault")}>
        <div className="flex items-center gap-2">
          <Select
            value={selected}
            onValueChange={(v) => {
              setSelected(v);
              setFeedback(null);
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {selected === EMPTY_VALUE && (
                <SelectItem value={EMPTY_VALUE} disabled>
                  {placeholder}
                </SelectItem>
              )}
              {vaults.map((v) => (
                <SelectItem key={v.path} value={v.path}>
                  {v.name} — {v.path}
                </SelectItem>
              ))}
              <SelectItem value={MANUAL_VAULT}>{t("settings.obsidian.manualEntry")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fetchVaults(true)}
            disabled={loadingVaults}
            title={t("settings.obsidian.refresh")}
            aria-label={t("settings.obsidian.refresh")}
          >
            <RefreshCw size={16} className={loadingVaults ? "animate-spin" : undefined} />
          </Button>
        </div>
      </Field>
      {selected === MANUAL_VAULT && (
        <Field label={t("settings.obsidian.vaultPath")}>
          <Input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="/Users/me/My Vault"
          />
        </Field>
      )}
      {feedback && (
        <p
          className={
            feedback.kind === "ok"
              ? "text-xs text-green-600 dark:text-green-400"
              : feedback.kind === "warn"
                ? "text-xs text-amber-600 dark:text-amber-400"
                : "text-xs text-red-600 dark:text-red-400"
          }
        >
          {feedback.text}
        </p>
      )}
      <Button type="button" variant="brand" onClick={handleSave} disabled={!canSave}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("settings.obsidian.save")}
      </Button>
    </div>
  );
}
