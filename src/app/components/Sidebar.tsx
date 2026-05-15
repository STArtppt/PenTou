import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import {
  Search,
  Plus,
  Moon,
  Sun,
  MoreHorizontal,
  FolderOpen,
  Folder as FolderIcon,
  MessageSquare,
  Import,
  Trash2,
  Edit2,
  FolderInput,
  FileText,
  Settings,
  CheckSquare,
  Square,
  Minus,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { useAppContext, Conversation, Folder, Platform, Document, DocumentFolder } from "../data";
import logoUrl from "../../../assets/images/logo.png";
import logoDarkUrl from "../../../assets/images/logo_dark.png";
import { useTranslation } from "../i18n";

const CONVERSATION_ITEM_TYPE = "CONVERSATION";
const DOCUMENT_ITEM_TYPE = "DOCUMENT";
const ITEM_MENU_WIDTH = 176;
const FOLDER_SUBMENU_WIDTH = 188;

type MenuPosition = { top: number; left: number; maxHeight: number };
type MoveTarget = { id: string | null; name: string };

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

function ItemActionMenu({
  menuPosition,
  moveTargets,
  onRename,
  onMove,
  onDelete,
}: {
  menuPosition: MenuPosition;
  moveTargets: MoveTarget[];
  onRename: (event: React.MouseEvent) => void;
  onMove: (folderId: string | null) => void;
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
        className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-[80] overflow-y-auto custom-scrollbar"
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
            className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-[90] overflow-y-auto custom-scrollbar"
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
      className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-[80] overflow-y-auto custom-scrollbar"
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-2xl rounded-xl p-5 overflow-hidden z-10"
          >
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">{title}</h3>
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") onClose();
              }}
              placeholder={placeholder}
              className="w-full bg-zinc-50 dark:bg-[#151515] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-yellow-400 focus:border-transparent transition-all mb-6"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors"
              >
                {t("sidebar.cancel")}
              </button>
              <button
                onClick={submitRename}
                className="px-4 py-2 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-500 rounded-lg transition-colors shadow-sm"
              >
                {t("sidebar.save")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-2xl rounded-xl p-5 overflow-hidden z-10"
          >
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">{title}</h3>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400 mb-6">{message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors"
              >
                {t("sidebar.cancel")}
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 rounded-lg transition-colors shadow-sm"
              >
                {t("sidebar.menuDelete")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Sidebar() {
  const {
    theme,
    setTheme,
    setDrawerOpen,
    searchQuery,
    setSearchQuery,
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

  const platformOptions: Platform[] = ["ChatGPT", "DeepSeek", "Gemini", "Claude", "CLI", "Cursor", "Copilot", "Codex"];

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredDocuments = documents.filter((d) =>
    d.title.toLowerCase().includes(searchQuery.toLowerCase())
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
        } else if (chatFolderOpen[c.folderId] ?? true) {
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
        } else if (docFolderOpen[d.folderId] ?? true) {
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

  const moveTargets: MoveTarget[] =
    activeView === "chat"
      ? [{ id: null, name: t("sidebar.uncategorized") }, ...folders.map((f) => ({ id: f.id, name: f.name }))]
      : [{ id: null, name: t("sidebar.uncategorized") }, ...documentFolders.map((f) => ({ id: f.id, name: f.name }))];

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  return (
    <SelectionContext.Provider value={selectionValue}>
    <div className="w-72 h-full bg-[#FAFAFA] dark:bg-[#151515] border-r border-zinc-200 dark:border-white/10 flex flex-col z-50 shrink-0">
      {/* Header */}
      <div className="p-4 flex flex-col gap-4 border-b border-zinc-200 dark:border-white/10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-white font-semibold text-lg group cursor-pointer">
            <img src={theme === "dark" ? logoDarkUrl : logoUrl} alt="PenTou Logo" className="w-6 h-6 object-contain" />
            <span className="group-hover:text-orange-500 dark:group-hover:text-yellow-400 transition-colors">PenTou</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400 transition-colors"
              title={t("toolbar.settings")}
            >
              <Settings size={18} />
            </button>
            <button
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                } catch { /* dev mode has no logout endpoint; fall through to redirect */ }
                window.location.href = "/login";
              }}
              className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex bg-zinc-100 dark:bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => handleTabClick("chat")}
            className={clsx(
              "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeView === "chat"
                ? "bg-white dark:bg-[#2A2A2A] text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            {t("sidebar.tab.chat")}
          </button>
          <button
            onClick={() => handleTabClick("doc")}
            className={clsx(
              "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeView === "doc"
                ? "bg-white dark:bg-[#2A2A2A] text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            {t("sidebar.tab.doc")}
          </button>
        </div>

        {/* Search */}
        <div className="relative group">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder={activeView === "doc" ? t("sidebar.searchDoc") : t("sidebar.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-yellow-400 focus:border-transparent transition-all"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            disabled={selectionMode}
            className="flex-[2] flex items-center justify-center gap-1.5 bg-transparent border border-zinc-900 dark:border-white text-zinc-900 dark:text-white hover:border-orange-500 hover:text-orange-500 dark:hover:border-yellow-400 dark:hover:text-yellow-400 rounded-lg py-1.5 text-sm font-semibold transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-900 disabled:hover:text-zinc-900 dark:disabled:hover:border-white dark:disabled:hover:text-white"
          >
            <Import size={16} /> {t("sidebar.import")}
          </button>
          <button
            onClick={handleNewFolder}
            disabled={selectionMode}
            className="flex-1 flex items-center justify-center gap-1.5 bg-transparent border border-zinc-200 dark:border-white/10 hover:border-orange-500 hover:text-orange-500 dark:hover:border-yellow-400 dark:hover:text-yellow-400 rounded-lg py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-200 disabled:hover:text-zinc-700 dark:disabled:hover:border-white/10 dark:disabled:hover:text-zinc-300"
            title={t("sidebar.newFolder")}
          >
            <FolderOpen size={16} /> {t("sidebar.new")}
          </button>
        </div>
      </div>

      {/* Lists */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 custom-scrollbar space-y-1">
        {activeView === "chat" ? (
          <>
            <div className="mt-2 mb-4">
              <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                FOLDERS
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
                      isOpen={chatFolderOpen[folder.id] ?? true}
                      onToggleOpen={() =>
                        setChatFolderOpen((prev) => ({ ...prev, [folder.id]: !(prev[folder.id] ?? true) }))
                      }
                    />
                  ))
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="px-3 py-1.5 text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                {t("sidebar.uncategorized")}
              </div>
              <ConversationUncategorizedList conversations={filteredConversations.filter((c) => !c.folderId)} />
            </div>
          </>
        ) : (
          <DocumentList
            documents={filteredDocuments}
            folderOpen={docFolderOpen}
            onToggleFolderOpen={(id) =>
              setDocFolderOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))
            }
          />
        )}
      </div>

      {/* Batch Select (entry button OR toolbar) */}
      <div className="shrink-0 p-3 border-t border-zinc-200 dark:border-white/10">
        {!selectionMode ? (
          <button
            onClick={enterSelection}
            className="flex items-center justify-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors w-full p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg font-medium"
          >
            <CheckSquare size={16} />
            {t("sidebar.multiSelect")}
          </button>
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
            onCancel={exitSelection}
          />
        )}
      </div>

      {/* Batch Move target menu (复用 ItemActionMenu 的 submenu 风格) */}
      <AnimatePresence>
        {batchMoveMenu && (
          <>
            <div className="fixed inset-0 z-[85]" onClick={() => setBatchMoveMenu(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{ top: batchMoveMenu.top, left: batchMoveMenu.left, width: FOLDER_SUBMENU_WIDTH, maxHeight: batchMoveMenu.maxHeight }}
              className="fixed bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 shadow-lg rounded-md py-1 z-[90] overflow-y-auto custom-scrollbar"
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
                className="w-full bg-zinc-50 dark:bg-[#151515] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-yellow-400 focus:border-transparent transition-all mb-6"
              />
              {activeView === "chat" && (
                <datalist id="platform-options">
                  {platformOptions.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsNewFolderModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  {t("sidebar.cancel")}
                </button>
                <button
                  onClick={submitNewFolder}
                  className="px-4 py-2 text-sm font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-500 rounded-lg transition-colors shadow-sm"
                >
                  {t("sidebar.create")}
                </button>
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
  onCancel,
}: {
  selectedCount: number;
  hasSelection: boolean;
  selectAllState: "none" | "partial" | "all";
  visibleCount: number;
  onToggleSelectAll: () => void;
  onMoveClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onDeleteClick: () => void;
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
          <Icon size={14} className={clsx(selectAllState !== "none" && "text-orange-500 dark:text-yellow-400")} />
          <span>{t("sidebar.selectAll")}</span>
        </button>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {t("sidebar.selectedN", { n: selectedCount })}
        </span>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={onMoveClick}
          disabled={!hasSelection}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-orange-500 hover:text-orange-500 dark:hover:border-yellow-400 dark:hover:text-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-200 disabled:hover:text-zinc-700 dark:disabled:hover:border-white/10 dark:disabled:hover:text-zinc-300"
        >
          <FolderInput size={12} /> {t("sidebar.moveTo", { n: selectedCount })}
        </button>
        <button
          onClick={onDeleteClick}
          disabled={!hasSelection}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Trash2 size={12} /> {t("sidebar.deleteN", { n: selectedCount })}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1.5 text-xs font-medium rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
        >
          {t("sidebar.exitSelect")}
        </button>
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
            ? "bg-orange-50 dark:bg-yellow-400/10 border border-orange-200 dark:border-yellow-400/30"
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
              className={clsx("text-zinc-400", isOver && "text-orange-500 dark:text-yellow-400")}
            />
          ) : (
            <FolderIcon
              size={16}
              className={clsx("text-zinc-400", isOver && "text-orange-500 dark:text-yellow-400")}
            />
          )}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 ml-1">
            {conversations.length}
          </span>
        </button>
        {!selectionMode && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400"
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
        isOver && "bg-orange-50 dark:bg-yellow-400/10 ring-1 ring-orange-200 dark:ring-yellow-400/30"
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
  const { t } = useTranslation();
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
          ? "bg-orange-50 dark:bg-yellow-400/10 border-orange-200 dark:border-yellow-400/30 text-zinc-900 dark:text-white"
          : !selectionMode && isActive
            ? "bg-white dark:bg-[#2C2C2E] border-zinc-200 dark:border-white/10 shadow-sm text-zinc-900 dark:text-white"
            : "border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 truncate pr-6">
          {selectionMode && (
            checked
              ? <CheckSquare size={14} className="text-orange-500 dark:text-yellow-400 shrink-0" />
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
                : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400"
            )}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        <span>{new Date(conversation.date).toLocaleDateString()}</span>
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
  return <MessageSquare size={14} className="text-zinc-500 dark:text-zinc-400" />;
}

function DocumentList({
  documents,
  folderOpen,
  onToggleFolderOpen,
}: {
  documents: Document[];
  folderOpen: Record<string, boolean>;
  onToggleFolderOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { documentFolders } = useAppContext();
  const documentFolderIds = new Set(documentFolders.map((folder) => folder.id));
  const uncategorized = documents.filter((d) => !d.folderId || !documentFolderIds.has(d.folderId));

  return (
    <>
      <div className="mt-2 mb-4">
        <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
          FOLDERS
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
                  isOpen={folderOpen[folder.id] ?? true}
                  onToggleOpen={() => onToggleFolderOpen(folder.id)}
                />
              );
            })
          )}
        </div>
      </div>

      <div className="mt-2">
        <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
          UNCATEGORIZED
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
            ? "bg-orange-50 dark:bg-yellow-400/10 border-orange-200 dark:border-yellow-400/30"
            : "hover:bg-zinc-100 dark:hover:bg-white/5 border-transparent"
        )}
      >
        <button
          onClick={onToggleOpen}
          className="min-w-0 flex-1 flex items-center gap-2 truncate text-left"
        >
          {isOpen ? (
            <FolderOpen size={14} className={clsx("text-zinc-400", isOver && "text-orange-500 dark:text-yellow-400")} />
          ) : (
            <FolderIcon size={14} className={clsx("text-zinc-400", isOver && "text-orange-500 dark:text-yellow-400")} />
          )}
          <span className="font-medium truncate">{folder.name}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 ml-1">
            {documents.length}
          </span>
        </button>
        {!selectionMode && (
          <button
            onClick={toggleMenu}
            className={clsx(
              "p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/20 transition-opacity shrink-0",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400"
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
        isOver && "bg-orange-50 dark:bg-yellow-400/10 ring-1 ring-orange-200 dark:ring-yellow-400/30"
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
  const { activeDocId, setActiveDocId, deleteDocument, renameDocument, moveDocument, documentFolders } = useAppContext();
  const { mode: selectionMode, isSelected, toggle } = useSelection();
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
          ? "bg-orange-50 dark:bg-yellow-400/10 border-orange-200 dark:border-yellow-400/30 text-zinc-900 dark:text-white"
          : !selectionMode && isActive
            ? "bg-white dark:bg-[#2C2C2E] border-zinc-200 dark:border-white/10 shadow-sm text-zinc-900 dark:text-white"
            : "border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 truncate pr-6">
          {selectionMode && (
            checked
              ? <CheckSquare size={14} className="text-orange-500 dark:text-yellow-400 shrink-0" />
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
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400"
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
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>

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
