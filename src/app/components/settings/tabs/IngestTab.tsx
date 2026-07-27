import { useEffect, useState } from "react";
import { Check, Copy, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTranslation } from "../../../i18n";
import { Field } from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function IngestTab() {
  const { t } = useTranslation();
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
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
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
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("settings.errorTitle")}</AlertTitle>
          <AlertDescription>{t("settings.ingest.loadError")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <Alert>
        <Info />
        <AlertTitle>{t("settings.ingest.noteTitle")}</AlertTitle>
        <AlertDescription>{t("settings.ingest.note")}</AlertDescription>
      </Alert>

      <Field label={t("settings.ingest.token")}>
        <div className="flex gap-2">
          <Input
            className="font-mono text-xs"
            value={token}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <IconTooltip label={copied ? t("settings.ingest.copied") : t("settings.ingest.copy")}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </IconTooltip>
        </div>
      </Field>

      <div className="space-y-1.5">
        <Button type="button" variant="danger" onClick={handleRotate}>
          {t("settings.ingest.rotate")}
        </Button>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.ingest.rotateHint")}</p>
      </div>

      <div className="flex items-start gap-3">
        <Switch id="ingest-redact" checked={redact} onCheckedChange={handleRedactChange} className="mt-0.5" />
        <div className="space-y-0.5">
          <Label htmlFor="ingest-redact">
            {t("settings.ingest.redact")}
          </Label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("settings.ingest.redactHint")}</p>
        </div>
      </div>
    </div>
  );
}
