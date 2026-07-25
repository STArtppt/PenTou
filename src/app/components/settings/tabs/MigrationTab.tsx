import { useState } from "react";
import { Loader2, UploadCloud, DownloadCloud, ShieldAlert, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "../../../i18n";
import { Field } from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

export function MigrationTab() {
  const { t } = useTranslation();
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
      const data = (await callMigrationApi("/api/migrate/plan", payload())) as MigrationPlan;
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
      const data = (await callMigrationApi("/api/migrate/run", {
        ...payload(),
        conflicts,
      })) as MigrationRunResult;
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
    <div className="space-y-5 p-6">
      <Alert>
        <Info />
        <AlertTitle>{t("settings.migration.noteTitle")}</AlertTitle>
        <AlertDescription>{t("settings.migration.note")}</AlertDescription>
      </Alert>

      <Field label={t("settings.migration.direction")}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={direction === "push" ? "primary" : "outline"}
            onClick={() => {
              setDirection("push");
              resetPreview();
            }}
          >
            <UploadCloud size={16} />
            <span>{t("settings.migration.push")}</span>
          </Button>
          <Button
            type="button"
            variant={direction === "pull" ? "primary" : "outline"}
            onClick={() => {
              setDirection("pull");
              resetPreview();
            }}
          >
            <DownloadCloud size={16} />
            <span>{t("settings.migration.pull")}</span>
          </Button>
        </div>
      </Field>

      <Field label={t("settings.migration.remoteUrl")}>
        <Input
          value={remoteUrl}
          onChange={(e) => {
            setRemoteUrl(e.target.value);
            resetPreview();
          }}
          placeholder="https://pentou.example.com"
        />
      </Field>
      <Field label={t("settings.migration.password")}>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("settings.migration.passwordPlaceholder")}
        />
      </Field>

      {remoteUrl.trim().startsWith("http://") && (
        <label className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
          <Checkbox
            checked={allowInsecure}
            onCheckedChange={(v) => setAllowInsecure(v === true)}
            className="mt-0.5"
          />
          <span className="flex gap-2">
            <ShieldAlert size={15} className="shrink-0" />
            {t("settings.migration.insecure")}
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={handleTest} disabled={busy || !remoteUrl.trim()}>
          {state === "testing" && <Loader2 size={14} className="animate-spin" />}
          {t("settings.migration.test")}
        </Button>
        <Button type="button" variant="primary" onClick={handlePlan} disabled={busy || !remoteUrl.trim()}>
          {state === "planning" && <Loader2 size={14} className="animate-spin" />}
          {t("settings.migration.preview")}
        </Button>
        {testMessage && <span className="text-xs text-green-600 dark:text-green-400">{testMessage}</span>}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("settings.errorTitle")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {plan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label={t("settings.migration.adds")} value={plan.adds.length} />
            <Metric label={t("settings.migration.conflicts")} value={plan.conflicts.length} />
            <Metric label={t("settings.migration.skips")} value={plan.skips} />
            <Metric label={t("settings.migration.targetOnly")} value={plan.targetOnly} />
          </div>

          {plan.adds.length === 0 && plan.conflicts.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-white/10 dark:text-zinc-300">
              {t("settings.migration.noDiff")}
            </div>
          ) : (
            <>
              {plan.conflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {t("settings.migration.conflictPolicy")}
                    </span>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => toggleAllConflicts(true)}>
                        {t("settings.migration.overwriteAll")}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => toggleAllConflicts(false)}>
                        {t("settings.migration.skipAll")}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-44 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-white/10 dark:border-white/10">
                    {plan.conflicts.slice(0, 80).map((item) => (
                      <label key={item.path} className="flex items-center gap-3 px-3 py-2 text-xs">
                        <Checkbox
                          checked={overwriteConflicts.has(item.path)}
                          onCheckedChange={(checked) => {
                            setOverwriteConflicts((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(item.path);
                              else next.delete(item.path);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-zinc-700 dark:text-zinc-300">
                          {item.path}
                        </span>
                        <span className="shrink-0 text-zinc-400">
                          {formatBytes(item.sourceSize)} / {formatBytes(item.targetSize)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {plan.adds.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {t("settings.migration.newFiles")}
                  </span>
                  <div className="max-h-32 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-white/10 dark:border-white/10">
                    {plan.adds.slice(0, 80).map((item) => (
                      <div key={item} className="truncate px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button type="button" variant="primary" onClick={handleRun} disabled={busy || transferCount === 0}>
                {state === "running" && <Loader2 size={14} className="animate-spin" />}
                {t("settings.migration.run", { count: transferCount })}
              </Button>
            </>
          )}
        </div>
      )}

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"}>
          {result.ok ? <CheckCircle2 /> : <AlertTriangle />}
          <AlertTitle>
            {result.message ??
              (result.ok ? t("settings.migration.done") : t("settings.migration.doneWithFailures"))}
          </AlertTitle>
          <AlertDescription className="block">
            <div className="text-xs">
              {t("settings.migration.report", {
                transferred: result.transferred,
                skipped: result.skipped,
                failures: result.failures.length,
                seconds: Math.round(result.durationMs / 100) / 10,
              })}
            </div>
            {result.failures.length > 0 && (
              <div className="mt-2 max-h-24 overflow-y-auto font-mono text-xs">
                {result.failures.map((item) => (
                  <div key={`${item.path}-${item.reason}`}>
                    {item.path}: {item.reason}
                  </div>
                ))}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
