import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LLMConfig } from "../../../data";
import { testLLMConnection } from "../../../llm";
import { useTranslation } from "../../../i18n";
import { Field } from "../Field";
import { SettingsNote } from "../SettingsNote";

export function LLMTab({
  config,
  setConfig,
}: {
  config: LLMConfig;
  setConfig: (c: LLMConfig) => void;
}) {
  const { t } = useTranslation();
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
    <div className="space-y-5 p-6">
      <SettingsNote>{t("settings.llm.securityNote")}</SettingsNote>

      <Field label={t("settings.llm.endpoint")}>
        <Input value={draft.endpoint} onChange={(e) => update("endpoint", e.target.value)} placeholder="https://api.openai.com/v1" />
      </Field>
      <Field label={t("settings.llm.apiKey")}>
        <Input type="password" value={draft.apiKey} onChange={(e) => update("apiKey", e.target.value)} placeholder="sk-..." />
      </Field>
      <Field label={t("settings.llm.model")}>
        <Input value={draft.model} onChange={(e) => update("model", e.target.value)} placeholder="gpt-4o-mini" />
      </Field>
      <Field label={t("settings.llm.promptConvert")}>
        <Textarea
          className="font-mono text-xs leading-relaxed"
          rows={4}
          value={draft.systemPromptConvertConv}
          onChange={(e) => update("systemPromptConvertConv", e.target.value)}
        />
      </Field>
      <Field label={t("settings.llm.promptRewrite")}>
        <Textarea
          className="font-mono text-xs leading-relaxed"
          rows={4}
          value={draft.systemPromptRewriteByAnnotations}
          onChange={(e) => update("systemPromptRewriteByAnnotations", e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={testState === "testing" || !draft.apiKey}
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
    </div>
  );
}
