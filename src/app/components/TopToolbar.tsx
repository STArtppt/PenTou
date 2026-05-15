import React, { lazy, Suspense, useState } from "react";
import {
  FileText,
  Sparkles,
  History,
  Send,
  Edit3,
  MessageSquare,
  Settings,
  X,
  Loader2,
  Import,
  Paperclip,
  MessageCircle,
} from "lucide-react";
import clsx from "clsx";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import { convertConversationToDocument, LLMError } from "../llm";
import { exportToObsidian } from "../obsidian";
import { generateDocId, mergeRewriteWithExistingBody } from "../doc-utils";

const RewriteConfirmDialog = lazy(() =>
  import("./RewriteConfirmDialog").then(m => ({ default: m.RewriteConfirmDialog }))
);

export function TopToolbar() {
  const {
    activeView,
    activeConversationId,
    activeDocId,
    conversations,
    documents,
    llmConfig,
    obsidianConfig,
    setObsidianConfig,
    annotationsByDoc,
    editMode,
    setEditMode,
    previewingVersionId,
    setVersionPanelOpen,
    setSettingsOpen,
    addDocuments,
    updateDocument,
    setActiveView,
    setActiveDocId,
    commitVersion,
    setAnnotationsForDoc,
  } = useAppContext();
  const { t } = useTranslation();

  const [converting, setConverting] = useState(false);
  const [showRewrite, setShowRewrite] = useState(false);
  const [vaultPromptOpen, setVaultPromptOpen] = useState(false);
  const [vaultInput, setVaultInput] = useState("");
  const [pendingObsidianExport, setPendingObsidianExport] = useState(false);

  const activeDoc = documents.find((d) => d.id === activeDocId);
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const docAnnotations = activeDocId ? (annotationsByDoc[activeDocId] ?? []) : [];
  const isPreviewMode = !!previewingVersionId;

  const hasLLM = !!(llmConfig.apiKey && llmConfig.endpoint && llmConfig.model);
  const hasCommentAnnotations = docAnnotations.some((a) => a.comment);

  // ── Convert conversation to document ──────────────────────────────────────

  const handleConvertToDoc = async () => {
    if (!activeConv) return;
    if (!hasLLM) {
      setSettingsOpen(true);
      return;
    }
    setConverting(true);
    try {
      const markdown = await convertConversationToDocument(activeConv, llmConfig);
      const now = new Date().toISOString();
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : activeConv.title;
      const existingDoc = documents.find((d) => d.sourceConversationId === activeConv.id);

      if (existingDoc) {
        const nextBody = mergeRewriteWithExistingBody(existingDoc.body, markdown);
        await commitVersion(existingDoc.id, nextBody, "llm-rewrite");
        await updateDocument(existingDoc.id, {
          title,
          sourcePlatform: activeConv.platform,
          generatedBy: llmConfig.model,
          generatedAt: now,
        });
        setActiveView("doc");
        setActiveDocId(existingDoc.id);
        return;
      }

      const docId = generateDocId();
      await addDocuments([{
        id: docId,
        title,
        folderId: null,
        createdAt: now,
        updatedAt: now,
        body: markdown,
        currentVersionId: "",
        sourceConversationId: activeConv.id,
        sourcePlatform: activeConv.platform,
        generatedBy: llmConfig.model,
        generatedAt: now,
      }]);

      setActiveView("doc");
      setActiveDocId(docId);
    } catch (e: any) {
      const msg = e instanceof LLMError
        ? `LLM Error ${e.context.status}: ${e.message} (model: ${e.context.model})`
        : String(e);
      console.error({ module: "TopToolbar", op: "convertToDoc", err: msg });
      alert(msg);
    } finally {
      setConverting(false);
    }
  };

  // ── AI Rewrite ─────────────────────────────────────────────────────────────

  const handleRewrite = () => {
    if (!activeDoc || !hasLLM || !hasCommentAnnotations) return;
    setShowRewrite(true);
  };

  // ── Obsidian Export ────────────────────────────────────────────────────────

  const handleObsidian = async () => {
    if (!activeDoc) return;
    const cfg = obsidianConfig.vaultName ? obsidianConfig : null;
    if (!cfg) {
      setVaultPromptOpen(true);
      setPendingObsidianExport(true);
      return;
    }
    await doObsidianExport(activeDoc.body, activeDoc.title, cfg.vaultName);
  };

  const doObsidianExport = async (body: string, title: string, vaultName: string) => {
    const docForExport = { ...activeDoc!, body, title };
    const result = await exportToObsidian(docForExport, { vaultName });
    if (result.mode === "clipboard") {
      alert(t("obsidian.copied", { n: result.charCount ?? 0 }));
    } else {
      // toast shown by browser
    }
  };

  const handleVaultSave = async () => {
    const name = vaultInput.trim();
    if (!name) return;
    setObsidianConfig({ vaultName: name });
    setVaultPromptOpen(false);
    if (pendingObsidianExport && activeDoc) {
      await doObsidianExport(activeDoc.body, activeDoc.title, name);
    }
    setPendingObsidianExport(false);
    setVaultInput("");
  };

  const disabledAll = !activeConversationId && activeView === "chat";
  const disabledDoc = !activeDocId && activeView === "doc";

  // doc view
  const editActive = editMode !== "off";
  const rewriteDisabledReason = !activeDocId
    ? t("toolbar.noSelection")
    : !hasLLM
    ? t("rewrite.noLLM")
    : !hasCommentAnnotations
    ? t("rewrite.noAnnotations")
    : undefined;

  return (
    <>
      <div className="shrink-0 h-12 border-b border-zinc-200 dark:border-white/10 px-4 flex items-center gap-2 bg-white/80 dark:bg-[#1A1A1A]/80 backdrop-blur-md z-10">
        {/* Document Title and Tags */}
        <div className="flex items-center gap-2 max-w-xl">
          <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 truncate">
            {activeDoc ? activeDoc.title : ""}
          </span>
          {activeDoc?.sourceConversationId && (
            <button
              onClick={() => {
                setActiveConversationId(activeDoc.sourceConversationId!);
                setActiveView("chat");
              }}
              title={t("doc.goToConversation", { defaultValue: "查看源对话" })}
              className="shrink-0 px-2 py-[3px] rounded-md bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors cursor-pointer font-medium"
            >
              <MessageCircle size={12} strokeWidth={2.5} />
              {t("doc.fromConversation", { defaultValue: "来自对话" })}
            </button>
          )}
          {activeDoc?.importedFrom && (
            <span
              title={activeDoc.importedFrom}
              className="shrink-0 max-w-[150px] px-2 py-[3px] rounded-md bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5 cursor-default font-medium"
            >
              <Paperclip size={12} className="shrink-0" strokeWidth={2.5} />
              <span className="truncate">{t("doc.fromImport", { defaultValue: "来自导入" })}</span>
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Action Buttons */}
        {/* Edit Doc button with sub-mode toggle */}
        {editActive ? (
          <>
            <button
              onClick={() => setEditMode(editMode === "annotate" ? "edit" : "annotate")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                "bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300",
              )}
            >
              {editMode === "annotate" ? t("doc.annotateMode") : t("doc.editMode")}
            </button>
            <button
              onClick={() => setEditMode("off")}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            >
              <X size={14} /> {t("toolbar.exitEdit")}
            </button>
          </>
        ) : (
          <ToolButton
            icon={Edit3}
            label={t("toolbar.editDoc")}
            disabled={!activeDocId || isPreviewMode}
            onClick={() => setEditMode("annotate")}
            tooltip={!activeDocId ? t("toolbar.noSelection") : isPreviewMode ? "Exit preview first" : undefined}
          />
        )}

        <div className="w-px h-5 bg-zinc-200 dark:bg-white/10 mx-1" />

        <ToolButton
          icon={Sparkles}
          label={t("toolbar.rewriteByAnnotations")}
          disabled={!!rewriteDisabledReason || isPreviewMode}
          onClick={handleRewrite}
          tooltip={rewriteDisabledReason}
        />
        <ToolButton
          icon={History}
          label={t("toolbar.versionHistory")}
          disabled={!activeDocId}
          onClick={() => setVersionPanelOpen(true)}
          tooltip={!activeDocId ? t("toolbar.noSelection") : undefined}
        />
        <ToolButton
          icon={Send}
          label={t("toolbar.exportObsidian")}
          disabled={!activeDocId || isPreviewMode}
          onClick={handleObsidian}
          tooltip={!activeDocId ? t("toolbar.noSelection") : undefined}
        />

      </div>

      {showRewrite && activeDoc && (
        <Suspense fallback={null}>
          <RewriteConfirmDialog
            doc={activeDoc}
            annotations={docAnnotations.filter((a) => a.comment)}
            onClose={() => setShowRewrite(false)}
            onSuccess={() => setShowRewrite(false)}
          />
        </Suspense>
      )}

      {/* Vault name prompt */}
      {vaultPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => { setVaultPromptOpen(false); setPendingObsidianExport(false); }} />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-2xl rounded-xl p-5 z-10">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">{t("obsidian.noVault")}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t("settings.obsidian.hint")}</p>
            <input
              autoFocus
              type="text"
              value={vaultInput}
              onChange={(e) => setVaultInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleVaultSave(); }}
              placeholder={t("obsidian.vaultPlaceholder")}
              className="w-full bg-zinc-50 dark:bg-[#151515] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-yellow-400 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setVaultPromptOpen(false); setPendingObsidianExport(false); }} className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                {t("toolbar.cancel")}
              </button>
              <button onClick={handleVaultSave} className="px-4 py-1.5 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-500 rounded-lg transition-colors">
                {t("obsidian.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToolButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  tooltip,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  tooltip?: string;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={clsx(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
        disabled
          ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-orange-500 dark:hover:text-yellow-400",
      )}
    >
      <Icon size={14} className={loading ? "animate-spin" : ""} />
      {label}
    </button>
  );
}
