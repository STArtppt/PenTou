import React, { useEffect } from "react";
import { X, RotateCcw, Eye, EyeOff, Trash2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { useAppContext, DocumentVersion, VersionType } from "../data";
import { useTranslation } from "../i18n";
import { format } from "date-fns";

export function VersionPanel() {
  const {
    versionPanelOpen,
    setVersionPanelOpen,
    activeDocId,
    documents,
    versionsByDoc,
    loadVersions,
    previewingVersionId,
    setPreviewingVersionId,
    rollbackToVersion,
    deleteVersion,
  } = useAppContext();
  const { t } = useTranslation();

  const activeDoc = documents.find((d) => d.id === activeDocId);
  const versions = (activeDocId ? versionsByDoc[activeDocId] : undefined) ?? [];
  const currentVersionId = activeDoc?.currentVersionId;

  useEffect(() => {
    if (versionPanelOpen && activeDocId && !versionsByDoc[activeDocId]) {
      loadVersions(activeDocId);
    }
  }, [versionPanelOpen, activeDocId]);

  const handlePreview = (v: DocumentVersion) => {
    setPreviewingVersionId(previewingVersionId === v.id ? null : v.id);
  };

  const handleRollback = async (v: DocumentVersion) => {
    if (!activeDocId) return;
    const currentVer = versions.find((x) => x.id === currentVersionId);
    const currentN = currentVer?.version ?? "?";
    if (!window.confirm(t("version.confirmRollback", { current: currentN, target: v.version }))) return;
    try {
      await rollbackToVersion(activeDocId, v.id);
      setPreviewingVersionId(null);
      setVersionPanelOpen(false);
    } catch (e: any) {
      alert(String(e));
    }
  };

  const handleDelete = async (v: DocumentVersion) => {
    if (!activeDocId) return;
    if (!window.confirm(t("version.confirmDelete"))) return;
    try {
      await deleteVersion(activeDocId, v.id);
    } catch (e: any) {
      alert(String(e));
    }
  };

  return (
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
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Clock size={14} className="text-zinc-400" />
                {t("version.title")}
              </h3>
              <button
                onClick={() => setVersionPanelOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {versions.length <= 1 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-400 dark:text-zinc-500 p-6 text-center">
                {t("version.empty")}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {versions.length > 10 && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/20 rounded-lg px-3 py-2 mb-2">
                    {t("version.tooMany", { n: versions.length })}
                  </div>
                )}
                {[...versions].reverse().map((v) => (
                  <VersionCard
                    key={v.id}
                    version={v}
                    isCurrent={v.id === currentVersionId}
                    isPreviewing={v.id === previewingVersionId}
                    onPreview={() => handlePreview(v)}
                    onRollback={() => handleRollback(v)}
                    onDelete={() => handleDelete(v)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const TYPE_COLORS: Record<VersionType, string> = {
  "import": "bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400",
  "manual-edit": "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "conversation-excerpt": "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "pre-llm-rewrite": "bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-500",
  "llm-rewrite": "bg-orange-100 dark:bg-yellow-500/20 text-orange-700 dark:text-yellow-300",
  "pre-rollback": "bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-500",
  "rolled-back-from": "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300",
};

function VersionCard({
  version,
  isCurrent,
  isPreviewing,
  onPreview,
  onRollback,
  onDelete,
  t,
}: {
  version: DocumentVersion;
  isCurrent: boolean;
  isPreviewing: boolean;
  onPreview: () => void;
  onRollback: () => void;
  onDelete: () => void;
  t: (key: any, p?: any) => string;
}) {
  const typeLabel = t(`version.type.${version.type}` as any);

  return (
    <div
      className={clsx(
        "rounded-lg border p-3 transition-colors",
        isCurrent
          ? "border-orange-300 dark:border-yellow-500/40 bg-orange-50 dark:bg-yellow-500/10"
          : isPreviewing
          ? "border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10"
          : "border-zinc-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A]"
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">v{version.version}</span>
          <span className={clsx("text-[10px] px-1.5 py-0.5 rounded font-medium", TYPE_COLORS[version.type])}>
            {typeLabel}
          </span>
          {isCurrent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900">
              {t("version.current")}
            </span>
          )}
        </div>
      </div>

      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-2">
        {format(new Date(version.createdAt), "MMM d, yyyy h:mm a")}
        {version.sourceAnnotationIds && version.sourceAnnotationIds.length > 0 && (
          <span className="ml-2 text-orange-500 dark:text-yellow-400">
            {t("version.basedOn", { n: version.sourceAnnotationIds.length })}
          </span>
        )}
      </div>

      {!isCurrent && (
        <div className="flex items-center gap-1">
          <button
            onClick={onPreview}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            {isPreviewing ? <EyeOff size={10} /> : <Eye size={10} />}
            {isPreviewing ? t("version.stopPreview") : t("version.preview")}
          </button>
          <button
            onClick={onRollback}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400 transition-colors"
          >
            <RotateCcw size={10} /> {t("version.rollback")}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-auto"
          >
            <Trash2 size={10} /> {t("version.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
