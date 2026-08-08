import React, { useState } from "react";
import {
  FileText,
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
  Sparkles,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { exportToObsidian } from "../obsidian";
import { resolveDocumentOrigin } from "./topBarAttribution";
import { isAiGenerated } from "../skills/agent-write-policy";
import { formatDisplayDateTime } from "../utils/dateFormat";
import { isImeComposing } from "../ime";


export function TopToolbar() {
  const {
    activeView,
    activeConversationId,
    activeDocId,
    documents,
    obsidianConfig,
    setObsidianConfig,
    editMode,
    setEditMode,
    previewingVersionId,
    setVersionPanelOpen,
    aiSidebarOpen,
    toggleAiSidebar,
  } = useAppContext();
  const { t, language } = useTranslation();

  const [vaultPromptOpen, setVaultPromptOpen] = useState(false);
  const [vaultInput, setVaultInput] = useState("");
  const [pendingObsidianExport, setPendingObsidianExport] = useState(false);

  const activeDoc = documents.find((d) => d.id === activeDocId);
  const isPreviewMode = !!previewingVersionId;


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
  const docOrigin = activeDoc ? resolveDocumentOrigin(activeDoc) : null;
  const originBadge =
    docOrigin === "conversation" ? (
      <Badge variant="secondary" size="sm" icon={<MessageCircle strokeWidth={2.5} />}>
        {t("doc.fromConversation", { defaultValue: "来自对话" })}
      </Badge>
    ) : docOrigin === "terminal" ? (
      <Badge variant="secondary" size="sm" icon={<Terminal strokeWidth={2.5} />}>
        {t("doc.fromTerminal", { defaultValue: "来自终端" })}
      </Badge>
    ) : docOrigin === "import" ? (
      <Badge
        variant="secondary"
        size="sm"
        icon={<Paperclip strokeWidth={2.5} />}
        title={activeDoc?.importedFrom || undefined}
      >
        {t("doc.fromImport", { defaultValue: "来自导入" })}
      </Badge>
    ) : null;

  // AI 生成的可见标记（spec agent-write-policy 风险项缓解）：与来源徽章并列，
  // 两者互补 —— 来源说「从哪来」，这个说「是 AI 写的，因此 AI 可以再改它」。
  const aiBadge = activeDoc && isAiGenerated(activeDoc) ? (
    <Badge variant="secondary" size="sm" icon={<Sparkles strokeWidth={2.5} />}>
      {t("doc.aiGenerated")}
    </Badge>
  ) : null;

  return (
    <>
      <div className="z-10 hidden min-h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-md dark:border-white/10 dark:bg-[#1A1A1A]/80 md:flex">
        {/* 双行：标题 / 更新于+来源徽章（spec content-topbar-attribution） */}
        <div className="flex min-w-0 max-w-xl flex-col gap-1 py-2">
          <span className="truncate text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {activeDoc ? activeDoc.title : ""}
          </span>
          {activeDoc && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {activeDoc.updatedAt && (
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {t("version.updatedAt", { time: formatDisplayDateTime(activeDoc.updatedAt, language) })}
                </span>
              )}
              {originBadge}
              {aiBadge}
            </div>
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
                  if (isImeComposing(e)) return;
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
      // 选中态改 primary，避免 ghost 的 hover:bg-accent 与手写 primary 类在 CSS 源序中打架，
      // 导致 hover 落到近背景的 accent（ai-sidebar 打开时「问问 AI」尤其明显）。
      variant={active ? "primary" : "ghost"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="gap-1.5 px-2.5"
    >
      <Icon size={14} className={loading ? "animate-spin" : ""} />
      {label}
    </Button>
  );
}
