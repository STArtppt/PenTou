import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "../i18n";
import type { MetaField } from "../metadata-fields";
import { copyText } from "../utils/clipboard";

export type MetadataPanelProps = {
  /** 条目 id：作 key 重置展开态，不跨条目记忆 */
  entryId: string;
  fields: MetaField[];
  technical: MetaField[];
  /** 文档自带 frontmatter；会话侧传 null/undefined */
  rawEntries?: Array<[string, string]> | null;
  className?: string;
};

function fieldLabel(
  key: string,
  t: (key: any, placeholders?: Record<string, string | number>) => string,
): string {
  const i18nKey = `meta.field.${key}` as const;
  const label = t(i18nKey as any);
  // 未知键回退为 key 本身（原样区用不到此函数）
  return label === i18nKey ? key : label;
}

function displayValue(
  field: MetaField,
  t: (key: any, placeholders?: Record<string, string | number>) => string,
): string {
  if (field.key === "captureMethod") {
    if (field.value === "web") return t("capture.web");
    if (field.value === "terminal") return t("capture.terminal");
    if (field.value === "manual") return t("capture.manual");
  }
  if (field.key === "origin") {
    if (field.value === "conversation") return t("doc.fromConversation");
    if (field.value === "terminal") return t("doc.fromTerminal");
    if (field.value === "import") return t("doc.fromImport");
  }
  return field.value;
}

function FieldTable({ rows }: { rows: MetaField[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(6rem,auto)_1fr] sm:gap-x-4">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-muted-foreground">{fieldLabel(row.key, t)}</dt>
          <dd className="min-w-0 break-words text-foreground">{displayValue(row, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="break-all font-mono text-xs text-foreground">{value}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        onClick={onCopy}
        aria-label={t("meta.copy")}
      >
        {copied ? <Check className="size-3.5 text-foreground" /> : <Copy className="size-3.5" />}
      </Button>
      {copied ? (
        <span className="sr-only" role="status">
          {t("meta.copied")}
        </span>
      ) : null}
    </div>
  );
}

function TriggerRow({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-data-panel-open:rotate-90 motion-reduce:transition-none"
        aria-hidden
      />
    </>
  );
}

/**
 * 正文顶部可折叠元数据面板。
 * 默认折叠；key=entryId 切换条目时重置。不在 .markdown-body 内挂载。
 */
export function MetadataPanel({
  entryId,
  fields,
  technical,
  rawEntries,
  className,
}: MetadataPanelProps) {
  const { t } = useTranslation();
  const hasRaw = Array.isArray(rawEntries) && rawEntries.length > 0;

  return (
    <div
      key={entryId}
      data-slot="metadata-panel"
      className={cn(
        "mb-6 rounded-lg border border-border bg-muted/30 text-foreground",
        className,
      )}
    >
      <Collapsible>
        <CollapsibleTrigger className="text-sm font-medium">
          <TriggerRow>{t("meta.panelTitle")}</TriggerRow>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <CollapsibleContent className="space-y-4 text-foreground">
            <FieldTable rows={fields} />

            {technical.length > 0 ? (
              <div className="rounded-md border border-border bg-background/60">
                <Collapsible>
                  <CollapsibleTrigger className="text-xs font-medium text-muted-foreground">
                    <TriggerRow>{t("meta.technicalDetails")}</TriggerRow>
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <CollapsibleContent className="space-y-3">
                      {technical.map((row) => (
                        <CopyableRow
                          key={row.key}
                          label={fieldLabel(row.key, t)}
                          value={row.value}
                        />
                      ))}
                    </CollapsibleContent>
                  </CollapsiblePanel>
                </Collapsible>
              </div>
            ) : null}

            {hasRaw ? (
              <div className="space-y-2 rounded-md border border-dashed border-border bg-background/40 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("meta.rawFrontmatter")}
                </div>
                <dl className="grid gap-2 font-mono text-xs sm:grid-cols-[minmax(5rem,auto)_1fr] sm:gap-x-3">
                  {rawEntries!.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-all text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </CollapsibleContent>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
