import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectValueLines,
} from "@/components/ui/select";
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
import {
  Search,
  Plus,
  Moon,
  Sun,
  MoreHorizontal,
  FolderOpen,
  FolderPlus,
  Folder as FolderIcon,
  MessageSquare,
  Import,
  Trash2,
  Edit2,
  Copy,
  Download,
  FolderInput,
  FileText,
  Settings,
  CheckSquare,
  Square,
  Minus,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  LogOut,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { toast } from "sonner";
import { useAppContext, Conversation, Folder, Platform, Document, DocumentFolder, DEFAULT_DOCUMENT_PROJECT_ID } from "../data";
import {
  buildMoveTargetGroups,
  filterDocumentsByProject,
  filterFoldersByProject,
  moveGroupRowCount,
  sortDocumentsByTime,
  uncategorizedInProject,
  type MoveTargetGroup,
} from "../document-projects";
import { isAiWorkspaceFolderId, sortAiWorkspaceFirst, sortMemoryFirst } from "@/shared/ai-workspace";
import { isAiGenerated } from "../skills/agent-write-policy";
import logoUrl from "../../../assets/images/logo.png";
import logoDarkUrl from "../../../assets/images/logo_dark.png";
import { useScrollActivity } from "../hooks/useScrollActivity";
import { useIsMobile } from "../hooks/useIsMobile";
import { useTranslation } from "../i18n";

import { formatDisplayDate } from "../utils/dateFormat";
import { copyText } from "../utils/clipboard";
import { batchExportToVault, buildObsidianOpenUri } from "../obsidian";
import { isImeComposing } from "../ime";

const CONVERSATION_ITEM_TYPE = "CONVERSATION";
const DOCUMENT_ITEM_TYPE = "DOCUMENT";
const ITEM_MENU_WIDTH = 176;
const FOLDER_SUBMENU_WIDTH = 188;

type MenuPosition = { top: number; left: number; maxHeight: number };
type StoredItemType = "conversation" | "document";

/**
 * 文档的「项目 → 未分类/文件夹」两层目标树。单项移动与批量移动共用这一个 hook
 * （spec §批量移动共用目标树），杜绝两处各建一棵树而行为分叉。
 */
function useDocumentMoveGroups(): MoveTargetGroup[] {
  const { t } = useTranslation();
  const { documentFolders, documentProjects } = useAppContext();
  return useMemo(
    () => buildMoveTargetGroups({
      folders: documentFolders,
      projects: documentProjects,
      defaultProjectLabel: t("sidebar.defaultProject"),
      uncategorizedLabel: t("sidebar.uncategorized"),
    }),
    [documentFolders, documentProjects, t],
  );
}

function MoveTargetList({
  groups,
  onPick,
}: {
  groups: MoveTargetGroup[];
  onPick: (event: React.MouseEvent, folderId: string | null, projectId: string | null) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.key}>
          {group.label && (
            <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
              {group.label}
            </div>
          )}
          {group.targets.map((target) => (
            <button
              key={`${group.key}:${target.id ?? "uncategorized"}`}
              onClick={(event) => onPick(event, target.id, group.projectId)}
              className={clsx(
                "w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2",
                group.label && "pl-5",
              )}
            >
              <FolderIcon size={12} /> <span className="truncate">{target.name}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

type SelectionContextValue = {
  mode: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  // 移动端禁用 DnD 与「更多操作」入口（spec mobile-responsive US-02 AC5 / §8 风险）：
  // 通过上下文下发，避免各列表项重复调用 useIsMobile。
  isMobile: boolean;
};

const SelectionContext = createContext<SelectionContextValue>({
  mode: false,
  isSelected: () => false,
  toggle: () => {},
  isMobile: false,
});

function useSelection() {
  return useContext(SelectionContext);
}

function getMenuPosition(button: HTMLElement): MenuPosition {
  const rect = button.getBoundingClientRect();
  const top = Math.max(8, Math.min(rect.bottom - 2, window.innerHeight - 240));
  return {
    top,
    left: Math.max(8, Math.min(rect.right - ITEM_MENU_WIDTH, window.innerWidth - ITEM_MENU_WIDTH - 8)),
    maxHeight: Math.max(180, window.innerHeight - top - 8),
  };
}

function getSubmenuPosition(trigger: HTMLElement, itemCount: number): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const estimatedHeight = Math.min(260, Math.max(40, itemCount * 28 + 8));
  const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - estimatedHeight - 8));
  const opensRight = rect.right + FOLDER_SUBMENU_WIDTH + 8 <= window.innerWidth;

  return {
    top,
    left: opensRight
      ? rect.right - 2
      : Math.max(8, rect.left - FOLDER_SUBMENU_WIDTH + 2),
    maxHeight: Math.max(120, window.innerHeight - top - 8),
  };
}

function escapeFrontmatterValue(value: string): string {
  if (!value) return '""';
  if (value.includes('"') || value.includes("\n") || value.includes(":")) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function conversationToMarkdown(conversation: Conversation): string {
  const msgBlock = (conversation.messages ?? [])
    .map((message) => {
      const role = message.role === "user" ? "## User" : `## ${conversation.platform ?? "AI"}`;
      return `${role}\n\n${message.content}\n`;
    })
    .join("\n---\n\n");

  const lines = [
    `id: ${escapeFrontmatterValue(conversation.id)}`,
    `title: ${escapeFrontmatterValue(conversation.title ?? "Untitled")}`,
    `platform: ${escapeFrontmatterValue(conversation.platform ?? "ChatGPT")}`,
    `date: ${escapeFrontmatterValue(conversation.date ?? new Date().toISOString())}`,
    `folderId: ${conversation.folderId ? escapeFrontmatterValue(conversation.folderId) : "null"}`,
  ];
  if (conversation.updatedAt) lines.push(`updatedAt: ${escapeFrontmatterValue(conversation.updatedAt)}`);
  if (conversation.currentVersionId) lines.push(`currentVersionId: ${escapeFrontmatterValue(conversation.currentVersionId)}`);
  // 与 api-router.ts 的 conversationToMd 保持一致（spec conversation-project-attribution）
  if (conversation.sourceProject) lines.push(`sourceProject: ${escapeFrontmatterValue(conversation.sourceProject)}`);

  return `---\n${lines.join("\n")}\n---\n\n${msgBlock}`;
}

function documentToMarkdown(doc: Document): string {
  const lines = [
    "---",
    `id: ${escapeFrontmatterValue(doc.id)}`,
    `title: ${escapeFrontmatterValue(doc.title ?? "Untitled")}`,
    `folderId: ${doc.folderId ? escapeFrontmatterValue(doc.folderId) : "null"}`,
    `createdAt: ${escapeFrontmatterValue(doc.createdAt ?? new Date().toISOString())}`,
    `updatedAt: ${escapeFrontmatterValue(doc.updatedAt ?? new Date().toISOString())}`,
    `currentVersionId: ${escapeFrontmatterValue(doc.currentVersionId ?? "")}`,
  ];
  // 与 documentsPlugin.ts 的 documentToMd 保持一致（spec document-projects / document-ingest）
  if (doc.projectId) lines.push(`projectId: ${escapeFrontmatterValue(doc.projectId)}`);
  if (doc.externalKey) lines.push(`externalKey: ${escapeFrontmatterValue(doc.externalKey)}`);
  if (doc.ingestSource) lines.push(`ingestSource: ${escapeFrontmatterValue(doc.ingestSource)}`);
  if (doc.sourceConversationId) lines.push(`sourceConversationId: ${escapeFrontmatterValue(doc.sourceConversationId)}`);
  if (doc.sourcePlatform) lines.push(`sourcePlatform: ${escapeFrontmatterValue(doc.sourcePlatform)}`);
  if (doc.sourceAiChatId) lines.push(`sourceAiChatId: ${escapeFrontmatterValue(doc.sourceAiChatId)}`);
  if (doc.generatedBy) lines.push(`generatedBy: ${escapeFrontmatterValue(doc.generatedBy)}`);
  if (doc.generatedAt) lines.push(`generatedAt: ${escapeFrontmatterValue(doc.generatedAt)}`);
  if (doc.importedFrom) lines.push(`importedFrom: ${escapeFrontmatterValue(doc.importedFrom)}`);
  if (doc.importedAt) lines.push(`importedAt: ${escapeFrontmatterValue(doc.importedAt)}`);
  lines.push("---", "", doc.body ?? "");
  return lines.join("\n");
}

function downloadMarkdownFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fetchStoragePath(type: StoredItemType, id: string): Promise<string> {
  const res = await fetch(`/api/storage-paths/${type}/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Storage path request failed: ${res.status}`);
  const data = (await res.json()) as { path: string };
  return data.path;
}

function ItemActionMenu({
  menuPosition,
  moveGroups,
  onRename,
  onMove,
  onCopyPath,
  onDownloadMarkdown,
  onUploadUpdate,
  onDelete,
}: {
  menuPosition: MenuPosition;
  moveGroups: MoveTargetGroup[];
  onRename: (event: React.MouseEvent) => void;
  onMove: (folderId: string | null, projectId: string | null) => void;
  onCopyPath: (event: React.MouseEvent) => void;
  onDownloadMarkdown: (event: React.MouseEvent) => void;
  onUploadUpdate?: (event: React.MouseEvent) => void;
  onDelete: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuPosition, setSubmenuPosition] = useState<MenuPosition | null>(null);

  const showSubmenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSubmenuPosition(getSubmenuPosition(event.currentTarget, moveGroupRowCount(moveGroups)));
    setSubmenuOpen(true);
  };

  const handleMove = (event: React.MouseEvent, folderId: string | null, projectId: string | null) => {
    event.stopPropagation();
    onMove(folderId, projectId);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1 }}
        style={{ top: menuPosition.top, left: menuPosition.left, width: ITEM_MENU_WIDTH, maxHeight: menuPosition.maxHeight }}
        className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-30 overflow-y-auto custom-scrollbar"
      >
        <button
          onMouseEnter={() => setSubmenuOpen(false)}
          onClick={onRename}
          className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
        >
          <Edit2 size={12} /> {t("sidebar.menuRename")}
        </button>
        <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />
        <button
          onMouseEnter={showSubmenu}
          onClick={showSubmenu}
          className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
          aria-haspopup="menu"
          aria-expanded={submenuOpen}
        >
          <FolderInput size={12} />
          <span className="min-w-0 flex-1 truncate">{t("sidebar.menuMove")}</span>
          <ChevronRight size={12} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
        </button>
        <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />
        <button
          onMouseEnter={() => setSubmenuOpen(false)}
          onClick={onCopyPath}
          className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
        >
          <Copy size={12} /> {t("sidebar.menuCopyPath")}
        </button>
        <button
          onMouseEnter={() => setSubmenuOpen(false)}
          onClick={onDownloadMarkdown}
          className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
        >
          <Download size={12} /> {t("sidebar.menuDownloadMd")}
        </button>
        {onUploadUpdate && (
          <button
            onMouseEnter={() => setSubmenuOpen(false)}
            onClick={onUploadUpdate}
            className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
          >
            <Upload size={12} /> {t("sidebar.menuUploadUpdate")}
          </button>
        )}
        <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />
        <button
          onMouseEnter={() => setSubmenuOpen(false)}
          onClick={onDelete}
          className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2"
        >
          <Trash2 size={12} /> {t("sidebar.menuDelete")}
        </button>
      </motion.div>

      <AnimatePresence>
        {submenuOpen && submenuPosition && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{ top: submenuPosition.top, left: submenuPosition.left, width: FOLDER_SUBMENU_WIDTH, maxHeight: submenuPosition.maxHeight }}
            className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-30 overflow-y-auto custom-scrollbar"
          >
            <MoveTargetList groups={moveGroups} onPick={handleMove} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FolderManagementMenu({
  menuPosition,
  onRename,
  onDelete,
}: {
  menuPosition: MenuPosition;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.1 }}
      style={{ top: menuPosition.top, left: menuPosition.left, width: ITEM_MENU_WIDTH, maxHeight: menuPosition.maxHeight }}
      className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-30 overflow-y-auto custom-scrollbar"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
      >
        <Edit2 size={12} /> {t("sidebar.menuRename")}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2"
      >
        <Trash2 size={12} /> {t("sidebar.menuDelete")}
      </button>
    </motion.div>
  );
}

