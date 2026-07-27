import React, { useEffect, useState } from "react";
import { X, RotateCcw, Eye, EyeOff, Trash2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import { useAppContext, DocumentVersion, ConversationVersion, VersionType } from "../data";
import { useTranslation } from "../i18n";
import { formatDisplayDateTime } from "../utils/dateFormat";

// 通用版本面板：文档与会话共用（spec import-dedup-versioning 决策5）。
// kind="document"（默认）走文档版本端点；kind="conversation" 走会话版本端点。
type VersionKind = "document" | "conversation";

interface PanelVersion {
  id: string;
  version: number;
  type: VersionType;
  createdAt: string;
  sourceAnnotationIds?: string[];
}

export function VersionPanel({ kind = "document" }: { kind?: VersionKind }) {
  const {
    versionPanelOpen,
    setVersionPanelOpen,
    activeDocId,
    documents,
    versionsByDoc,
    loadVersions,
    rollbackToVersion,
    deleteVersion,
    activeConversationId,
    conversations,
    versionsByConv,
    loadConversationVersions,
    rollbackConversation,
    previewingVersionId,
    setPreviewingVersionId,
  } = useAppContext();
  const { t, language } = useTranslation();

  const isConv = kind === "conversation";
  const activeId = isConv ? activeConversationId : activeDocId;
  const activeItem = isConv
    ? conversations.find((c) => c.id === activeConversationId)
    : documents.find((d) => d.id === activeDocId);
  const versions = ((isConv
    ? (activeConversationId ? versionsByConv[activeConversationId] : undefined)
    : (activeDocId ? versionsByDoc[activeDocId] : undefined)) ?? []) as PanelVersion[];
  const currentVersionId = activeItem?.currentVersionId;
  const updatedAt = (activeItem as any)?.updatedAt as string | undefined;

  useEffect(() => {
    if (!versionPanelOpen || !activeId) return;
    if (isConv) {
      if (!versionsByConv[activeId]) loadConversationVersions(activeId);
    } else {
      if (!versionsByDoc[activeId]) loadVersions(activeId);
    }
  }, [versionPanelOpen, activeId, isConv]);

  const handlePreview = (v: PanelVersion) => {
    setPreviewingVersionId(previewingVersionId === v.id ? null : v.id);
  };

  // 危险操作确认走统一 ConfirmDialog（替代原生浏览器确认框）
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    confirmVariant: ButtonProps["variant"];
    run: () => Promise<void>;
  } | null>(null);

  const handleRollback = (v: PanelVersion) => {
    if (!activeId) return;
    const currentVer = versions.find((x) => x.id === currentVersionId);
    const currentN = currentVer?.version ?? "?";
    setConfirmState({
      title: t("version.rollback"),
      description: t("version.confirmRollback", { current: currentN, target: v.version }),
      confirmLabel: t("version.rollback"),
      confirmVariant: "primary",
      run: async () => {
        try {
          if (isConv) await rollbackConversation(activeId, v.id);
          else await rollbackToVersion(activeId, v.id);
          setPreviewingVersionId(null);
          setVersionPanelOpen(false);
        } catch (e: any) {
          alert(String(e));
        }
      },
    });
  };

  const handleDelete = (v: PanelVersion) => {
    if (!activeId || isConv) return; // 会话版本不支持删除（US-03 仅查看 / 回滚）
    setConfirmState({
      title: t("version.delete"),
      description: t("version.confirmDelete"),
      confirmLabel: t("version.delete"),
      confirmVariant: "danger",
      run: async () => {
        try {
          await deleteVersion(activeId, v.id);
        } catch (e: any) {
          alert(String(e));
        }
      },
    });
  };

  return (
    <>
    <AnimatePresence>
      {versionPanelOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/10"
            onClick={() => setVersionPanelOpen(false)}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 250 }}
            className="fixed right-0 top-0 bottom-0 w-80 bg-white dark:bg-[#151515] border-l border-zinc-200 dark:border-white/10 shadow-2xl z-40 flex flex-col"
          >
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-white/10">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Clock size={14} className="text-zinc-400" />
                  {t("version.title")}
                </h3>
                {updatedAt && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    {t("version.updatedAt", { time: formatDisplayDateTime(updatedAt, language) })}
                  </p>
                )}
              </div>
              <IconTooltip label={t("toolbar.close")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-zinc-400"
                  onClick={() => setVersionPanelOpen(false)}
                >
                  <X size={16} />
                </Button>
              </IconTooltip>
            </div>

            {versions.length <= 1 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500 p-6 text-center">
                {t("version.empty")}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {versions.length > 10 && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mb-2">
                    {t("version.tooMany", { n: versions.length })}
                  </div>
                )}
                {[...versions].reverse().map((v) => (
                  <VersionCard
                    key={v.id}
                    version={v}
                    isCurrent={v.id === currentVersionId}
                    isPreviewing={v.id === previewingVersionId}
                    allowDelete={!isConv}
                    onPreview={() => handlePreview(v)}
                    onRollback={() => handleRollback(v)}
                    onDelete={() => handleDelete(v)}
                    t={t}
                    language={language}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
    <ConfirmDialog
      open={!!confirmState}
      onOpenChange={(o) => { if (!o) setConfirmState(null); }}
      title={confirmState?.title ?? ""}
      description={confirmState?.description}
      confirmLabel={confirmState?.confirmLabel}
      cancelLabel={t("toolbar.cancel")}
      confirmVariant={confirmState?.confirmVariant}
      onConfirm={() => { void confirmState?.run(); }}
    />
    </>
  );
}

const TYPE_COLORS: Record<VersionType, string> = {
  "import": "bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400",
  "manual-edit": "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "conversation-excerpt": "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "pre-llm-rewrite": "bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-500",
  "llm-rewrite": "bg-muted text-muted-foreground",
  "pre-import-overwrite": "bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-500",
  "pre-rollback": "bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-500",
  "rolled-back-from": "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300",
};

function VersionCard({
  version,
  isCurrent,
  isPreviewing,
  allowDelete,
  onPreview,
  onRollback,
  onDelete,
  t,
  language,
}: {
  version: PanelVersion;
  isCurrent: boolean;
  isPreviewing: boolean;
  allowDelete: boolean;
  onPreview: () => void;
  onRollback: () => void;
  onDelete: () => void;
  t: (key: any, p?: any) => string;
  language: "en" | "zh";
}) {
  const typeLabel = t(`version.type.${version.type}` as any);

  return (
    <div
      className={clsx(
        "rounded-lg border p-3 transition-colors",
        isCurrent
          ? "border-border bg-accent"
          : isPreviewing
          ? "border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10"
          : "border-zinc-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A]"
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">v{version.version}</span>
          <span className={clsx("text-xs px-1.5 py-0.5 rounded font-medium", TYPE_COLORS[version.type])}>
            {typeLabel}
          </span>
          {isCurrent && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-primary text-primary-foreground">
              {t("version.current")}
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">
        {formatDisplayDateTime(version.createdAt, language)}
        {version.sourceAnnotationIds && version.sourceAnnotationIds.length > 0 && (
          <span className="ml-2 text-foreground">
            {t("version.basedOn", { n: version.sourceAnnotationIds.length })}
          </span>
        )}
      </div>

      {!isCurrent && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPreview}
            className="h-auto gap-1 rounded px-2 py-1 text-xs text-muted-foreground"
          >
            {isPreviewing ? <EyeOff size={10} /> : <Eye size={10} />}
            {isPreviewing ? t("version.stopPreview") : t("version.preview")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRollback}
            className="h-auto gap-1 rounded px-2 py-1 text-xs text-muted-foreground"
          >
            <RotateCcw size={10} /> {t("version.rollback")}
          </Button>
          {allowDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="ml-auto h-auto gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 size={10} /> {t("version.delete")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
