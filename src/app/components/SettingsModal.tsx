import React, { useState } from "react";
import { X, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { useAppContext, LLMConfig } from "../data";
import { testLLMConnection } from "../llm";
import { useTranslation } from "../i18n";

type Tab = "general" | "llm" | "obsidian" | "about";

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

            <div className="shrink-0 flex border-b border-zinc-200 dark:border-white/10 px-6">
              {(["general", "llm", "obsidian", "about"] as Tab[]).map((tab) => (
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
              {activeTab === "obsidian" && (
                <ObsidianTab
                  vaultName={obsidianConfig.vaultName}
                  onSave={(name) => setObsidianConfig({ vaultName: name })}
                  t={t}
                />
              )}
              {activeTab === "about" && <AboutTab t={t} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
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

function ObsidianTab({ vaultName, onSave, t }: { vaultName: string; onSave: (n: string) => void; t: any }) {
  const [draft, setDraft] = useState(vaultName);

  return (
    <div className="p-6 space-y-5">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("settings.obsidian.hint")}</p>
      <FieldRow label={t("settings.obsidian.vaultName")}>
        <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="My Vault" />
      </FieldRow>
      <button
        onClick={() => onSave(draft.trim())}
        className="px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 rounded-lg hover:bg-orange-600 dark:hover:bg-yellow-500 transition-colors"
      >
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
