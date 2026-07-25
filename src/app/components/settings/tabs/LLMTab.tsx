import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsAddButton,
} from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { testLLMConnection } from "../../../llm";
import { useTranslation } from "../../../i18n";
import {
  type LLMSettings,
  type ProviderConfig,
  type ProviderKind,
  applyProviderSwitch,
  genProviderId,
  getPreset,
  providerToLLMConfig,
  tabTitleForProvider,
  BUILTIN_PROVIDERS,
} from "../../../llm-settings";
import { SettingsNote } from "../SettingsNote";

export function LLMTab({
  settings,
  setSettings,
}: {
  settings: LLMSettings;
  setSettings: (s: LLMSettings) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LLMSettings>(settings);
  const [selectedId, setSelectedId] = useState(settings.providers[0]?.id ?? "");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setSelectedId((id) =>
      settings.providers.some((p) => p.id === id) ? id : settings.providers[0]?.id ?? "",
    );
  }, [settings]);

  const selected = draft.providers.find((p) => p.id === selectedId) ?? draft.providers[0];
  const customFallback = t("settings.llm.providerCustom");

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of draft.providers) {
      map.set(p.id, tabTitleForProvider(p, draft.providers, { customFallback }));
    }
    return map;
  }, [draft.providers, customFallback]);

  const providerSelectLabel = (value: unknown): string => {
    if (value === "custom" || value == null) return customFallback;
    const id = String(value);
    try {
      return getPreset(id as Parameters<typeof getPreset>[0]).label;
    } catch {
      return id;
    }
  };

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setDraft((d) => ({
      ...d,
      providers: d.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    setTestState("idle");
  };

  const handleProviderKindChange = (id: string, next: ProviderKind) => {
    setDraft((d) => ({
      ...d,
      providers: d.providers.map((p) => {
        if (p.id !== id) return p;
        const switched = applyProviderSwitch(p, next);
        return { ...p, ...switched };
      }),
    }));
    setTestState("idle");
  };

  const handleAdd = () => {
    const blank: ProviderConfig = {
      id: genProviderId(),
      provider: "custom",
      customName: "",
      endpoint: "",
      apiKey: "",
      model: "",
    };
    setDraft((d) => ({ ...d, providers: [...d.providers, blank] }));
    setSelectedId(blank.id);
    setTestState("idle");
  };

  const confirmDelete = () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    setDraft((d) => {
      if (d.providers.length <= 1 || d.providers[0]?.id === id) return d;
      const providers = d.providers.filter((p) => p.id !== id);
      const nextSelected = selectedId === id ? providers[0].id : selectedId;
      setSelectedId(nextSelected);
      return {
        ...d,
        providers,
        activeProviderId:
          d.activeProviderId === id ? providers[0].id : d.activeProviderId,
      };
    });
    setTestState("idle");
  };

  const handleSetActive = (id: string) => {
    setDraft((d) => ({ ...d, activeProviderId: id }));
  };

  const handleSave = () => {
    setSettings(draft);
    setTestState("idle");
  };

  const handleTest = async () => {
    if (!selected) return;
    setTestState("testing");
    setTestError("");
    const cfg = providerToLLMConfig(selected, draft);
    const result = await testLLMConnection(cfg);
    if (result.ok) {
      setTestState("ok");
    } else {
      setTestState("fail");
      setTestError(result.error ?? String(result.status));
    }
  };

  if (!selected) return null;

  const isBuiltin = selected.provider !== "custom";
  const preset = isBuiltin ? getPreset(selected.provider) : null;
  const useModelSelect =
    isBuiltin && !selected.useCustomModel && (preset?.models.length ?? 0) > 0;

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 overflow-x-hidden p-6">
      <SettingsNote className="break-words">{t("settings.llm.securityNote")}</SettingsNote>

      {/*
        w-0 flex-1: classic flex scroll containment — parent width is capped by
        the dialog column; the tab list scrolls internally; + stays pinned.
        Horizontal overflow is owned here (overflow-hidden), independent of the
        outer ScrollArea which only drives vertical scroll.
      */}
      <div className="flex w-full min-w-0 items-center gap-1">
        <div className="w-0 min-w-0 flex-1 overflow-hidden">
          <Tabs
            value={selectedId}
            onValueChange={(v) => setSelectedId(String(v))}
            className="w-full min-w-0 max-w-full gap-0"
          >
            <TabsList variant="line" className="w-full min-w-0">
              {draft.providers.map((p, i) => (
                <TabsTrigger
                  key={p.id}
                  value={p.id}
                  closable={i > 0}
                  onClose={(val) => setDeleteTargetId(String(val))}
                  title={titles.get(p.id)}
                >
                  <span className="min-w-0 truncate">{titles.get(p.id) ?? p.id}</span>
                  {p.id === draft.activeProviderId ? (
                    <span className="shrink-0 rounded bg-primary/10 px-1 text-xs font-medium text-primary">
                      {t("settings.llm.activeBadge")}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <TabsAddButton
          className="shrink-0"
          onAdd={handleAdd}
          label={t("settings.llm.addProvider")}
        />
      </div>

      <div className="space-y-4 rounded-lg border border-border p-4">
        <Field label={t("settings.llm.provider")}>
          <Select
            value={selected.provider}
            onValueChange={(v) => {
              if (v != null) handleProviderKindChange(selected.id, v as ProviderKind);
            }}
          >
            <SelectTrigger>
              <SelectValue>{(value) => providerSelectLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BUILTIN_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">{customFallback}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {selected.provider === "custom" && (
          <Field label={t("settings.llm.customName")}>
            <Input
              value={selected.customName ?? ""}
              onChange={(e) => updateProvider(selected.id, { customName: e.target.value })}
              placeholder={t("settings.llm.customNamePlaceholder")}
            />
          </Field>
        )}

        <Field label={t("settings.llm.endpoint")}>
          <Input
            value={selected.endpoint}
            onChange={(e) => updateProvider(selected.id, { endpoint: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
          />
        </Field>

        <Field label={t("settings.llm.apiKey")}>
          <Input
            type="password"
            value={selected.apiKey}
            onChange={(e) => updateProvider(selected.id, { apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </Field>

        <Field label={t("settings.llm.model")}>
          {useModelSelect ? (
            <Select
              value={selected.model}
              onValueChange={(v) => {
                if (v != null) updateProvider(selected.id, { model: String(v) });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {preset!.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={selected.model}
              onChange={(e) => updateProvider(selected.id, { model: e.target.value })}
              placeholder={selected.provider === "volcengine" ? "ep-xxx" : "model-id"}
            />
          )}
        </Field>

        {isBuiltin && (preset?.models.length ?? 0) > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={!!selected.useCustomModel}
              onCheckedChange={(c) =>
                updateProvider(selected.id, { useCustomModel: c === true })
              }
            />
            {t("settings.llm.useCustomModel")}
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant={selected.id === draft.activeProviderId ? "secondary" : "outline"}
            size="sm"
            onClick={() => handleSetActive(selected.id)}
            disabled={selected.id === draft.activeProviderId}
          >
            {selected.id === draft.activeProviderId
              ? t("settings.llm.isActive")
              : t("settings.llm.setActive")}
          </Button>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-medium text-muted-foreground">
          {t("settings.llm.globalPrompts")}
        </p>
        <Field label={t("settings.llm.promptConvert")}>
          <Textarea
            className="font-mono text-xs leading-relaxed"
            rows={4}
            value={draft.systemPromptConvertConv}
            onChange={(e) =>
              setDraft((d) => ({ ...d, systemPromptConvertConv: e.target.value }))
            }
          />
        </Field>
        <Field label={t("settings.llm.promptRewrite")}>
          <Textarea
            className="font-mono text-xs leading-relaxed"
            rows={4}
            value={draft.systemPromptRewriteByAnnotations}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                systemPromptRewriteByAnnotations: e.target.value,
              }))
            }
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={testState === "testing" || !selected.apiKey}
        >
          {testState === "testing" && <Loader2 size={14} className="animate-spin" />}
          {testState === "ok" && <CheckCircle2 size={14} className="text-green-500" />}
          {testState === "fail" && <XCircle size={14} className="text-red-500" />}
          {testState === "testing"
            ? t("settings.llm.testing")
            : testState === "ok"
              ? t("settings.llm.testOk")
              : testState === "fail"
                ? t("settings.llm.testFail", { status: testError })
                : t("settings.llm.testConn")}
        </Button>
        <Button type="button" variant="primary" onClick={handleSave}>
          {t("settings.llm.save")}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        title={t("settings.llm.deleteTitle")}
        description={t("settings.llm.deleteDesc")}
        confirmLabel={t("settings.llm.deleteConfirm")}
        cancelLabel={t("rewrite.cancel")}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
