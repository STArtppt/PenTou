import React, { useState, useEffect } from "react";
import { X, Loader2, CheckCircle2, XCircle, UploadCloud, DownloadCloud, ShieldAlert, RefreshCw, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { useAppContext, LLMConfig, type ObsidianConfig } from "../data";
import { testLLMConnection } from "../llm";
import { useTranslation } from "../i18n";

type Tab = "general" | "llm" | "search" | "ingest" | "migration" | "obsidian" | "about";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, llmConfig, setLlmConfig, obsidianConfig, setObsidianConfig, theme, setTheme, language, setLanguage } = useAppContext();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("general");

  return (
    <AnimatePresence>
      {settingsOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-x-4 top-[10%] bottom-[10%] max-w-2xl mx-auto z-50 bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-white/10">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("settings.title")}</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="shrink-0 flex border-b border-zinc-200 dark:border-white/10 px-6 overflow-x-auto">
              {(["general", "llm", "search", "ingest", "migration", "obsidian", "about"] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={clsx(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
                    activeTab === tab
                      ? "border-orange-500 dark:border-yellow-400 text-orange-500 dark:text-yellow-400"
                      : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  {t(`settings.tab.${tab}` as any)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {activeTab === "general" && (
                <GeneralTab theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} t={t} />
              )}
              {activeTab === "llm" && (
                <LLMTab config={llmConfig} setConfig={setLlmConfig} t={t} />
              )}
              {activeTab === "search" && <EmbeddingTab t={t} />}
              {activeTab === "ingest" && <IngestTab t={t} />}
              {activeTab === "migration" && <MigrationTab t={t} />}
              {activeTab === "obsidian" && (
                <ObsidianTab config={obsidianConfig} onSave={setObsidianConfig} t={t} />
              )}
              {activeTab === "about" && <AboutTab t={t} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

type MigrationDirection = "push" | "pull";
type MigrationPlan = {
  adds: string[];
  conflicts: Array<{
    path: string;
    sourceMtime: number;
    targetMtime: number;
    sourceSize: number;
    targetSize: number;
  }>;
  skips: number;
  targetOnly: number;
  warning?: string | null;
};
type MigrationRunResult = {
  ok: boolean;
  transferred: number;
  total: number;
  skipped: number;
  failures: Array<{ path: string; reason: string }>;
  durationMs: number;
  message?: string;
};

function MigrationTab({ t }: { t: any }) {
  const [direction, setDirection] = useState<MigrationDirection>("push");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [password, setPassword] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [state, setState] = useState<"idle" | "testing" | "planning" | "running">("idle");
  const [error, setError] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [overwriteConflicts, setOverwriteConflicts] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<MigrationRunResult | null>(null);

  const payload = () => ({
    remoteUrl: remoteUrl.trim(),
    password,
    direction,
    allowInsecure,
  });

  const callMigrationApi = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? String(res.status));
    return data;
  };

  const resetPreview = () => {
    setPlan(null);
    setOverwriteConflicts(new Set());
    setResult(null);
    setTestMessage("");
  };

  const handleTest = async () => {
    setState("testing");
    setError("");
    setTestMessage("");
    setResult(null);
    try {
      const data = await callMigrationApi("/api/migrate/test", payload());
      if (!data.ok) throw new Error(data.warning ?? data.error ?? "Connection failed");
      setTestMessage(t("settings.migration.testOk", { count: data.remote?.entries ?? 0 }));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setState("idle");
    }
  };

  const handlePlan = async () => {
    setState("planning");
    setError("");
    setResult(null);
    try {
      const data = await callMigrationApi("/api/migrate/plan", payload()) as MigrationPlan;
      setPlan(data);
      setOverwriteConflicts(new Set());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setState("idle");
    }
  };

  const handleRun = async () => {
    if (!plan) return;
    setState("running");
    setError("");
    setResult(null);
    try {
      const conflicts = plan.conflicts.map((item) => ({
        path: item.path,
        resolution: overwriteConflicts.has(item.path) ? "overwrite" : "skip",
      }));
      const data = await callMigrationApi("/api/migrate/run", { ...payload(), conflicts }) as MigrationRunResult;
      setResult(data);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setState("idle");
    }
  };

  const toggleAllConflicts = (overwrite: boolean) => {
    setOverwriteConflicts(overwrite ? new Set(plan?.conflicts.map((item) => item.path) ?? []) : new Set());
  };

  const busy = state !== "idle";
  const transferCount = plan ? plan.adds.length + overwriteConflicts.size : 0;

  return (
    <div className="p-6 space-y-5">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg p-3 leading-relaxed">
        {t("settings.migration.note")}
      </div>

      <FieldRow label={t("settings.migration.direction")}>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setDirection("push"); resetPreview(); }}
            className={clsx(segmentButtonCls, direction === "push" && activeSegmentCls)}
          >
            <UploadCloud size={16} />
            <span>{t("settings.migration.push")}</span>
          </button>
          <button
            onClick={() => { setDirection("pull"); resetPreview(); }}
            className={clsx(segmentButtonCls, direction === "pull" && activeSegmentCls)}
          >
            <DownloadCloud size={16} />
            <span>{t("settings.migration.pull")}</span>
          </button>
        </div>
      </FieldRow>

      <FieldRow label={t("settings.migration.remoteUrl")}>
        <input className={inputCls} value={remoteUrl} onChange={(e) => { setRemoteUrl(e.target.value); resetPreview(); }} placeholder="https://pentou.example.com" />
      </FieldRow>
      <FieldRow label={t("settings.migration.password")}>
        <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("settings.migration.passwordPlaceholder")} />
      </FieldRow>

      {remoteUrl.trim().startsWith("http://") && (
        <label className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <input
            type="checkbox"
            checked={allowInsecure}
            onChange={(e) => setAllowInsecure(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-amber-500"
          />
          <span className="flex gap-2">
            <ShieldAlert size={15} className="shrink-0" />
            {t("settings.migration.insecure")}
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleTest} disabled={busy || !remoteUrl.trim()} className={secondaryButtonCls}>
          {state === "testing" && <Loader2 size={14} className="animate-spin" />}
          {t("settings.migration.test")}
        </button>
        <button onClick={handlePlan} disabled={busy || !remoteUrl.trim()} className={primaryButtonCls}>
          {state === "planning" && <Loader2 size={14} className="animate-spin" />}
          {t("settings.migration.preview")}
        </button>
        {testMessage && <span className="text-xs text-green-600 dark:text-green-400">{testMessage}</span>}
      </div>

      {error && <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-400/10 border border-red-200 dark:border-red-400/30 rounded-lg p-3">{error}</div>}

      {plan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label={t("settings.migration.adds")} value={plan.adds.length} />
            <Metric label={t("settings.migration.conflicts")} value={plan.conflicts.length} />
            <Metric label={t("settings.migration.skips")} value={plan.skips} />
            <Metric label={t("settings.migration.targetOnly")} value={plan.targetOnly} />
          </div>

          {plan.adds.length === 0 && plan.conflicts.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-white/10 p-3 text-sm text-zinc-600 dark:text-zinc-300">
              {t("settings.migration.noDiff")}
            </div>
          ) : (
            <>
              {plan.conflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t("settings.migration.conflictPolicy")}</span>
                    <div className="flex gap-2">
                      <button onClick={() => toggleAllConflicts(true)} className={tinyButtonCls}>{t("settings.migration.overwriteAll")}</button>
                      <button onClick={() => toggleAllConflicts(false)} className={tinyButtonCls}>{t("settings.migration.skipAll")}</button>
                    </div>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-200 dark:border-white/10 divide-y divide-zinc-200 dark:divide-white/10">
                    {plan.conflicts.slice(0, 80).map((item) => (
                      <label key={item.path} className="flex items-center gap-3 px-3 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={overwriteConflicts.has(item.path)}
                          onChange={(e) => {
                            setOverwriteConflicts((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(item.path);
                              else next.delete(item.path);
                              return next;
                            });
                          }}
                          className="h-4 w-4 accent-orange-500 dark:accent-yellow-400"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-zinc-700 dark:text-zinc-300">{item.path}</span>
                        <span className="shrink-0 text-zinc-400">{formatBytes(item.sourceSize)} / {formatBytes(item.targetSize)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {plan.adds.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t("settings.migration.newFiles")}</span>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-zinc-200 dark:border-white/10 divide-y divide-zinc-200 dark:divide-white/10">
                    {plan.adds.slice(0, 80).map((item) => (
                      <div key={item} className="truncate px-3 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">{item}</div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={handleRun} disabled={busy || transferCount === 0} className={primaryButtonCls}>
                {state === "running" && <Loader2 size={14} className="animate-spin" />}
                {t("settings.migration.run", { count: transferCount })}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className={clsx("rounded-lg border p-3 text-sm", result.ok ? "border-green-200 dark:border-green-400/30 bg-green-50 dark:bg-green-400/10 text-green-800 dark:text-green-200" : "border-amber-200 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-200")}>
          <div className="font-medium">{result.message ?? (result.ok ? t("settings.migration.done") : t("settings.migration.doneWithFailures"))}</div>
          <div className="mt-1 text-xs">{t("settings.migration.report", { transferred: result.transferred, skipped: result.skipped, failures: result.failures.length, seconds: Math.round(result.durationMs / 100) / 10 })}</div>
          {result.failures.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto font-mono text-[11px]">
              {result.failures.map((item) => <div key={`${item.path}-${item.reason}`}>{item.path}: {item.reason}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-white/10 p-3">
      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function GeneralTab({ theme, setTheme, language, setLanguage, t }: any) {
  return (
    <div className="p-6 space-y-6">
      <FieldRow label="Theme">
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setTheme(v)}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
                theme === v
                  ? "border-orange-500 dark:border-yellow-400 text-orange-500 dark:text-yellow-400 bg-orange-50 dark:bg-yellow-400/10"
                  : "border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-white/30"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Language">
        <div className="flex gap-2">
          {(["en", "zh"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setLanguage(v)}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                language === v
                  ? "border-orange-500 dark:border-yellow-400 text-orange-500 dark:text-yellow-400 bg-orange-50 dark:bg-yellow-400/10"
                  : "border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-white/30"
              )}
            >
              {v === "en" ? "English" : "中文"}
            </button>
          ))}
        </div>
      </FieldRow>
    </div>
  );
}

function LLMTab({ config, setConfig, t }: { config: LLMConfig; setConfig: (c: LLMConfig) => void; t: any }) {
  const [draft, setDraft] = useState<LLMConfig>(config);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");

  const update = (key: keyof LLMConfig, val: string) => setDraft((d) => ({ ...d, [key]: val }));

  const handleSave = () => {
    setConfig(draft);
    setTestState("idle");
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestError("");
    const result = await testLLMConnection(draft);
    if (result.ok) {
      setTestState("ok");
    } else {
      setTestState("fail");
      setTestError(result.error ?? String(result.status));
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg p-3 leading-relaxed">
        {t("settings.llm.securityNote")}
      </div>

      <FieldRow label={t("settings.llm.endpoint")}>
        <input className={inputCls} value={draft.endpoint} onChange={(e) => update("endpoint", e.target.value)} placeholder="https://api.openai.com/v1" />
      </FieldRow>
      <FieldRow label={t("settings.llm.apiKey")}>
        <input className={inputCls} type="password" value={draft.apiKey} onChange={(e) => update("apiKey", e.target.value)} placeholder="sk-..." />
      </FieldRow>
      <FieldRow label={t("settings.llm.model")}>
        <input className={inputCls} value={draft.model} onChange={(e) => update("model", e.target.value)} placeholder="gpt-4o-mini" />
      </FieldRow>
      <FieldRow label={t("settings.llm.promptConvert")}>
        <textarea className={clsx(inputCls, "font-mono text-xs leading-relaxed")} rows={4} value={draft.systemPromptConvertConv} onChange={(e) => update("systemPromptConvertConv", e.target.value)} />
      </FieldRow>
      <FieldRow label={t("settings.llm.promptRewrite")}>
        <textarea className={clsx(inputCls, "font-mono text-xs leading-relaxed")} rows={4} value={draft.systemPromptRewriteByAnnotations} onChange={(e) => update("systemPromptRewriteByAnnotations", e.target.value)} />
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleTest}
          disabled={testState === "testing" || !draft.apiKey}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-zinc-300 dark:border-white/20 text-zinc-700 dark:text-zinc-300 rounded-lg hover:border-zinc-400 dark:hover:border-white/40 transition-colors disabled:opacity-50"
        >
          {testState === "testing" && <Loader2 size={14} className="animate-spin" />}
          {testState === "ok" && <CheckCircle2 size={14} className="text-green-500" />}
          {testState === "fail" && <XCircle size={14} className="text-red-500" />}
          {testState === "testing" ? t("settings.llm.testing") : testState === "ok" ? t("settings.llm.testOk") : testState === "fail" ? t("settings.llm.testFail", { status: testError }) : t("settings.llm.testConn")}
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 rounded-lg hover:bg-orange-600 dark:hover:bg-yellow-500 transition-colors"
        >
          {t("settings.llm.save")}
        </button>
      </div>
    </div>
  );
}

// 语义检索 / 嵌入后端设置（spec hybrid-search §4.7）。配置服务端持久化、key 不回显。
function EmbeddingTab({ t }: { t: any }) {
  const { embeddingConfig, refreshEmbeddingConfig, saveEmbeddingConfig } = useAppContext();
  const [endpoint, setEndpoint] = useState(embeddingConfig?.endpoint ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(embeddingConfig?.model ?? "text-embedding-3-small");
  const [apiKey, setApiKey] = useState(""); // 永不回显；留空=沿用现有
  const [enabled, setEnabled] = useState(!!embeddingConfig?.enabled);
  const [saving, setSaving] = useState(false);

  // 打开时刷新一次拿最新 phase/进度；同步表单字段（key 除外）。
  useEffect(() => { refreshEmbeddingConfig(); }, [refreshEmbeddingConfig]);
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
        ...(apiKey ? { apiKey } : {}), // 留空不改 key（§4.7）
      });
      setApiKey("");
    } finally {
      setSaving(false);
    }
  };

  const phase = embeddingConfig?.phase ?? "disabled";
  const { done, total } = embeddingConfig?.embedding ?? { done: 0, total: 0 };
  const phaseLabel = phase === "partial"
    ? t("settings.embedding.phase.partial", { done, total })
    : t(`settings.embedding.phase.${phase}` as any);

  return (
    <div className="p-6 space-y-5">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg p-3 leading-relaxed">
        {t("settings.embedding.note")}
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-orange-500 dark:accent-yellow-400" />
        <span>
          <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{t("settings.embedding.enable")}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("settings.embedding.enableHint")}</span>
        </span>
      </label>

      <FieldRow label={t("settings.embedding.endpoint")}>
        <input className={inputCls} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
      </FieldRow>
      <FieldRow label={t("settings.embedding.model")}>
        <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="text-embedding-3-small" />
      </FieldRow>
      <FieldRow label={t("settings.embedding.apiKey")}>
        <input className={inputCls} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={embeddingConfig?.hasKey ? "••••••••" : "sk-..."} />
        <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.embedding.apiKeyKeep")}</span>
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 rounded-lg hover:bg-orange-600 dark:hover:bg-yellow-500 transition-colors disabled:opacity-50"
        >
          {saving ? t("settings.embedding.saving") : t("settings.embedding.save")}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("settings.embedding.status")}: {phaseLabel}
          {phase === "error" && embeddingConfig?.error ? ` — ${embeddingConfig.error}` : ""}
        </span>
      </div>
    </div>
  );
}

// 采集区块（spec ingest-gateway US-03 AC3 / US-06 AC2）：token 展示 / 复制 / 重置，脱敏开关。
function IngestTab({ t }: { t: any }) {
  const [token, setToken] = useState("");
  const [redact, setRedact] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ingest/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        setToken(data.token ?? "");
        setRedact(data.redact !== false);
        setState("ready");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const handleRotate = async () => {
    const res = await fetch("/api/ingest/token/rotate", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setToken(data.token ?? "");
    }
  };

  const handleRedactChange = async (next: boolean) => {
    setRedact(next);
    await fetch("/api/ingest/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redact: next }),
    });
  };

  if (state === "loading") {
    return <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">{t("settings.ingest.loading")}</div>;
  }
  if (state === "error") {
    return <div className="p-6 text-sm text-red-500">{t("settings.ingest.loadError")}</div>;
  }

  return (
    <div className="p-6 space-y-5">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg p-3 leading-relaxed">
        {t("settings.ingest.note")}
      </div>

      <FieldRow label={t("settings.ingest.token")}>
        <div className="flex gap-2">
          <input className={clsx(inputCls, "font-mono text-xs")} value={token} readOnly onFocus={(e) => e.target.select()} />
          <button
            onClick={handleCopy}
            className="shrink-0 px-3 py-1.5 text-sm border border-zinc-300 dark:border-white/20 text-zinc-700 dark:text-zinc-300 rounded-lg hover:border-zinc-400 dark:hover:border-white/40 transition-colors"
          >
            {copied ? t("settings.ingest.copied") : t("settings.ingest.copy")}
          </button>
        </div>
      </FieldRow>

      <div className="space-y-1.5">
        <button
          onClick={handleRotate}
          className="px-4 py-1.5 text-sm font-medium border border-red-300 dark:border-red-400/40 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-400/10 transition-colors"
        >
          {t("settings.ingest.rotate")}
        </button>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.ingest.rotateHint")}</p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={redact}
          onChange={(e) => handleRedactChange(e.target.checked)}
          className="h-4 w-4 accent-orange-500 dark:accent-yellow-400"
        />
        <span>
          <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{t("settings.ingest.redact")}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("settings.ingest.redactHint")}</span>
        </span>
      </label>
    </div>
  );
}

const MANUAL_VAULT = "__manual__";

function ObsidianTab({ config, onSave, t }: { config: ObsidianConfig; onSave: (cfg: ObsidianConfig) => void; t: any }) {
  const [vaults, setVaults] = useState<{ name: string; path: string }[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);
  const [selected, setSelected] = useState<string>(config.vaultPath ?? "");
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
      // 已保存路径不在探测列表中 → 切到手动输入项，保持配置可见
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
    if (selected && selected !== MANUAL_VAULT) {
      const vault = vaults.find((v) => v.path === selected);
      if (!vault) return;
      onSave({ vaultName: vault.name, vaultPath: vault.path });
      setFeedback({ kind: "ok", text: t("settings.obsidian.saved") });
      return;
    }
    // 手动输入路径：保存前经服务端校验（spec US-01 AC-3）
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
        setFeedback({ kind: "error", text: t("settings.obsidian.invalidPath", { error: String(data?.error ?? `HTTP ${res.status}`) }) });
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

  return (
    <div className="p-6 space-y-5">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.obsidian.hint")}</p>
      <FieldRow label={t("settings.obsidian.vault")}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <select
              className={clsx(inputCls, "appearance-none pr-9 cursor-pointer")}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setFeedback(null);
              }}
            >
              <option value="" disabled>
                {loadingVaults
                  ? t("settings.obsidian.detecting")
                  : vaults.length === 0
                  ? t("settings.obsidian.noneDetected")
                  : t("settings.obsidian.selectVault")}
              </option>
              {vaults.map((v) => (
                <option key={v.path} value={v.path}>
                  {v.name} — {v.path}
                </option>
              ))}
              <option value={MANUAL_VAULT}>{t("settings.obsidian.manualEntry")}</option>
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 dark:text-zinc-500"
            />
          </div>
          <button
            onClick={() => fetchVaults(true)}
            disabled={loadingVaults}
            className="shrink-0 p-2.5 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-orange-500 hover:border-orange-500 dark:hover:text-yellow-400 dark:hover:border-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("settings.obsidian.refresh")}
            aria-label={t("settings.obsidian.refresh")}
          >
            <RefreshCw size={16} className={clsx(loadingVaults && "animate-spin")} />
          </button>
        </div>
      </FieldRow>
      {selected === MANUAL_VAULT && (
        <FieldRow label={t("settings.obsidian.vaultPath")}>
          <input
            className={inputCls}
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="/Users/me/My Vault"
          />
        </FieldRow>
      )}
      {feedback && (
        <p
          className={clsx(
            "text-xs",
            feedback.kind === "ok" && "text-green-600 dark:text-green-400",
            feedback.kind === "warn" && "text-amber-600 dark:text-amber-400",
            feedback.kind === "error" && "text-red-600 dark:text-red-400",
          )}
        >
          {feedback.text}
        </p>
      )}
      <button
        onClick={handleSave}
        disabled={saving || (!selected && !manualPath.trim()) || (selected === MANUAL_VAULT && !manualPath.trim())}
        className={primaryButtonCls}
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("settings.obsidian.save")}
      </button>
    </div>
  );
}

function AboutTab({ t }: { t: any }) {
  return (
    <div className="p-6 space-y-3">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("settings.about.version")}</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.about.desc")}</p>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-yellow-400 transition-colors resize-none";
const primaryButtonCls =
  "inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 rounded-lg hover:bg-orange-600 dark:hover:bg-yellow-500 transition-colors disabled:opacity-50";
const secondaryButtonCls =
  "inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-zinc-300 dark:border-white/20 text-zinc-700 dark:text-zinc-300 rounded-lg hover:border-zinc-400 dark:hover:border-white/40 transition-colors disabled:opacity-50";
const tinyButtonCls =
  "px-2 py-1 text-xs border border-zinc-300 dark:border-white/20 text-zinc-600 dark:text-zinc-300 rounded-md hover:border-zinc-400 dark:hover:border-white/40 transition-colors";
const segmentButtonCls =
  "flex items-center justify-center gap-2 px-3 py-2 text-sm border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 rounded-lg hover:border-zinc-400 dark:hover:border-white/30 transition-colors";
const activeSegmentCls =
  "border-orange-500 dark:border-yellow-400 text-orange-500 dark:text-yellow-400 bg-orange-50 dark:bg-yellow-400/10";