function RenameModal({
  isOpen,
  title,
  initialValue,
  placeholder,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  initialValue: string;
  placeholder: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [initialValue, isOpen]);

  const submitRename = () => {
    const nextValue = value.trim();
    if (nextValue) {
      onSubmit(nextValue);
    }
    onClose();
  };

  // Portal content still participates in React tree bubbling (not DOM tree).
  // These modals render under ConversationItem/DocumentItem which have root onClick —
  // without stopPropagation, cancel/confirm/backdrop clicks re-fire item activation.
  const stopPortalBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogBackdrop onClick={stopPortalBubble} />
        <DialogPopup className="max-w-sm" onClick={stopPortalBubble}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") submitRename();
              }}
              placeholder={placeholder}
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" />}>
              {t("sidebar.cancel")}
            </DialogClose>
            <Button type="button" variant="primary" size="sm" onClick={submitRename}>
              {t("sidebar.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

/**
 * 项目编辑弹窗（spec document-projects §项目重命名与身份稳定性 / §项目描述可编辑）：
 * 名称与描述在同一处改完 —— 两者都是纯展示字段，拆成两个入口只是给用户添麻烦。
 * `sourceKey` 不在这里、也不该在任何界面出现：它一变，全部文档就失去身份。
 */
function ProjectEditModal({
  isOpen,
  mode = "edit",
  initialName,
  initialDescription,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  /** create：名称必填，提交被服务端拒绝（重名）时留在弹窗里报错，不静默关闭。 */
  mode?: "edit" | "create";
  initialName: string;
  initialDescription: string;
  onClose: () => void;
  onSubmit: (patch: { name: string; description: string }) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const isCreate = mode === "create";
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setDescription(initialDescription);
      setError(null);
    }
  }, [initialDescription, initialName, isOpen]);

  const submit = async () => {
    const nextName = name.trim();
    // 新建时名称必填；改名时留空视为不改（项目总得有个名字）。描述两种模式都可清空。
    if (isCreate && !nextName) return;
    try {
      setError(null);
      await onSubmit({ name: nextName || initialName, description: description.trim() });
      onClose();
    } catch {
      setError(t("sidebar.newProjectFailed"));
    }
  };

  const stopPortalBubble = (e: React.MouseEvent) => e.stopPropagation();
  const inputClass =
    "w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogBackdrop onClick={stopPortalBubble} />
        <DialogPopup className="max-w-sm" onClick={stopPortalBubble}>
          <DialogHeader>
            <DialogTitle>{isCreate ? t("sidebar.newProject") : t("sidebar.editProject")}</DialogTitle>
            <DialogDescription>{isCreate ? t("sidebar.newProjectHint") : t("sidebar.editProjectHint")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="project-name">
                  {t("sidebar.projectName")}
                </label>
                <input
                  id="project-name"
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Enter") void submit(); }}
                  placeholder={t("sidebar.projectName")}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="project-description">
                  {t("sidebar.projectDescription")}
                </label>
                <input
                  id="project-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Enter") void submit(); }}
                  placeholder={t("sidebar.projectDescription")}
                  className={inputClass}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" />}>
              {t("sidebar.cancel")}
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isCreate && !name.trim()}
              onClick={() => void submit()}
            >
              {isCreate ? t("sidebar.create") : t("sidebar.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function ConfirmDeleteModal({
  isOpen,
  title,
  message,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const confirmDelete = () => {
    onConfirm();
    onClose();
  };

  const stopPortalBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogBackdrop onClick={stopPortalBubble} />
        <DialogPopup className="max-w-sm" onClick={stopPortalBubble}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="leading-6">{message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" />}>
              {t("sidebar.cancel")}
            </DialogClose>
            <Button type="button" variant="danger" size="sm" onClick={confirmDelete}>
              {t("sidebar.menuDelete")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

export function Sidebar() {
  const {
    theme,
    setTheme,
    setDrawerOpen,
    setSearchOpen,
    folders,
    conversations,
    addFolder,
    language,
    setLanguage,
    activeView,
    setActiveView,
    documents,
    documentFolders,
    documentProjects,
    activeProjectId,
    addDocumentFolder,
    setSettingsOpen,
    activeConversationId,
    setActiveConversationId,
    deleteConversation,
    moveConversation,
    activeDocId,
    setActiveDocId,
    deleteDocument,
    moveDocument,
    obsidianConfig,
    mobileNavOpen,
    setMobileNavOpen,
  } = useAppContext();

  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // 移动端：选中条目后侧栏抽屉自动收起（spec US-02 AC2）。activeId 变化即视为完成选择。
  useEffect(() => {
    if (isMobile) setMobileNavOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, activeDocId]);

  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // ── Batch selection state ──
  // 切换 view 会自动清空，因此一个 Set 同时承载两种视图也够用 — 但语义上仍按视图隔离
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchMoveMenu, setBatchMoveMenu] = useState<MenuPosition | null>(null);
  // 折叠状态提升到 Sidebar，让 selectAll 能准确计算"当前可见叶子" (spec US-02.3)
  const [chatFolderOpen, setChatFolderOpen] = useState<Record<string, boolean>>({});
  const [docFolderOpen, setDocFolderOpen] = useState<Record<string, boolean>>({});
  const { isScrolling: isListScrolling, markScrollActive: markListScrollActive } = useScrollActivity();

  const platformOptions: Platform[] = ["ChatGPT", "DeepSeek", "Gemini", "Claude", "CLI", "Cursor", "Copilot", "Codex", "Hermes"];

  // 会话按原平台发起时间排序，默认正序（spec conversation-time-and-sort US-03）
  const [convSortAsc, setConvSortAsc] = useState<boolean>(
    () => localStorage.getItem("pentou-conv-sort") !== "desc",
  );
  const toggleConvSort = () => {
    setConvSortAsc((prev) => {
      localStorage.setItem("pentou-conv-sort", prev ? "desc" : "asc");
      return !prev;
    });
  };

  // 文档按时间排序，与会话列表同一套交互；口径是文档的更新时间（对话没有"更新"，文档有）
  const [docSortAsc, setDocSortAsc] = useState<boolean>(
    () => localStorage.getItem("pentou-doc-sort") !== "desc",
  );
  const toggleDocSort = () => {
    setDocSortAsc((prev) => {
      localStorage.setItem("pentou-doc-sort", prev ? "desc" : "asc");
      return !prev;
    });
  };

  // 搜索已统一收敛到命令面板浮层（spec hybrid-search US-01 AC4）；
  // 侧栏列表不再按 searchQuery 实时过滤，直接展示全量。
  const filteredConversations = useMemo(() => {
    const dir = convSortAsc ? 1 : -1;
    return [...conversations].sort((a, b) => {
      const ta = new Date(a.date ?? "").getTime();
      const tb = new Date(b.date ?? "").getTime();
      const va = Number.isNaN(ta) ? 0 : ta;
      const vb = Number.isNaN(tb) ? 0 : tb;
      // 同时间以标题稳定兜底，避免抖动（spec §5 边界 2）
      if (va === vb) return (a.title ?? "").localeCompare(b.title ?? "");
      return (va - vb) * dir;
    });
  }, [conversations, convSortAsc]);
  // 文档按当前项目过滤（spec document-projects §切换项目过滤列表）：
  // projectId 为空 = 默认目录，其余按项目 id 精确匹配。排序与会话列表同口径：
  // 时间相同以标题稳定兜底，避免同一秒批量入库的文档在列表里抖动。
  const filteredDocuments = useMemo(
    () => sortDocumentsByTime(filterDocumentsByProject(documents, activeProjectId), docSortAsc),
    [documents, activeProjectId, docSortAsc],
  );
  const projectFolders = useMemo(
    () => filterFoldersByProject(documentFolders, activeProjectId),
    [documentFolders, activeProjectId],
  );

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBatchMoveMenu(null);
  };

  const enterSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(true);
  };

  const selectionValue: SelectionContextValue = useMemo(
    () => ({
      mode: selectionMode,
      isSelected: (id: string) => selectedIds.has(id),
      toggle: (id: string) =>
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      isMobile,
    }),
    [selectionMode, selectedIds, isMobile]
  );

  // 当前视图可见叶子 id（受搜索 + 文件夹折叠影响）
  const visibleLeafIds = useMemo(() => {
    if (activeView === "chat") {
      const folderIds = new Set(folders.map((f) => f.id));
      const ids: string[] = [];
      for (const c of filteredConversations) {
        if (!c.folderId || !folderIds.has(c.folderId)) {
          ids.push(c.id);
        } else if (chatFolderOpen[c.folderId] ?? false) {
          ids.push(c.id);
        }
      }
      return ids;
    } else {
      const folderIds = new Set(projectFolders.map((f) => f.id));
      const ids: string[] = [];
      for (const d of filteredDocuments) {
        if (!d.folderId || !folderIds.has(d.folderId)) {
          ids.push(d.id);
        } else if (docFolderOpen[d.folderId] ?? false) {
          ids.push(d.id);
        }
      }
      return ids;
    }
  }, [activeView, folders, projectFolders, filteredConversations, filteredDocuments, chatFolderOpen, docFolderOpen]);

  const selectAllState: "none" | "partial" | "all" = (() => {
    if (visibleLeafIds.length === 0 || selectedIds.size === 0) return "none";
    const allSelected = visibleLeafIds.every((id) => selectedIds.has(id));
    if (allSelected) return "all";
    const someSelected = visibleLeafIds.some((id) => selectedIds.has(id));
    return someSelected ? "partial" : "none";
  })();

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = visibleLeafIds.length > 0 && visibleLeafIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleLeafIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleLeafIds) next.add(id);
      return next;
    });
  };

  const handleTabClick = (view: typeof activeView) => {
    if (selectionMode) exitSelection();
    setActiveView(view);
  };

  const handleNewFolder = () => {
    setIsNewFolderModalOpen(true);
    setNewFolderName("");
  };

  const submitNewFolder = () => {
    const folderName = newFolderName.trim();
    if (folderName) {
      if (activeView === "doc") {
        addDocumentFolder(folderName);
      } else {
        const matchedPlatform = platformOptions.find(p => p.toLowerCase() === folderName.toLowerCase());
        addFolder(folderName, matchedPlatform);
      }
    }
    setIsNewFolderModalOpen(false);
  };

  // 批量删除：依次调用单项 API；活跃项若被删则清空
  const runBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (activeView === "chat") {
      for (const id of ids) {
        try { await deleteConversation(id); }
        catch (e) { console.error({ module: "Sidebar", op: "batchDeleteConv", id, err: e }); }
      }
      if (activeConversationId && ids.includes(activeConversationId)) {
        setActiveConversationId(null);
      }
    } else {
      for (const id of ids) {
        try { await deleteDocument(id); }
        catch (e) { console.error({ module: "Sidebar", op: "batchDeleteDoc", id, err: e }); }
      }
      if (activeDocId && ids.includes(activeDocId)) {
        setActiveDocId(null);
      }
    }
    exitSelection();
  };

  const runBatchMove = async (folderId: string | null, projectId: string | null) => {
    const ids = Array.from(selectedIds);
    if (activeView === "chat") {
      for (const id of ids) {
        try { await moveConversation(id, folderId); }
        catch (e) { console.error({ module: "Sidebar", op: "batchMoveConv", id, folderId, err: e }); }
      }
    } else {
      for (const id of ids) {
        try { await moveDocument(id, folderId, projectId); }
        catch (e) { console.error({ module: "Sidebar", op: "batchMoveDoc", id, folderId, projectId, err: e }); }
      }
    }
    exitSelection();
  };

  // 批量导出到 Obsidian：顺序循环单篇直写，打开第一篇成功文档（spec obsidian-vault-export US-04）
  const runBatchObsidianExport = async () => {
    if (!obsidianConfig.vaultPath || !obsidianConfig.vaultName) {
      toast.error(t("sidebar.obsidianNeedVault"));
      setSettingsOpen(true);
      return;
    }
    // 按侧栏显示顺序导出（spec §4.5 决策 7）；逐篇取服务端全文，见 batchExportToVault 注释
    const ordered = filteredDocuments.filter((d) => selectedIds.has(d.id));
    const { succeeded, failed } = await batchExportToVault(ordered, {
      vaultName: obsidianConfig.vaultName,
      vaultPath: obsidianConfig.vaultPath,
    });
    for (const f of failed) {
      console.error({ module: "Sidebar", op: "batchObsidianExport", id: f.id, err: f.error });
    }
    if (failed.length === 0) {
      toast.success(t("sidebar.obsidianBatchDone", { n: succeeded.length }));
    } else {
      toast.error(t("sidebar.obsidianBatchPartial", { ok: succeeded.length, fail: failed.length, titles: failed.map((f) => f.title).join(", ") }));
    }
    if (succeeded.length > 0) {
      window.open(buildObsidianOpenUri(obsidianConfig.vaultName, succeeded[0].fileName), "_self");
    }
    exitSelection();
  };

  // 对话视图仍是扁平的对话文件夹列表（无 label → 无分组标题），两条路径显式分开
  const docMoveGroups = useDocumentMoveGroups();
  const moveGroups: MoveTargetGroup[] =
    activeView === "chat"
      ? [{
          key: "chat",
          projectId: null,
          targets: [{ id: null, name: t("sidebar.uncategorized") }, ...folders.map((f) => ({ id: f.id, name: f.name }))],
        }]
      : docMoveGroups;

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;
  const areAllChatFoldersOpen = folders.length > 0 && folders.every((folder) => chatFolderOpen[folder.id] ?? false);

  const toggleAllChatFolders = () => {
    const nextOpen = !areAllChatFoldersOpen;
    setChatFolderOpen(Object.fromEntries(folders.map((folder) => [folder.id, nextOpen])));
  };

  return (
    <SelectionContext.Provider value={selectionValue}>
    {/* 移动端遮罩：点击关抽屉（spec US-02 AC3）。桌面不渲染。 */}
    {isMobile && mobileNavOpen && (
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
        onClick={() => setMobileNavOpen(false)}
      />
    )}
    <div
      onKeyDown={(e) => {
        if (isMobile && e.key === "Escape") setMobileNavOpen(false);
      }}
      className={clsx(
        "bg-[#FAFAFA] dark:bg-[#151515] border-r border-zinc-200 dark:border-white/10 flex flex-col z-50",
        isMobile
          ? clsx(
              "fixed inset-y-0 left-0 w-[85vw] max-w-xs transition-transform duration-300 ease-out will-change-transform",
              mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full pointer-events-none",
            )
          : "w-72 h-full shrink-0",
      )}
    >
      {/* Header */}
      <div className="p-4 flex flex-col gap-4 border-b border-zinc-200 dark:border-white/10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-white font-semibold text-lg group cursor-pointer">
            <img src={theme === "dark" ? logoDarkUrl : logoUrl} alt="PenTou Logo" className="w-6 h-6 object-contain" />
            <span className="group-hover:text-foreground transition-colors">PenTou</span>
          </div>
          <div className="flex items-center gap-1">
            <IconTooltip label={t("toolbar.settings")}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={18} />
              </Button>
            </IconTooltip>
            <IconTooltip label={t("toolbar.logout")}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                onClick={async () => {
                  try {
                    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                  } catch { /* dev mode has no logout endpoint; fall through to redirect */ }
                  window.location.href = "/login";
                }}
              >
                <LogOut size={18} />
              </Button>
            </IconTooltip>
            {isMobile && (
              <IconTooltip label={t("mobile.closeMenu")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <X size={18} />
                </Button>
              </IconTooltip>
            )}
          </div>
        </div>

        {/* View Tabs + inline Search button (spec hybrid-search US-01; tabs-primitive segmented) */}
        <div className="flex items-center gap-2">
          <Tabs
            value={activeView}
            onValueChange={(v) => handleTabClick(v as typeof activeView)}
            className="min-w-0 flex-1 gap-0"
          >
            <TabsList variant="segmented" className="h-auto w-full">
              <TabsTrigger value="chat" className="flex-1 py-1.5 text-xs">
                {t("sidebar.tab.chat")}
              </TabsTrigger>
              <TabsTrigger value="doc" className="flex-1 py-1.5 text-xs">
                {t("sidebar.tab.doc")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <IconTooltip label={t("search.button")}>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
            </Button>
          </IconTooltip>
        </div>

        {/* Primary action: Import (elevated full-width surface pill).
            移动端隐藏：导入入口移至 MobileTopBar 右侧（spec US-02 AC4 / US-03 AC1）。 */}
        {!isMobile && (
          <Button
            variant="surface"
            className="w-full gap-1.5 font-semibold"
            onClick={() => setDrawerOpen(true)}
            disabled={selectionMode}
          >
            <Import size={16} /> {t("sidebar.import")}
          </Button>
        )}
      </div>

      {/* 项目选择器固定在列表**之外**：列表滚动时它不跟着走（spec §项目切换选择器） */}
      {activeView === "doc" && <ProjectSwitcher />}

      {/* Lists */}
      <div
        className={clsx(
          // No vertical padding: sticky headers must flush to the scrollport top.
          // Horizontal inset stays via px-2; sticky rows bleed with -mx-2 + matching px.
          "flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 custom-scrollbar subtle-scrollbar space-y-1",
          isListScrolling && "subtle-scrollbar-active",
        )}
        onScroll={markListScrollActive}
      >
        {activeView === "chat" ? (
          <>
            <div className="mt-2 mb-4">
              <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between gap-2 bg-[#FAFAFA] px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:bg-[#151515] dark:text-zinc-500">
                <span>{t("sidebar.folders")}</span>
                <div className="flex items-center">
                  {/* 新建文件夹在移动端隐藏：其弹窗为桌面态居中模态，未适配触屏（US 调整批次 issue 3） */}
                  {!isMobile && (
                    <IconTooltip label={t("sidebar.newFolder")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleNewFolder}
                        disabled={selectionMode}
                        className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                      >
                        <FolderPlus size={14} />
                      </Button>
                    </IconTooltip>
                  )}
                  <IconTooltip label={convSortAsc ? t("sidebar.sortNewestFirst") : t("sidebar.sortOldestFirst")}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={toggleConvSort}
                      className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                    >
                      {convSortAsc ? <ArrowUpNarrowWide size={14} /> : <ArrowDownNarrowWide size={14} />}
                    </Button>
                  </IconTooltip>
                  {folders.length > 0 && (
                    <IconTooltip label={areAllChatFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleAllChatFolders}
                        className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                      >
                        {areAllChatFoldersOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                      </Button>
                    </IconTooltip>
                  )}
                </div>
              </div>
              <div className="space-y-0.5">
                {folders.length === 0 ? (
                  <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty")}</div>
                ) : (
                  folders.map((folder) => (
                    <FolderItem
                      key={folder.id}
                      folder={folder}
                      conversations={filteredConversations.filter((c) => c.folderId === folder.id)}
                      isOpen={chatFolderOpen[folder.id] ?? false}
                      onToggleOpen={() =>
                        setChatFolderOpen((prev) => ({ ...prev, [folder.id]: !(prev[folder.id] ?? false) }))
                      }
                    />
                  ))
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="sticky top-0 z-10 -mx-2 bg-[#FAFAFA] px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:bg-[#151515] dark:text-zinc-500">
                {t("sidebar.uncategorized")}
              </div>
              <ConversationUncategorizedList conversations={filteredConversations.filter((c) => !c.folderId)} />
            </div>
          </>
        ) : (
          <DocumentList
            documents={filteredDocuments}
            folderOpen={docFolderOpen}
            onNewFolder={handleNewFolder}
            newFolderDisabled={selectionMode}
            hideNewFolder={isMobile}
            sortAsc={docSortAsc}
            onToggleSort={toggleDocSort}
            onToggleAllFolders={() => {
              const areAllOpen = projectFolders.length > 0 && projectFolders.every((folder) => docFolderOpen[folder.id] ?? false);
              const nextOpen = !areAllOpen;
              setDocFolderOpen(Object.fromEntries(projectFolders.map((folder) => [folder.id, nextOpen])));
            }}
            onToggleFolderOpen={(id) =>
              setDocFolderOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))
            }
          />
        )}
      </div>

      {/* Batch Select (entry button OR toolbar).
          移动端隐藏：不进入批量选择态（spec US-02 AC5）。 */}
      {!isMobile && (
      <div className="shrink-0 p-3 border-t border-zinc-200 dark:border-white/10">
        {!selectionMode ? (
          <Button
            variant="ghost"
            onClick={enterSelection}
            className="w-full gap-2 text-muted-foreground"
          >
            <CheckSquare size={16} />
            {t("sidebar.multiSelect")}
          </Button>
        ) : (
          <BatchToolbar
            selectedCount={selectedCount}
            hasSelection={hasSelection}
            selectAllState={selectAllState}
            visibleCount={visibleLeafIds.length}
            onToggleSelectAll={toggleSelectAll}
            onMoveClick={(e) => {
              if (!hasSelection) return;
              setBatchMoveMenu(getMenuPosition(e.currentTarget));
            }}
            onDeleteClick={() => {
              if (!hasSelection) return;
              setBatchDeleteOpen(true);
            }}
            showObsidian={activeView === "doc"}
            onObsidianClick={() => {
              if (!hasSelection) return;
              runBatchObsidianExport();
            }}
            onCancel={exitSelection}
          />
        )}
      </div>
      )}

      {/* Batch Move target menu (复用 ItemActionMenu 的 submenu 风格) */}
      <AnimatePresence>
        {batchMoveMenu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setBatchMoveMenu(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{ top: batchMoveMenu.top, left: batchMoveMenu.left, width: FOLDER_SUBMENU_WIDTH, maxHeight: batchMoveMenu.maxHeight }}
              className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-30 overflow-y-auto custom-scrollbar"
            >
              <MoveTargetList
                groups={moveGroups}
                onPick={(_event, folderId, projectId) => {
                  setBatchMoveMenu(null);
                  runBatchMove(folderId, projectId);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Batch delete confirmation */}
      <ConfirmDeleteModal
        isOpen={batchDeleteOpen}
        title={t("sidebar.deleteBatchTitle")}
        message={t(
          activeView === "chat" ? "sidebar.deleteConvBatchPrompt" : "sidebar.deleteDocBatchPrompt",
          { n: selectedCount }
        )}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={runBatchDelete}
      />

      {/* New Folder Modal */}
      <AnimatePresence>
        {isNewFolderModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewFolderModalOpen(false)}
              className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-2xl rounded-xl p-5 overflow-hidden z-10"
            >
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">{t("sidebar.newFolder")}</h3>
              <input
                autoFocus
                list={activeView === "chat" ? "platform-options" : undefined}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === "Enter") submitNewFolder();
                  if (e.key === "Escape") setIsNewFolderModalOpen(false);
                }}
                placeholder={t("sidebar.folderName")}
                className="w-full bg-zinc-50 dark:bg-[#151515] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all mb-6"
              />
              {activeView === "chat" && (
                <datalist id="platform-options">
                  {platformOptions.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsNewFolderModalOpen(false)}>
                  {t("sidebar.cancel")}
                </Button>
                <Button variant="primary" className="shadow-sm" onClick={submitNewFolder}>
                  {t("sidebar.create")}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </SelectionContext.Provider>
  );
}

function BatchToolbar({
  selectedCount,
  hasSelection,
  selectAllState,
  visibleCount,
  onToggleSelectAll,
  onMoveClick,
  onDeleteClick,
  showObsidian,
  onObsidianClick,
  onCancel,
}: {
  selectedCount: number;
  hasSelection: boolean;
  selectAllState: "none" | "partial" | "all";
  visibleCount: number;
  onToggleSelectAll: () => void;
  onMoveClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onDeleteClick: () => void;
  showObsidian: boolean;
  onObsidianClick: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const Icon =
    selectAllState === "all" ? CheckSquare : selectAllState === "partial" ? Minus : Square;
  const moveLabel = t("sidebar.moveTo", { n: selectedCount });
  const deleteLabel = t("sidebar.deleteN", { n: selectedCount });
  const obsidianLabel = t("sidebar.obsidianExport");
  const exitLabel = t("sidebar.exitSelect");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
        <button
          onClick={onToggleSelectAll}
          disabled={visibleCount === 0}
          className="flex items-center gap-1.5 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("sidebar.selectAll")}
        >
          <Icon size={14} className={clsx(selectAllState !== "none" && "text-primary")} />
          <span>{t("sidebar.selectAll")}</span>
        </button>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {t("sidebar.selectedN", { n: selectedCount })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <IconTooltip label={moveLabel}>
          <Button
            variant="outline"
            size="icon"
            onClick={onMoveClick}
            disabled={!hasSelection}
            className="size-8"
          >
            <FolderInput size={14} />
          </Button>
        </IconTooltip>
        {showObsidian && (
          <IconTooltip label={obsidianLabel}>
            <Button
              variant="outline"
              size="icon"
              onClick={onObsidianClick}
              disabled={!hasSelection}
              className="size-8"
            >
              <Send size={14} />
            </Button>
          </IconTooltip>
        )}
        <IconTooltip label={deleteLabel}>
          <Button
            variant="outline"
            size="icon"
            onClick={onDeleteClick}
            disabled={!hasSelection}
            className="size-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={14} />
          </Button>
        </IconTooltip>
        <IconTooltip label={exitLabel}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="size-8 text-muted-foreground"
          >
            <X size={14} />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}

function FolderItem({
  folder,
  conversations,
  isOpen,
  onToggleOpen,
}: {
  folder: Folder;
  conversations: Conversation[];
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const { moveConversation, renameFolder, deleteFolder } = useAppContext();
  const { mode: selectionMode, isMobile } = useSelection();
  const dndDisabled = selectionMode || isMobile;
  const isAiWorkspace = isAiWorkspaceFolderId(folder.id);

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: CONVERSATION_ITEM_TYPE,
      canDrop: () => !dndDisabled,
      drop: (item: { id: string }) => {
        if (dndDisabled) return;
        moveConversation(item.id, folder.id);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !dndDisabled,
      }),
    }),
    [dndDisabled, folder.id, moveConversation]
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    if (selectionMode || isMobile || isAiWorkspace) return;
    e.preventDefault();
    setMenuPosition({
      top: Math.max(8, Math.min(e.clientY, window.innerHeight - 240)),
      left: Math.max(8, Math.min(e.clientX, window.innerWidth - ITEM_MENU_WIDTH - 8)),
      maxHeight: Math.max(180, window.innerHeight - e.clientY - 8),
    });
    setMenuOpen(true);
  };

  const handleRenameFolder = () => {
    setRenameOpen(true);
    setMenuOpen(false);
  };

  const handleDeleteFolder = () => {
    setDeleteOpen(true);
    setMenuOpen(false);
  };

  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuPosition(getMenuPosition(e.currentTarget));
    setMenuOpen(true);
  };

  return (
    <div ref={drop} className="mb-2" onMouseLeave={() => setMenuOpen(false)}>
      <div
        onContextMenu={handleContextMenu}
        className={clsx(
          "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors group",
          isOver
            ? "bg-accent border border-border"
            : "hover:bg-zinc-100 dark:hover:bg-white/5 border border-transparent text-zinc-700 dark:text-zinc-300"
        )}
        title={selectionMode || isMobile ? undefined : t("sidebar.rightClick")}
      >
        <button
          onClick={onToggleOpen}
          className="min-w-0 flex-1 flex items-center gap-2 truncate text-left"
        >
          {isOpen ? (
            <FolderOpen
              size={16}
              className={clsx("text-zinc-400", isOver && "text-primary")}
            />
          ) : (
            <FolderIcon
              size={16}
              className={clsx("text-zinc-400", isOver && "text-primary")}
            />
          )}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 ml-1">
            {conversations.length}
          </span>
        </button>
        {!selectionMode && !isMobile && !isAiWorkspace && (
          <IconTooltip label={t("sidebar.moreActions")}>
            <button
              onClick={toggleMenu}
              className={clsx(
                "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </IconTooltip>
        )}
      </div>

      <AnimatePresence>
        {menuOpen && menuPosition && (
          <FolderManagementMenu
            menuPosition={menuPosition}
            onRename={handleRenameFolder}
            onDelete={handleDeleteFolder}
          />
        )}
      </AnimatePresence>

      <RenameModal
        isOpen={renameOpen}
        title={t("sidebar.renameFolderTitle")}
        initialValue={folder.name}
        placeholder={t("sidebar.folderName")}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => renameFolder(folder.id, name)}
      />

      <ConfirmDeleteModal
        isOpen={deleteOpen}
        title={t("sidebar.deleteFolderTitle")}
        message={t("sidebar.deleteFolderPrompt")}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteFolder(folder.id)}
      />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={{ duration: 0.2 }}
            className="pl-2 mt-0.5 space-y-0.5 border-l border-zinc-200 dark:border-white/10 ml-3"
          >
            {conversations.length === 0 ? (
              <div className="px-4 py-2 text-xs text-zinc-400 italic">
                {t("sidebar.empty")}
              </div>
            ) : (
              conversations.map((conv) => (
                <ConversationItem key={conv.id} conversation={conv} />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConversationUncategorizedList({ conversations }: { conversations: Conversation[] }) {
  const { t } = useTranslation();
  const { moveConversation } = useAppContext();
  const { mode: selectionMode, isMobile } = useSelection();
  const dndDisabled = selectionMode || isMobile;

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: CONVERSATION_ITEM_TYPE,
      canDrop: () => !dndDisabled,
      drop: (item: { id: string }) => {
        if (dndDisabled) return;
        moveConversation(item.id, null);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !dndDisabled,
      }),
    }),
    [dndDisabled, moveConversation]
  );

  return (
    <div
      ref={drop}
      className={clsx(
        "space-y-0.5 rounded-lg transition-colors",
        isOver && "bg-accent ring-1 ring-ring"
      )}
    >
      {conversations.length === 0 ? (
        <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty")}</div>
      ) : (
        conversations.map((conv) => (
          <ConversationItem key={conv.id} conversation={conv} />
        ))
      )}
    </div>
  );
}

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const { t, language } = useTranslation();
  const { activeConversationId, setActiveConversationId, deleteConversation, renameConversation, moveConversation, folders } =
    useAppContext();
  const { mode: selectionMode, isSelected, toggle, isMobile } = useSelection();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const isActive = activeConversationId === conversation.id;
  const checked = isSelected(conversation.id);

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: CONVERSATION_ITEM_TYPE,
      item: { id: conversation.id },
      canDrag: () => !selectionMode && !isMobile,
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [selectionMode, isMobile, conversation.id]
  );

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteOpen(true);
    setMenuOpen(false);
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setRenameOpen(true);
  };

  const handleMove = (folderId: string | null) => {
    moveConversation(conversation.id, folderId);
    setMenuOpen(false);
  };

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      const storagePath = await fetchStoragePath("conversation", conversation.id);
      if (await copyText(storagePath)) toast.success(t("sidebar.pathCopied"));
      else toast.error(t("sidebar.pathCopyFailed"));
    } catch (error) {
      console.error({ module: "Sidebar", op: "copyConversationPath", err: error, context: { id: conversation.id } });
      toast.error(t("sidebar.pathCopyFailed"));
    }
  };

  const handleDownloadMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    downloadMarkdownFile(`${conversation.id}.md`, conversationToMarkdown(conversation));
  };

  // 对话视图只有对话文件夹，且不带分组标题 —— 与文档的项目维度显式隔离
  const moveGroups: MoveTargetGroup[] = [{
    key: "chat",
    projectId: null,
    targets: [
      { id: null, name: t("sidebar.uncategorized") },
      ...folders.map((folder) => ({ id: folder.id, name: folder.name })),
    ],
  }];

  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuPosition(getMenuPosition(e.currentTarget));
    setMenuOpen(true);
  };

  return (
    <div
      ref={drag}
      onClick={() => {
        if (selectionMode) toggle(conversation.id);
        else setActiveConversationId(conversation.id);
      }}
      onMouseLeave={() => setMenuOpen(false)}
      className={clsx(
        "group relative flex flex-col justify-center px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors border",
        isDragging ? "opacity-40" : "opacity-100",
        selectionMode && checked
          ? "bg-accent border-border text-zinc-900 dark:text-white"
          : !selectionMode && isActive
            ? "bg-white dark:bg-[#2C2C2E] border-zinc-200 dark:border-white/10 shadow-sm text-zinc-900 dark:text-white"
            : "border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2 truncate pr-6">
          {selectionMode && (
            checked
              ? <CheckSquare size={14} className="text-primary shrink-0" />
              : <Square size={14} className="text-zinc-400 shrink-0" />
          )}
          <PlatformIcon platform={conversation.platform} />
          <span className="truncate font-medium">{conversation.title}</span>
        </div>

        {/* Floating Menu Trigger (hidden in selection mode / on mobile) */}
        {!selectionMode && !isMobile && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "absolute right-2 p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
            )}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        <span>{formatDisplayDate(conversation.date, language)}</span>
        <span>•</span>
        <span>{Math.floor((conversation.messageCount ?? conversation.messages.length) / 2)} {t("sidebar.turns")}</span>
      </div>

      <AnimatePresence>
        {menuOpen && menuPosition && !selectionMode && (
          <ItemActionMenu
            menuPosition={menuPosition}
            moveGroups={moveGroups}
            onRename={handleRename}
            onMove={handleMove}
            onCopyPath={handleCopyPath}
            onDownloadMarkdown={handleDownloadMarkdown}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>

      <RenameModal
        isOpen={renameOpen}
        title={t("sidebar.renameConversationTitle")}
        initialValue={conversation.title}
        placeholder={t("sidebar.conversationTitle")}
        onClose={() => setRenameOpen(false)}
        onSubmit={(title) => renameConversation(conversation.id, title)}
      />

      <ConfirmDeleteModal
        isOpen={deleteOpen}
        title={t("sidebar.deleteConversationTitle")}
        message={t("sidebar.deleteConvPrompt")}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteConversation(conversation.id)}
      />
    </div>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  return <MessageSquare size={14} className="shrink-0 text-zinc-500 dark:text-zinc-400" />;
}

function DocumentList({
  documents,
  folderOpen,
  onNewFolder,
  newFolderDisabled,
  hideNewFolder,
  sortAsc,
  onToggleSort,
  onToggleAllFolders,
  onToggleFolderOpen,
}: {
  documents: Document[];
  folderOpen: Record<string, boolean>;
  onNewFolder: () => void;
  newFolderDisabled?: boolean;
  hideNewFolder?: boolean;
  sortAsc: boolean;
  onToggleSort: () => void;
  onToggleAllFolders: () => void;
  onToggleFolderOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { documentFolders, activeProjectId } = useAppContext();
  // 只看当前项目的文件夹：同名文件夹跨项目互不复用（spec §用户手动维护文件夹）
  const projectFolders = sortAiWorkspaceFirst(filterFoldersByProject(documentFolders, activeProjectId));
  const uncategorized = uncategorizedInProject(documents, documentFolders, activeProjectId);
  const areAllFoldersOpen = projectFolders.length > 0 && projectFolders.every((folder) => folderOpen[folder.id] ?? false);

  return (
    <>
      <div className="mt-2 mb-4">
        <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between gap-2 bg-[#FAFAFA] px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:bg-[#151515] dark:text-zinc-500">
          <span>{t("sidebar.folders")}</span>
          <div className="flex items-center">
            {/* 新建文件夹在移动端隐藏（US 调整批次 issue 3，同会话列表） */}
            {!hideNewFolder && (
              <IconTooltip label={t("sidebar.newFolder")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onNewFolder}
                  disabled={newFolderDisabled}
                  className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                >
                  <FolderPlus size={14} />
                </Button>
              </IconTooltip>
            )}
            {/* 按时间排序：与会话列表同一套控件与同一套文案（只是时间取文档的更新时间） */}
            <IconTooltip label={sortAsc ? t("sidebar.sortNewestFirst") : t("sidebar.sortOldestFirst")}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleSort}
                className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
              >
                {sortAsc ? <ArrowUpNarrowWide size={14} /> : <ArrowDownNarrowWide size={14} />}
              </Button>
            </IconTooltip>
            {projectFolders.length > 0 && (
              <IconTooltip label={areAllFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleAllFolders}
                  className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                >
                  {areAllFoldersOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                </Button>
              </IconTooltip>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          {projectFolders.length === 0 ? (
            <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty")}</div>
          ) : (
            projectFolders.map((folder) => {
              const folderDocs = documents.filter(d => d.folderId === folder.id);
              return (
                <DocumentFolderItem
                  key={folder.id}
                  folder={folder}
                  documents={folderDocs}
                  isOpen={folderOpen[folder.id] ?? false}
                  onToggleOpen={() => onToggleFolderOpen(folder.id)}
                />
              );
            })
          )}
        </div>
      </div>

      <div className="mt-2">
        <div className="sticky top-0 z-10 -mx-2 bg-[#FAFAFA] px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:bg-[#151515] dark:text-zinc-500">
          {t("sidebar.uncategorized")}
        </div>
        <DocumentUncategorizedList documents={uncategorized} />
      </div>
    </>
  );
}

/** 项目「更多」菜单里的一项：禁用态只降透明度并吃掉指针事件，不再假装可点。 */
function ProjectMenuItem({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon} {label}
    </button>
  );
}

/**
 * 项目选择器（spec document-projects §项目切换选择器）：文档视图文件夹列表**上方**的下拉，
 * 不是文件夹树的一层——文件夹仍是扁平一层，项目只是分组维度。
 * 由 Sidebar 渲染在滚动容器**之外**，因此列表滚动时它固定在顶部不动。
 *
 * 选项用 registry `@startist/select` 的「带描述双行选项」变体（次行为项目描述），
 * 描述为空时自动降级单行。
 *
 * 「更多」按钮常驻：它同时是**新建项目**的入口，只在选中项目时才出现的话，
 * 默认目录下就没有任何建项目的地方。默认目录仍不可改名 / 不可删除，
 * 对应菜单项以禁用态呈现——比整块消失更能说明"为什么这里没有"。
 */
export function ProjectSwitcher() {
  const { t } = useTranslation();
  const {
    documentProjects,
    activeProjectId,
    setActiveProjectId,
    createDocumentProject,
    updateDocumentProject,
    deleteDocumentProject,
  } = useAppContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activeProject = documentProjects.find((project) => project.id === activeProjectId) ?? null;

  // 选项数据展开态与收起态共用一份：Base UI 的 SelectValue 默认渲染的是**原始 value**，
  // 不给它标签就会在界面上露出 dp_xxx 这类内部 id。
  const options = useMemo(
    () => [
      {
        value: DEFAULT_DOCUMENT_PROJECT_ID,
        name: t("sidebar.defaultProject"),
        description: t("sidebar.defaultProjectDescription"),
      },
      ...documentProjects.map((project) => ({
        value: project.id,
        name: project.name,
        description: project.description,
      })),
    ],
    [documentProjects, t],
  );

  return (
    <div className="flex shrink-0 items-center gap-2 px-2 pt-3 pb-1">
      <Select
        value={activeProjectId ?? DEFAULT_DOCUMENT_PROJECT_ID}
        onValueChange={(value: string) =>
          setActiveProjectId(value === DEFAULT_DOCUMENT_PROJECT_ID ? null : value)
        }
      >
        {/* 尺寸/内边距一律用 registry 默认（text-sm 主行 + text-xs 描述），不在产品仓私调 */}
        <SelectTrigger className="min-w-0 flex-1" aria-label={t("sidebar.projectSwitcher")}>
          <SelectValue>
            {(value: string | null) => {
              const option = options.find((item) => item.value === value) ?? options[0];
              return <SelectValueLines title={option.name} description={option.description} />;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} description={option.description}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 常驻入口：新建项目在默认目录下也要够得着 */}
      <IconTooltip label={t("sidebar.projectActions")}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label={t("sidebar.projectActions")}
          onClick={(event) => {
            setMenuPosition(getMenuPosition(event.currentTarget));
            setMenuOpen(true);
          }}
        >
          <MoreHorizontal size={16} />
        </Button>
      </IconTooltip>

      <AnimatePresence>
        {menuOpen && menuPosition && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{ top: menuPosition.top, left: menuPosition.left, width: ITEM_MENU_WIDTH, maxHeight: menuPosition.maxHeight }}
              className="fixed bg-popover text-popover-foreground border border-border shadow-lg rounded-md py-1 z-30 overflow-y-auto custom-scrollbar"
            >
              <ProjectMenuItem
                icon={<Plus size={12} />}
                label={t("sidebar.newProject")}
                onClick={() => { setMenuOpen(false); setCreateOpen(true); }}
              />
              <div className="my-1 h-px bg-border" />
              {/* 默认目录是内置条目：改名 / 改描述 / 删除三个入口一律禁用 */}
              <ProjectMenuItem
                icon={<Edit2 size={12} />}
                label={t("sidebar.editProject")}
                disabled={!activeProject}
                onClick={() => { setMenuOpen(false); setEditOpen(true); }}
              />
              <ProjectMenuItem
                icon={<Trash2 size={12} />}
                label={t("sidebar.deleteProject")}
                disabled={!activeProject}
                danger
                onClick={() => { setMenuOpen(false); setDeleteOpen(true); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ProjectEditModal
        isOpen={createOpen}
        mode="create"
        initialName=""
        initialDescription=""
        onClose={() => setCreateOpen(false)}
        // 失败（重名）时抛给弹窗自己显示错误，不吞掉
        onSubmit={(input) => createDocumentProject(input).then(() => undefined)}
      />

      <ProjectEditModal
        isOpen={editOpen && Boolean(activeProject)}
        initialName={activeProject?.name ?? ""}
        initialDescription={activeProject?.description ?? ""}
        onClose={() => setEditOpen(false)}
        onSubmit={(patch) => {
          // 只动展示字段，sourceKey 不变 → 下次推送仍归入本项目
          if (activeProject) updateDocumentProject(activeProject.id, patch);
          setEditOpen(false);
        }}
      />

      <ConfirmDeleteModal
        isOpen={deleteOpen && Boolean(activeProject)}
        title={t("sidebar.deleteProject")}
        message={t("sidebar.deleteProjectPrompt", { name: activeProject?.name ?? "" })}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (activeProject) deleteDocumentProject(activeProject.id);
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

function DocumentFolderItem({
  folder,
  documents,
  isOpen,
  onToggleOpen,
}: {
  folder: DocumentFolder;
  documents: Document[];
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const { moveDocument, renameDocumentFolder, deleteDocumentFolder } = useAppContext();
  const { mode: selectionMode, isMobile } = useSelection();
  const dndDisabled = selectionMode || isMobile;
  // AI 空间受保护：不提供改名 / 删除入口，记忆置顶于其首位（spec ai-workspace）
  const isAiWorkspace = isAiWorkspaceFolderId(folder.id);
  const orderedDocuments = isAiWorkspace ? sortMemoryFirst(documents) : documents;

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: DOCUMENT_ITEM_TYPE,
      canDrop: () => !dndDisabled,
      drop: (item: { id: string }) => {
        if (dndDisabled) return;
        moveDocument(item.id, folder.id);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !dndDisabled,
      }),
    }),
    [dndDisabled, folder.id, moveDocument]
  );

  const handleRenameFolder = () => {
    setRenameOpen(true);
    setMenuOpen(false);
  };

  const handleDeleteFolder = () => {
    setDeleteOpen(true);
    setMenuOpen(false);
  };

  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuPosition(getMenuPosition(e.currentTarget));
    setMenuOpen(true);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (selectionMode || isMobile) return;
    e.preventDefault();
    setMenuPosition({
      top: Math.max(8, Math.min(e.clientY, window.innerHeight - 240)),
      left: Math.max(8, Math.min(e.clientX, window.innerWidth - ITEM_MENU_WIDTH - 8)),
      maxHeight: Math.max(180, window.innerHeight - e.clientY - 8),
    });
    setMenuOpen(true);
  };

  return (
    <div ref={drop} className="mb-1" onMouseLeave={() => setMenuOpen(false)}>
      <div
        onContextMenu={handleContextMenu}
        className={clsx(
          "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors border text-zinc-700 dark:text-zinc-300 group",
          isOver
            ? "bg-accent border-border"
            : "hover:bg-zinc-100 dark:hover:bg-white/5 border-transparent"
        )}
      >
        <button
          onClick={onToggleOpen}
          className="min-w-0 flex-1 flex items-center gap-2 truncate text-left"
        >
          {isAiWorkspace ? (
            <Sparkles size={14} className={clsx("text-zinc-400", isOver && "text-primary")} />
          ) : isOpen ? (
            <FolderOpen size={14} className={clsx("text-zinc-400", isOver && "text-primary")} />
          ) : (
            <FolderIcon size={14} className={clsx("text-zinc-400", isOver && "text-primary")} />
          )}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 ml-1">
            {documents.length}
          </span>
        </button>
        {!selectionMode && !isMobile && (
          <IconTooltip label={t("sidebar.moreActions")}>
            <button
              onClick={toggleMenu}
              className={clsx(
                "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </IconTooltip>
        )}
      </div>

      <AnimatePresence>
        {menuOpen && menuPosition && (
          <FolderManagementMenu
            menuPosition={menuPosition}
            onRename={handleRenameFolder}
            onDelete={handleDeleteFolder}
          />
        )}
      </AnimatePresence>

      <RenameModal
        isOpen={renameOpen}
        title={t("sidebar.renameFolderTitle")}
        initialValue={folder.name}
        placeholder={t("sidebar.folderName")}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => renameDocumentFolder(folder.id, name)}
      />

      <ConfirmDeleteModal
        isOpen={deleteOpen}
        title={t("sidebar.deleteFolderTitle")}
        message={t("sidebar.deleteFolderPrompt")}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteDocumentFolder(folder.id)}
      />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={{ duration: 0.2 }}
            className="pl-2 mt-0.5 space-y-0.5 border-l border-zinc-200 dark:border-white/10 ml-3"
          >
            {orderedDocuments.length === 0 ? (
              <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty", { defaultValue: "空" })}</div>
            ) : (
              orderedDocuments.map((doc) => (
                <DocumentItem key={doc.id} document={doc} />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocumentUncategorizedList({ documents }: { documents: Document[] }) {
  const { t } = useTranslation();
  const { moveDocument, activeProjectId } = useAppContext();
  const { mode: selectionMode, isMobile } = useSelection();
  const dndDisabled = selectionMode || isMobile;

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: DOCUMENT_ITEM_TYPE,
      canDrop: () => !dndDisabled,
      drop: (item: { id: string }) => {
        if (dndDisabled) return;
        // 落在当前项目的未分类（而非默认目录的未分类）
        moveDocument(item.id, null, activeProjectId);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !dndDisabled,
      }),
    }),
    [dndDisabled, moveDocument, activeProjectId]
  );

  return (
    <div
      ref={drop}
      className={clsx(
        "space-y-0.5 rounded-lg transition-colors",
        isOver && "bg-accent ring-1 ring-ring"
      )}
    >
      {documents.length === 0 ? (
        <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("doc.empty", { defaultValue: "暂无文档" })}</div>
      ) : (
        documents.map((doc) => (
          <DocumentItem key={doc.id} document={doc} />
        ))
      )}
    </div>
  );
}

function DocumentItem({ document: doc }: { document: Document }) {
  const { t } = useTranslation();
  const { activeDocId, setActiveDocId, deleteDocument, renameDocument, moveDocument, uploadDocumentUpdate } = useAppContext();
  const { mode: selectionMode, isSelected, toggle, isMobile } = useSelection();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const isActive = activeDocId === doc.id;
  const checked = isSelected(doc.id);

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: DOCUMENT_ITEM_TYPE,
      item: { id: doc.id },
      canDrag: () => !selectionMode && !isMobile,
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [selectionMode, isMobile, doc.id]
  );

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteOpen(true);
    setMenuOpen(false);
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setRenameOpen(true);
  };

  const handleMove = (folderId: string | null, projectId: string | null) => {
    moveDocument(doc.id, folderId, projectId);
    setMenuOpen(false);
  };

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      const storagePath = await fetchStoragePath("document", doc.id);
      if (await copyText(storagePath)) toast.success(t("sidebar.pathCopied"));
      else toast.error(t("sidebar.pathCopyFailed"));
    } catch (error) {
      console.error({ module: "Sidebar", op: "copyDocumentPath", err: error, context: { id: doc.id } });
      toast.error(t("sidebar.pathCopyFailed"));
    }
  };

  const handleDownloadMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    downloadMarkdownFile(`${doc.id}.md`, documentToMarkdown(doc));
  };

  const handleUploadUpdate = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    uploadInputRef.current?.click();
  };

  const handleUploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast.error(t("sidebar.uploadUpdateInvalidType"));
      return;
    }
    try {
      const action = await uploadDocumentUpdate(doc.id, file);
      if (action === "skipped") toast.info(t("sidebar.uploadUpdateSkipped"));
      else toast.success(t("sidebar.uploadUpdateSuccess"));
    } catch (error: any) {
      console.error({ module: "Sidebar", op: "uploadDocumentUpdate", err: error, context: { id: doc.id } });
      toast.error(error?.message || t("sidebar.uploadUpdateFailed"));
    }
  };

  // 单项移动与批量移动共用同一棵目标树（spec §批量移动共用目标树）
  const moveGroups = useDocumentMoveGroups();

  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuPosition(getMenuPosition(e.currentTarget));
    setMenuOpen(true);
  };

  return (
    <div
      ref={drag}
      onClick={() => {
        if (selectionMode) toggle(doc.id);
        else setActiveDocId(doc.id);
      }}
      onMouseLeave={() => setMenuOpen(false)}
      className={clsx(
        "group relative flex flex-col justify-center px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors border",
        isDragging ? "opacity-40" : "opacity-100",
        selectionMode && checked
          ? "bg-accent border-border text-zinc-900 dark:text-white"
          : !selectionMode && isActive
            ? "bg-white dark:bg-[#2C2C2E] border-zinc-200 dark:border-white/10 shadow-sm text-zinc-900 dark:text-white"
            : "border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 truncate pr-6">
          {selectionMode && (
            checked
              ? <CheckSquare size={14} className="text-primary shrink-0" />
              : <Square size={14} className="text-zinc-400 shrink-0" />
          )}
          <FileText size={14} className="text-zinc-400 shrink-0" />
          <span className="truncate font-medium">{doc.title}</span>
          {/* AI 生成的可见标记：权限按出身划，这个标记让「出身」重新看得见（spec agent-write-policy） */}
          {isAiGenerated(doc) && (
            <IconTooltip label={t("doc.aiGenerated")}>
              <Sparkles size={12} className="shrink-0 text-primary" aria-label={t("doc.aiGenerated")} />
            </IconTooltip>
          )}
        </div>
        {!selectionMode && !isMobile && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "absolute right-2 p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
            )}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {menuOpen && menuPosition && !selectionMode && (
          <ItemActionMenu
            menuPosition={menuPosition}
            moveGroups={moveGroups}
            onRename={handleRename}
            onMove={handleMove}
            onCopyPath={handleCopyPath}
            onDownloadMarkdown={handleDownloadMarkdown}
            onUploadUpdate={handleUploadUpdate}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>

      <input
        ref={uploadInputRef}
        type="file"
        accept=".md"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={handleUploadFileChange}
      />

      <RenameModal
        isOpen={renameOpen}
        title={t("sidebar.renameDocumentTitle")}
        initialValue={doc.title}
        placeholder={t("sidebar.documentTitle")}
        onClose={() => setRenameOpen(false)}
        onSubmit={(title) => renameDocument(doc.id, title)}
      />

      <ConfirmDeleteModal
        isOpen={deleteOpen}
        title={t("sidebar.deleteDocumentTitle")}
        message={t("sidebar.deleteDocumentPrompt")}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteDocument(doc.id)}
      />
    </div>
  );
}
