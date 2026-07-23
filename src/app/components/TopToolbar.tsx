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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppContext, type ObsidianConfig } from "../data";
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
    aiSidebarOpen,
    toggleAiSidebar,
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
    await doObsidianExport(activeDoc.body, activeDoc.title, cfg);
  };

  const doObsidianExport = async (body: string, title: string, cfg: ObsidianConfig) => {
    const docForExport = { ...activeDoc!, body, title };
    const result = await exportToObsidian(docForExport, cfg);
    if (result.mode === "vault") {
      toast.success(t("obsidian.exported", { name: result.fileName }));
      return;
    }
    if (result.fallbackError) {
      toast.error(t("obsidian.vaultFailed", { error: result.fallbackError }));
    }
    if (result.mode === "clipboard") {
      toast.info(t("obsidian.copied", { n: result.charCount ?? 0 }), {
        description: t("obsidian.configureHint"),
      });
    }
    // uri 模式无回退错误时无需提示：浏览器会直接唤起 Obsidian
  };

  const handleVaultSave = async () => {
    const name = vaultInput.trim();
    if (!name) return;
    setObsidianConfig({ vaultName: name });
    setVaultPromptOpen(false);
    if (pendingObsidianExport && activeDoc) {
      await doObsidianExport(activeDoc.body, activeDoc.title, { vaultName: name });
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
              className="shrink-0 px-2 py-[3px] rounded-md bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors cursor-pointer font-medium"
            >
              <MessageCircle size={12} strokeWidth={2.5} />
              {t("doc.fromConversation", { defaultValue: "来自对话" })}
            </button>
          )}
          {activeDoc?.importedFrom && (
            <span
              title={activeDoc.importedFrom}
              className="shrink-0 max-w-[150px] px-2 py-[3px] rounded-md bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5 cursor-default font-medium"
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
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditMode(editMode === "annotate" ? "edit" : "annotate")}
            >
              {editMode === "annotate" ? t("doc.annotateMode") : t("doc.editMode")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => setEditMode("off")}
            >
              <X size={14} /> {t("toolbar.exitEdit")}
            </Button>
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
        <ToolButton
          icon={MessageSquare}
          label={t("toolbar.askAi")}
          active={aiSidebarOpen}
          onClick={toggleAiSidebar}
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

      <Dialog
        open={vaultPromptOpen}
        onOpenChange={(open) => {
          if (!open) {
            setVaultPromptOpen(false);
            setPendingObsidianExport(false);
          }
        }}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("obsidian.noVault")}</DialogTitle>
              <DialogDescription>{t("settings.obsidian.hint")}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <input
                autoFocus
                type="text"
                value={vaultInput}
                onChange={(e) => setVaultInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleVaultSave();
                }}
                placeholder={t("obsidian.vaultPlaceholder")}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" size="sm" />}>
                {t("toolbar.cancel")}
              </DialogClose>
              <Button type="button" variant="primary" size="sm" onClick={handleVaultSave}>
                {t("obsidian.save")}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
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
  active,
}: {
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  tooltip?: string;
  loading?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={clsx(
        "gap-1.5 px-2.5",
        active && "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      <Icon size={14} className={loading ? "animate-spin" : ""} />
      {label}
    </Button>
  );
}
