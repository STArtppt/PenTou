import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { toast } from "sonner";
import { useAppContext, Conversation, Folder, Platform, Document, DocumentFolder } from "../data";
import logoUrl from "../../../assets/images/logo.png";
import logoDarkUrl from "../../../assets/images/logo_dark.png";
import { useScrollActivity } from "../hooks/useScrollActivity";
import { useTranslation } from "../i18n";
import { formatDisplayDate } from "../utils/dateFormat";
import { copyText } from "../utils/clipboard";
import { batchExportToVault, buildObsidianOpenUri } from "../obsidian";

const CONVERSATION_ITEM_TYPE = "CONVERSATION";
const DOCUMENT_ITEM_TYPE = "DOCUMENT";
const ITEM_MENU_WIDTH = 176;
const FOLDER_SUBMENU_WIDTH = 188;

type MenuPosition = { top: number; left: number; maxHeight: number };
type MoveTarget = { id: string | null; name: string };
type StoredItemType = "conversation" | "document";

type SelectionContextValue = {
  mode: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
};

const SelectionContext = createContext<SelectionContextValue>({
  mode: false,
  isSelected: () => false,
  toggle: () => {},
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
  moveTargets,
  onRename,
  onMove,
  onCopyPath,
  onDownloadMarkdown,
  onUploadUpdate,
  onDelete,
}: {
  menuPosition: MenuPosition;
  moveTargets: MoveTarget[];
  onRename: (event: React.MouseEvent) => void;
  onMove: (folderId: string | null) => void;
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
    setSubmenuPosition(getSubmenuPosition(event.currentTarget, moveTargets.length));
    setSubmenuOpen(true);
  };

  const handleMove = (event: React.MouseEvent, folderId: string | null) => {
    event.stopPropagation();
    onMove(folderId);
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
            {moveTargets.map((target) => (
              <button
                key={target.id ?? "uncategorized"}
                onClick={(event) => handleMove(event, target.id)}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
              >
                <FolderIcon size={12} /> <span className="truncate">{target.name}</span>
              </button>
            ))}
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
  } = useAppContext();

  const { t } = useTranslation();

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
  const filteredDocuments = documents;

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
    }),
    [selectionMode, selectedIds]
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
      const folderIds = new Set(documentFolders.map((f) => f.id));
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
  }, [activeView, folders, documentFolders, filteredConversations, filteredDocuments, chatFolderOpen, docFolderOpen]);

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

  const runBatchMove = async (folderId: string | null) => {
    const ids = Array.from(selectedIds);
    if (activeView === "chat") {
      for (const id of ids) {
        try { await moveConversation(id, folderId); }
        catch (e) { console.error({ module: "Sidebar", op: "batchMoveConv", id, folderId, err: e }); }
      }
    } else {
      for (const id of ids) {
        try { await moveDocument(id, folderId); }
        catch (e) { console.error({ module: "Sidebar", op: "batchMoveDoc", id, folderId, err: e }); }
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

  const moveTargets: MoveTarget[] =
    activeView === "chat"
      ? [{ id: null, name: t("sidebar.uncategorized") }, ...folders.map((f) => ({ id: f.id, name: f.name }))]
      : [{ id: null, name: t("sidebar.uncategorized") }, ...documentFolders.map((f) => ({ id: f.id, name: f.name }))];

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;
  const areAllChatFoldersOpen = folders.length > 0 && folders.every((folder) => chatFolderOpen[folder.id] ?? false);

  const toggleAllChatFolders = () => {
    const nextOpen = !areAllChatFoldersOpen;
    setChatFolderOpen(Object.fromEntries(folders.map((folder) => [folder.id, nextOpen])));
  };

  return (
    <SelectionContext.Provider value={selectionValue}>
    <div className="w-72 h-full bg-[#FAFAFA] dark:bg-[#151515] border-r border-zinc-200 dark:border-white/10 flex flex-col z-50 shrink-0">
      {/* Header */}
      <div className="p-4 flex flex-col gap-4 border-b border-zinc-200 dark:border-white/10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-white font-semibold text-lg group cursor-pointer">
            <img src={theme === "dark" ? logoDarkUrl : logoUrl} alt="PenTou Logo" className="w-6 h-6 object-contain" />
            <span className="group-hover:text-foreground transition-colors">PenTou</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => setSettingsOpen(true)}
              title={t("toolbar.settings")}
            >
              <Settings size={18} />
            </Button>
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
              title="Logout"
            >
              <LogOut size={18} />
            </Button>
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
          <Button
            variant="outline"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            onClick={() => setSearchOpen(true)}
            title={t("search.button")}
            aria-label={t("search.button")}
          >
            <Search size={16} />
          </Button>
        </div>

        {/* Primary action: Import (elevated full-width surface pill) */}
        <Button
          variant="surface"
          className="w-full gap-1.5 font-semibold"
          onClick={() => setDrawerOpen(true)}
          disabled={selectionMode}
        >
          <Import size={16} /> {t("sidebar.import")}
        </Button>
      </div>

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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleNewFolder}
                    disabled={selectionMode}
                    className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                    title={t("sidebar.newFolder")}
                    aria-label={t("sidebar.newFolder")}
                  >
                    <FolderPlus size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleConvSort}
                    className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                    title={convSortAsc ? t("sidebar.sortNewestFirst") : t("sidebar.sortOldestFirst")}
                    aria-label={convSortAsc ? t("sidebar.sortNewestFirst") : t("sidebar.sortOldestFirst")}
                  >
                    {convSortAsc ? <ArrowUpNarrowWide size={14} /> : <ArrowDownNarrowWide size={14} />}
                  </Button>
                  {folders.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={toggleAllChatFolders}
                      className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                      title={areAllChatFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}
                      aria-label={areAllChatFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}
                    >
                      {areAllChatFoldersOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                    </Button>
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
            onToggleAllFolders={() => {
              const areAllOpen = documentFolders.length > 0 && documentFolders.every((folder) => docFolderOpen[folder.id] ?? false);
              const nextOpen = !areAllOpen;
              setDocFolderOpen(Object.fromEntries(documentFolders.map((folder) => [folder.id, nextOpen])));
            }}
            onToggleFolderOpen={(id) =>
              setDocFolderOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))
            }
          />
        )}
      </div>

      {/* Batch Select (entry button OR toolbar) */}
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
              {moveTargets.map((target) => (
                <button
                  key={target.id ?? "uncategorized"}
                  onClick={() => {
                    setBatchMoveMenu(null);
                    runBatchMove(target.id);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center gap-2"
                >
                  <FolderIcon size={12} /> <span className="truncate">{target.name}</span>
                </button>
              ))}
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
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onMoveClick}
          disabled={!hasSelection}
          className="h-auto flex-1 gap-1 px-2 py-1.5 text-xs"
        >
          <FolderInput size={12} /> {t("sidebar.moveTo", { n: selectedCount })}
        </Button>
        {showObsidian && (
          <Button
            variant="outline"
            size="sm"
            onClick={onObsidianClick}
            disabled={!hasSelection}
            className="h-auto flex-1 gap-1 px-2 py-1.5 text-xs"
          >
            <Send size={12} /> {t("sidebar.obsidianExport")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onDeleteClick}
          disabled={!hasSelection}
          className="h-auto flex-1 gap-1 border-destructive/30 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={12} /> {t("sidebar.deleteN", { n: selectedCount })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto gap-1 px-2 py-1.5 text-xs text-muted-foreground"
        >
          {t("sidebar.exitSelect")}
        </Button>
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
  const { mode: selectionMode } = useSelection();

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: CONVERSATION_ITEM_TYPE,
      canDrop: () => !selectionMode,
      drop: (item: { id: string }) => {
        if (selectionMode) return;
        moveConversation(item.id, folder.id);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !selectionMode,
      }),
    }),
    [selectionMode, folder.id, moveConversation]
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    if (selectionMode) return;
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
        title={selectionMode ? undefined : t("sidebar.rightClick")}
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
        {!selectionMode && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
            )}
            title={t("sidebar.moreActions")}
          >
            <MoreHorizontal size={14} />
          </button>
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
  const { mode: selectionMode } = useSelection();

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: CONVERSATION_ITEM_TYPE,
      canDrop: () => !selectionMode,
      drop: (item: { id: string }) => {
        if (selectionMode) return;
        moveConversation(item.id, null);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !selectionMode,
      }),
    }),
    [selectionMode, moveConversation]
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
  const { mode: selectionMode, isSelected, toggle } = useSelection();
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
      canDrag: () => !selectionMode,
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [selectionMode, conversation.id]
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

  const moveTargets: MoveTarget[] = [
    { id: null, name: t("sidebar.uncategorized") },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name })),
  ];

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

        {/* Floating Menu Trigger (hidden in selection mode) */}
        {!selectionMode && (
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
            moveTargets={moveTargets}
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
  onToggleAllFolders,
  onToggleFolderOpen,
}: {
  documents: Document[];
  folderOpen: Record<string, boolean>;
  onNewFolder: () => void;
  newFolderDisabled?: boolean;
  onToggleAllFolders: () => void;
  onToggleFolderOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { documentFolders } = useAppContext();
  const documentFolderIds = new Set(documentFolders.map((folder) => folder.id));
  const uncategorized = documents.filter((d) => !d.folderId || !documentFolderIds.has(d.folderId));
  const areAllFoldersOpen = documentFolders.length > 0 && documentFolders.every((folder) => folderOpen[folder.id] ?? false);

  return (
    <>
      <div className="mt-2 mb-4">
        <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between gap-2 bg-[#FAFAFA] px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:bg-[#151515] dark:text-zinc-500">
          <span>{t("sidebar.folders")}</span>
          <div className="flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onNewFolder}
              disabled={newFolderDisabled}
              className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
              title={t("sidebar.newFolder")}
              aria-label={t("sidebar.newFolder")}
            >
              <FolderPlus size={14} />
            </Button>
            {documentFolders.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleAllFolders}
                className="size-6 rounded-md text-zinc-400 dark:text-zinc-500"
                title={areAllFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}
                aria-label={areAllFoldersOpen ? t("sidebar.collapseAllFolders") : t("sidebar.expandAllFolders")}
              >
                {areAllFoldersOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          {documentFolders.length === 0 ? (
            <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty")}</div>
          ) : (
            documentFolders.map((folder) => {
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
  const { mode: selectionMode } = useSelection();

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: DOCUMENT_ITEM_TYPE,
      canDrop: () => !selectionMode,
      drop: (item: { id: string }) => {
        if (selectionMode) return;
        moveDocument(item.id, folder.id);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !selectionMode,
      }),
    }),
    [selectionMode, folder.id, moveDocument]
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
    if (selectionMode) return;
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
          {isOpen ? (
            <FolderOpen size={14} className={clsx("text-zinc-400", isOver && "text-primary")} />
          ) : (
            <FolderIcon size={14} className={clsx("text-zinc-400", isOver && "text-primary")} />
          )}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 ml-1">
            {documents.length}
          </span>
        </button>
        {!selectionMode && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-foreground"
            )}
            title={t("sidebar.moreActions")}
          >
            <MoreHorizontal size={14} />
          </button>
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
            {documents.length === 0 ? (
              <div className="px-4 py-2 text-xs text-zinc-400 italic">{t("sidebar.empty", { defaultValue: "空" })}</div>
            ) : (
              documents.map((doc) => (
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
  const { moveDocument } = useAppContext();
  const { mode: selectionMode } = useSelection();

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: DOCUMENT_ITEM_TYPE,
      canDrop: () => !selectionMode,
      drop: (item: { id: string }) => {
        if (selectionMode) return;
        moveDocument(item.id, null);
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver() && !selectionMode,
      }),
    }),
    [selectionMode, moveDocument]
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
  const { activeDocId, setActiveDocId, deleteDocument, renameDocument, moveDocument, uploadDocumentUpdate, documentFolders } = useAppContext();
  const { mode: selectionMode, isSelected, toggle } = useSelection();
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
      canDrag: () => !selectionMode,
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [selectionMode, doc.id]
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
    moveDocument(doc.id, folderId);
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

  const moveTargets: MoveTarget[] = [
    { id: null, name: t("sidebar.uncategorized") },
    ...documentFolders.map((folder) => ({ id: folder.id, name: folder.name })),
  ];

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
        </div>
        {!selectionMode && (
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
            moveTargets={moveTargets}
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
