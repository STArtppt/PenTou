import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { DEFAULT_LLM_CONFIG } from "./llm";
import { generateDocId, generateAnnotationId } from "./doc-utils";
import {
  AiChatSession,
  createEmptyAiChatSession,
  deleteSession as deleteAiChatFile,
  listSessions as listAiChatSessions,
  saveSession as saveAiChatFile,
} from "./ai-chats";

// "Codex" 仅存量数据兼容：新解析一律输出 "ChatGPT"（spec collector-source-expansion 决策 2）
export type Platform = "ChatGPT" | "DeepSeek" | "Gemini" | "Claude" | "CLI" | "Cursor" | "Copilot" | "Codex" | "Hermes" | "Grok" | "OpenCode";

export interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  platform: Platform;
  date: string;
  folderId: string | null;
  messages: Message[];
  // Present when this entry came from /api/conversations?fields=meta.
  // Sidebar uses it to render the turn count without forcing message hydration.
  messageCount?: number;
  // 导入去重合并后写入：最近一次合并/回滚时间 + 当前版本指针（spec import-dedup-versioning）
  updatedAt?: string;
  currentVersionId?: string;
  // 采集溯源（spec collector-source-expansion US-07）："cli:<form-slug>" 时顶栏渲染形态徽章
  ingestSource?: string;
  // date 取自解析源自带的会话创建时间（而非导入时刻兜底）。仅在导入管线内传递、不落盘：
  // upsert 据此不再用"最早消息时间"回退修正 date（spec conversation-time-and-sort US-02
  // "解析源含会话创建时间时优先用之"）。
  dateFromSource?: boolean;
}

// 导入去重合并的结果汇总（addConversations 返回，供 ImportDrawer 展示非阻塞提示）
export interface ImportActionItem {
  action: "created" | "merged" | "skipped";
  id: string;
  title: string;
}
export interface ImportSummary {
  created: number;
  merged: number;
  skipped: number;
  items: ImportActionItem[];
}

export interface Folder {
  id: string;
  name: string;
  platform?: Platform;
}

// ── Document types ──────────────────────────────────────────────────────────

export type ActiveView = "chat" | "doc";
export type EditMode = "off" | "annotate" | "edit";

export interface Document {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  body: string;
  currentVersionId: string;
  sourceConversationId?: string;
  sourcePlatform?: Platform;
  sourceAiChatId?: string;
  generatedBy?: string;
  generatedAt?: string;
  importedFrom?: string;
  importedAt?: string;
  versionType?: VersionType;
}

export interface DocumentFolder {
  id: string;
  name: string;
}

export type VersionType =
  | "import"
  | "manual-edit"
  | "conversation-excerpt"
  | "pre-llm-rewrite"
  | "llm-rewrite"
  | "pre-import-overwrite"
  | "pre-rollback"
  | "rolled-back-from";

export interface DocumentVersion {
  id: string;
  docId: string;
  version: number;
  body: string;
  createdAt: string;
  type: VersionType;
  sourceAnnotationIds?: string[];
  rolledBackFromVersionId?: string;
  label?: string;
}

// 会话版本：列表项与文档版本同构（id/version/type/createdAt）；
// 详情额外带 messages（由 /api/conversations/:id/versions/:vid 返回，供预览）。
export interface ConversationVersion {
  id: string;
  version: number;
  type: VersionType;
  createdAt: string;
  rolledBackFromVersionId?: string;
  messages?: Message[];
  title?: string;
}

// 搜索浮层点击结果后的"待跳转目标"（spec hybrid-search US-03）：
// 切换视图 + 打开目标后，由 ChatBody / DocViewer 用 snippetText 在已渲染内容内二次定位。
export interface SearchJump {
  type: "conversation" | "document";
  id: string;
  snippetText: string;
}

export type AnnotationType = "highlight" | "comment";

export interface Annotation {
  id: string;
  docId: string;
  anchor: string;
  range: { start: number; end: number };
  type: AnnotationType;
  comment?: string;
  color: string;
  createdAt: string;
  orphanedAt?: string;
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPromptConvertConv: string;
  systemPromptRewriteByAnnotations: string;
}

export interface ObsidianConfig {
  vaultName: string;
  /** vault 根目录绝对路径；空/未设 = 维持 URI 唤起行为（spec obsidian-vault-export） */
  vaultPath?: string;
}

// 嵌入后端配置（spec hybrid-search §4.7）。区别于 LLMConfig：服务端持久化、不走 localStorage、
// 永不回显明文 apiKey（仅 hasKey）。形状对齐服务端 EmbeddingState。
export type EmbeddingPhase = "disabled" | "configuring" | "embedding" | "partial" | "ready" | "error";
export interface EmbeddingClientConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  dim?: number;
  phase: EmbeddingPhase;
  hasKey: boolean;
  embedding: { done: number; total: number };
  error?: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (res.status === 401) {
    // Session missing/expired — bounce to login. Avoid loop when already there.
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new Error(`API ${path} unauthenticated`);
  }
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

function loadLLMFromLocalStorage(): LLMConfig {
  try {
    const raw = localStorage.getItem("pentou-llm-config");
    if (raw) return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_LLM_CONFIG };
}

function loadObsidianFromLocalStorage(): ObsidianConfig {
  try {
    const raw = localStorage.getItem("pentou-obsidian-config");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { vaultName: "" };
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AppContextType {
  // ── Conversation ──
  folders: Folder[];
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  addConversations: (convs: Conversation[]) => Promise<ImportSummary>;
  moveConversation: (convId: string, folderId: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  // 会话版本历史（对齐文档；spec 决策5）
  versionsByConv: Record<string, ConversationVersion[]>;
  loadConversationVersions: (convId: string) => Promise<void>;
  rollbackConversation: (convId: string, targetVersionId: string) => Promise<void>;
  addFolder: (name: string, platform?: Platform) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  // ── Document ──
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  documents: Document[];
  documentFolders: DocumentFolder[];
  activeDocId: string | null;
  setActiveDocId: (id: string | null) => void;
  annotationsByDoc: Record<string, Annotation[]>;
  versionsByDoc: Record<string, DocumentVersion[]>;
  editMode: EditMode;
  setEditMode: (mode: EditMode) => void;
  previewingVersionId: string | null;
  setPreviewingVersionId: (id: string | null) => void;
  versionPanelOpen: boolean;
  setVersionPanelOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  llmConfig: LLMConfig;
  obsidianConfig: ObsidianConfig;
  setLlmConfig: (cfg: LLMConfig) => void;
  setObsidianConfig: (cfg: ObsidianConfig) => void;
  // 嵌入后端配置（spec hybrid-search §4.7，经 /api/search/config 读写，不走 localStorage）
  embeddingConfig: EmbeddingClientConfig | null;
  refreshEmbeddingConfig: () => Promise<void>;
  saveEmbeddingConfig: (patch: { enabled?: boolean; endpoint?: string; model?: string; apiKey?: string }) => Promise<EmbeddingClientConfig>;
  addDocuments: (docs: Document[]) => Promise<void>;
  updateDocument: (id: string, patch: Partial<Document>) => Promise<void>;
  saveDocumentBody: (id: string, newBody: string) => Promise<DocumentVersion>;
  uploadDocumentUpdate: (id: string, file: File) => Promise<"merged" | "skipped">;
  deleteDocument: (id: string) => Promise<void>;
  renameDocument: (id: string, title: string) => Promise<void>;
  moveDocument: (docId: string, folderId: string | null) => Promise<void>;
  addDocumentFolder: (name: string) => Promise<void>;
  renameDocumentFolder: (id: string, name: string) => Promise<void>;
  deleteDocumentFolder: (id: string) => Promise<void>;
  loadAnnotations: (docId: string) => Promise<void>;
  upsertAnnotation: (anno: Annotation) => Promise<void>;
  deleteAnnotation: (docId: string, annoId: string) => Promise<void>;
  setAnnotationsForDoc: (docId: string, annos: Annotation[]) => Promise<void>;
  loadVersions: (docId: string) => Promise<void>;
  commitVersion: (docId: string, body: string, type: VersionType, sourceAnnotationIds?: string[]) => Promise<DocumentVersion>;
  rollbackToVersion: (docId: string, targetVersionId: string) => Promise<DocumentVersion>;
  deleteVersion: (docId: string, versionId: string) => Promise<void>;
  // ── UI ──
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  language: "en" | "zh";
  setLanguage: (lang: "en" | "zh") => void;
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  // ── Search palette (spec hybrid-search) ──
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchJump: SearchJump | null;
  setSearchJump: (jump: SearchJump | null) => void;
  // ── AI sidebar (spec ai-sidebar Phase 1) ──
  aiSidebarOpen: boolean;
  setAiSidebarOpen: (open: boolean) => void;
  toggleAiSidebar: () => void;
  aiSessions: AiChatSession[];
  currentAiSession: AiChatSession;
  setCurrentAiSession: (session: AiChatSession | ((session: AiChatSession) => AiChatSession)) => void;
  saveAiSession: (session: AiChatSession) => Promise<void>;
  createNewAiSession: () => Promise<AiChatSession>;
  selectAiSession: (id: string) => Promise<{ session: AiChatSession | null; didJump: boolean }>;
  deleteAiSession: (id: string) => Promise<void>;
  refreshAiSessions: () => Promise<void>;
  isLoading: boolean;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// 初始选中恢复上次打开的会话（debugging/2026-07-16-refresh-opens-oldest-conversation.md）：
// 存储 id 已被删除或从未存储时回退列表第一条。
export function resolveInitialConversationId(
  convs: Array<{ id: string }>,
  storedId: string | null,
): string | null {
  if (storedId && convs.some((c) => c.id === storedId)) return storedId;
  return convs[0]?.id ?? null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Conversation state ──
  const [folders, setFolders] = useState<Folder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);

  // ── Document state ──
  const [activeView, setActiveViewState] = useState<ActiveView>(() => {
    return (localStorage.getItem("pentou-active-view") as ActiveView) ?? "chat";
  });
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentFolders, setDocumentFolders] = useState<DocumentFolder[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [annotationsByDoc, setAnnotationsByDoc] = useState<Record<string, Annotation[]>>({});
  const [versionsByDoc, setVersionsByDoc] = useState<Record<string, DocumentVersion[]>>({});
  const [versionsByConv, setVersionsByConv] = useState<Record<string, ConversationVersion[]>>({});
  const [editMode, setEditMode] = useState<EditMode>("off");
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmConfig, setLlmConfigState] = useState<LLMConfig>(loadLLMFromLocalStorage);
  const [obsidianConfig, setObsidianConfigState] = useState<ObsidianConfig>(loadObsidianFromLocalStorage);
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingClientConfig | null>(null);

  // ── UI state ──
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("pentou-theme") as "light" | "dark") ?? "light";
  });
  const [language, setLanguageState] = useState<"en" | "zh">(() => {
    return (localStorage.getItem("pentou-language") as "en" | "zh") ?? "en";
  });
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchJump, setSearchJump] = useState<SearchJump | null>(null);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [aiSessions, setAiSessions] = useState<AiChatSession[]>([]);
  const [currentAiSession, setCurrentAiSessionState] = useState<AiChatSession>(() => createEmptyAiChatSession());
  const [isLoading, setIsLoading] = useState(true);

  // Hydration tracking: which ids have already been (or are being) fetched in full.
  // Refs (not state) so the dedupe check inside the effect sees the in-flight set
  // synchronously — important under React 18 strict-mode double-invocation.
  const hydratedConvRef = useRef<Set<string>>(new Set());
  const hydratedDocRef = useRef<Set<string>>(new Set());

  // Load from server on mount — lists use ?fields=meta to keep first paint cheap
  // on 1C1G hosts (PRD US-05). Full message bodies are hydrated on demand below.
  useEffect(() => {
    Promise.all([
      apiFetch("/api/folders").catch(() => []),
      apiFetch("/api/conversations?fields=meta").catch(() => []),
      apiFetch("/api/documents?fields=meta").catch(() => []),
      apiFetch("/api/document-folders").catch(() => []),
    ]).then(([foldersData, convsData, docsData, docFoldersData]) => {
      setFolders(foldersData as Folder[]);
      const convs = convsData as Conversation[];
      setConversations(convs);
      setActiveConversationIdState(
        resolveInitialConversationId(convs, localStorage.getItem("pentou-active-conversation")),
      );
      setDocuments(docsData as Document[]);
      setDocumentFolders(docFoldersData as DocumentFolder[]);
    }).finally(() => setIsLoading(false));
    // 嵌入后端配置：独立拉取（含 enabled/phase），供搜索浮层决定是否走 hybrid（spec §4.7）。
    apiFetch("/api/search/config")
      .then((data) => setEmbeddingConfig(data as EmbeddingClientConfig))
      .catch((e) => console.error({ module: "data", op: "loadEmbeddingConfig", err: e }));

    listAiChatSessions()
      .then((sessions) => {
        setAiSessions(sessions);
      })
      .catch((e) => console.error({ module: "data", op: "loadAiChats", err: e }));
  }, []);

  // On-demand hydration of the active conversation's messages.
  useEffect(() => {
    if (!activeConversationId) return;
    if (hydratedConvRef.current.has(activeConversationId)) return;
    hydratedConvRef.current.add(activeConversationId);
    const id = activeConversationId;
    apiFetch(`/api/conversations/${id}`)
      .then((full: Conversation) => {
        setConversations((prev) => prev.map((c) => (c.id === id ? full : c)));
      })
      .catch((e) => {
        hydratedConvRef.current.delete(id);
        console.error({ module: "data", op: "hydrateConv", err: e, context: { id } });
      });
  }, [activeConversationId]);

  // On-demand hydration of the active document's body.
  useEffect(() => {
    if (!activeDocId) return;
    if (hydratedDocRef.current.has(activeDocId)) return;
    hydratedDocRef.current.add(activeDocId);
    const id = activeDocId;
    apiFetch(`/api/documents/${id}`)
      .then((full: Document) => {
        setDocuments((prev) => prev.map((d) => (d.id === id ? full : d)));
      })
      .catch((e) => {
        hydratedDocRef.current.delete(id);
        console.error({ module: "data", op: "hydrateDoc", err: e, context: { id } });
      });
  }, [activeDocId]);

  const setTheme = useCallback((t: "light" | "dark") => {
    setThemeState(t);
    localStorage.setItem("pentou-theme", t);
  }, []);

  const setLanguage = useCallback((lang: "en" | "zh") => {
    setLanguageState(lang);
    localStorage.setItem("pentou-language", lang);
  }, []);

  const setActiveView = useCallback((view: ActiveView) => {
    setActiveViewState(view);
    localStorage.setItem("pentou-active-view", view);
  }, []);

  const setActiveConversationId = useCallback((id: string | null) => {
    setActiveConversationIdState(id);
    if (id) localStorage.setItem("pentou-active-conversation", id);
    else localStorage.removeItem("pentou-active-conversation");
  }, []);

  const toggleAiSidebar = useCallback(() => {
    setAiSidebarOpen((open) => !open);
  }, []);

  const setLlmConfig = useCallback((cfg: LLMConfig) => {
    setLlmConfigState(cfg);
    localStorage.setItem("pentou-llm-config", JSON.stringify(cfg));
  }, []);

  const setObsidianConfig = useCallback((cfg: ObsidianConfig) => {
    setObsidianConfigState(cfg);
    localStorage.setItem("pentou-obsidian-config", JSON.stringify(cfg));
  }, []);

  // 嵌入后端配置：服务端权威（含 phase/进度），不走 localStorage（spec §4.7）。
  const refreshEmbeddingConfig = useCallback(async () => {
    try {
      const data = await apiFetch("/api/search/config");
      setEmbeddingConfig(data as EmbeddingClientConfig);
    } catch (e) {
      console.error({ module: "data", op: "refreshEmbeddingConfig", err: e });
    }
  }, []);

  const saveEmbeddingConfig = useCallback(async (patch: { enabled?: boolean; endpoint?: string; model?: string; apiKey?: string }) => {
    const data = (await apiFetch("/api/search/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    })) as EmbeddingClientConfig;
    setEmbeddingConfig(data);
    return data;
  }, []);

  const refreshAiSessions = useCallback(async () => {
    const sessions = await listAiChatSessions();
    setAiSessions(sessions);
  }, []);

  const setCurrentAiSession = useCallback((next: AiChatSession | ((session: AiChatSession) => AiChatSession)) => {
    setCurrentAiSessionState((prevSession) => {
      const session = typeof next === "function" ? next(prevSession) : next;
      if (session.messages.length > 0) {
        setAiSessions((prev) => {
          const existing = prev.some((item) => item.id === session.id);
          const list = existing ? prev.map((item) => (item.id === session.id ? session : item)) : [session, ...prev];
          return list.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      }
      return session;
    });
  }, []);

  const saveAiSession = useCallback(async (session: AiChatSession) => {
    if (session.messages.length === 0) {
      setCurrentAiSessionState(session);
      return;
    }
    await saveAiChatFile(session);
    setCurrentAiSession(session);
  }, [setCurrentAiSession]);

  const createNewAiSession = useCallback(async () => {
    if (currentAiSession.messages.length > 0) {
      await saveAiChatFile(currentAiSession);
    }
    const next = createEmptyAiChatSession();
    setCurrentAiSessionState(next);
    await refreshAiSessions().catch(() => {});
    return next;
  }, [currentAiSession, refreshAiSessions]);

  const jumpToAiSessionContext = useCallback((session: AiChatSession): boolean => {
    if (session.contextType === "chat" && session.contextId) {
      if (conversations.some((item) => item.id === session.contextId)) {
        const didChange = activeView !== "chat" || activeConversationId !== session.contextId;
        setActiveView("chat");
        setActiveConversationId(session.contextId);
        return didChange;
      }
      return false;
    }
    if (session.contextType === "doc" && session.contextId) {
      if (documents.some((item) => item.id === session.contextId)) {
        const didChange = activeView !== "doc" || activeDocId !== session.contextId;
        setActiveView("doc");
        setActiveDocId(session.contextId);
        return didChange;
      }
    }
    return false;
  }, [activeConversationId, activeDocId, activeView, conversations, documents, setActiveView]);

  const selectAiSession = useCallback(async (id: string) => {
    const existing = aiSessions.find((session) => session.id === id);
    if (existing) {
      setCurrentAiSessionState(existing);
      const didJump = jumpToAiSessionContext(existing);
      return { session: existing, didJump };
    }
    const sessions = await listAiChatSessions();
    const target = sessions.find((session) => session.id === id);
    setAiSessions(sessions);
    if (target) {
      setCurrentAiSessionState(target);
      const didJump = jumpToAiSessionContext(target);
      return { session: target, didJump };
    }
    return { session: null, didJump: false };
  }, [aiSessions, jumpToAiSessionContext]);

  const deleteAiSession = useCallback(async (id: string) => {
    await deleteAiChatFile(id);
    setAiSessions((prev) => prev.filter((session) => session.id !== id));
    if (currentAiSession.id === id) {
      setCurrentAiSessionState(createEmptyAiChatSession());
    }
  }, [currentAiSession.id]);

  // ── Folder operations ───────────────────────────────────────────────────────

  const saveFolders = useCallback(async (newFolders: Folder[]) => {
    setFolders(newFolders);
    await apiFetch("/api/folders", { method: "POST", body: JSON.stringify(newFolders) });
  }, []);

  const addFolder = useCallback(async (name: string, platform?: Platform) => {
    const folder: Folder = { id: generateId("f"), name, platform };
    await saveFolders([...folders, folder]);
  }, [folders, saveFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    await saveFolders(folders.map((f) => (f.id === id ? { ...f, name } : f)));
  }, [folders, saveFolders]);

  const deleteFolder = useCallback(async (id: string) => {
    const affected = conversations.filter((c) => c.folderId === id);
    setConversations((prev) =>
      prev.map((c) => (c.folderId === id ? { ...c, folderId: null } : c))
    );
    for (const c of affected) {
      await apiFetch(`/api/conversations/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({ folderId: null }),
      });
    }
    await saveFolders(folders.filter((f) => f.id !== id));
  }, [folders, conversations, saveFolders]);

  // ── Conversation operations ─────────────────────────────────────────────────

  const addConversations = useCallback(async (convs: Conversation[]): Promise<ImportSummary> => {
    const items: ImportActionItem[] = [];
    const created: Conversation[] = [];
    const merged: { id: string; conv: Conversation }[] = [];
    const now = new Date().toISOString();

    for (const conv of convs) {
      try {
        const r = await apiFetch("/api/conversations", { method: "POST", body: JSON.stringify(conv) });
        const action: ImportActionItem["action"] = r.action ?? "created";
        const savedConv: Conversation = r.conversation ?? { ...conv, id: r.id ?? conv.id, updatedAt: now };
        items.push({ action, id: r.id ?? conv.id, title: r.title ?? conv.title });
        if (action === "created") created.push(savedConv);
        else if (action === "merged") merged.push({ id: r.id, conv: savedConv });
      } catch (e) {
        console.error("Failed to save conversation", conv.id, e);
      }
    }

    // 自动归类可能在服务端新建了平台文件夹（spec import-auto-classify §4.1）→ 刷新列表
    if (created.length > 0) {
      try {
        setFolders((await apiFetch("/api/folders")) as Folder[]);
      } catch (e) {
        console.error("Failed to refresh folders after import", e);
      }
    }

    // Imported conversations carry full messages; mark hydrated so on-demand fetch is skipped.
    created.forEach((c) => hydratedConvRef.current.add(c.id));
    merged.forEach((m) => {
      hydratedConvRef.current.add(m.id);
      // 版本列表已变（多了 pre-import-overwrite + import），失效缓存以便面板重新拉取
      setVersionsByConv((prev) => {
        if (!prev[m.id]) return prev;
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
    });

    setConversations((prev) => {
      // 合并：用新内容覆盖已有条目的 messages/title，保留其 folderId（后端权威），刷新 updatedAt
      let next = prev.map((c) => {
        const m = merged.find((x) => x.id === c.id);
        return m ? { ...c, messages: m.conv.messages, title: m.conv.title, updatedAt: now } : c;
      });
      // 新建：追加不存在的条目
      const existing = new Set(next.map((c) => c.id));
      const fresh = created.filter((c) => !existing.has(c.id));
      return [...next, ...fresh];
    });

    // 激活第一条非跳过项，便于用户立即看到结果
    const firstActive = items.find((i) => i.action !== "skipped");
    if (firstActive) setActiveConversationId(firstActive.id);

    return {
      created: items.filter((i) => i.action === "created").length,
      merged: items.filter((i) => i.action === "merged").length,
      skipped: items.filter((i) => i.action === "skipped").length,
      items,
    };
  }, []);

  // ── Conversation version operations（对齐文档；spec 决策5） ──────────────────

  const loadConversationVersions = useCallback(async (convId: string) => {
    try {
      const data = await apiFetch(`/api/conversations/${convId}/versions`);
      setVersionsByConv((prev) => ({ ...prev, [convId]: data.versions ?? [] }));
    } catch (e) {
      // 无版本历史（老数据）时后端返回 404；视为空列表
      setVersionsByConv((prev) => ({ ...prev, [convId]: [] }));
      console.error({ module: "data", op: "loadConversationVersions", err: e, context: { convId } });
    }
  }, []);

  const rollbackConversation = useCallback(async (convId: string, targetVersionId: string) => {
    const data = await apiFetch(`/api/conversations/${convId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ targetVersionId }),
    });
    await loadConversationVersions(convId);
    const conv = data.conversation as Conversation | undefined;
    if (conv) {
      hydratedConvRef.current.add(convId);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, ...conv } : c)));
    }
  }, [loadConversationVersions]);

  const moveConversation = useCallback(async (convId: string, folderId: string | null) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, folderId } : c))
    );
    await apiFetch(`/api/conversations/${convId}`, {
      method: "PUT",
      body: JSON.stringify({ folderId }),
    });
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) setActiveConversationId(null);
    hydratedConvRef.current.delete(id);
    await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
  }, [activeConversationId]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
    await apiFetch(`/api/conversations/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
  }, []);

  // ── Document operations ─────────────────────────────────────────────────────

  const addDocuments = useCallback(async (docs: Document[]) => {
    const results: Document[] = [];
    for (const doc of docs) {
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        });
        if (res.status === 401) {
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
          throw new Error("API /api/documents unauthenticated");
        }
        // 409: doc 已在盘上（例如经 /api/import/document 创建），仅同步本地状态
        if (res.status === 409) {
          results.push(doc);
          continue;
        }
        if (!res.ok) throw new Error(`API /api/documents failed: ${res.status}`);
        const saved = await res.json();
        results.push((saved.document ?? doc) as Document);
      } catch (e) {
        console.error({ module: "data", op: "addDocuments", err: e, context: { docId: doc.id } });
      }
    }
    results.forEach((d) => hydratedDocRef.current.add(d.id));
    setDocuments((prev) => {
      // upsert：已存在的按 id 用最新结果替换（导入合并到既有文档时刷新正文/updatedAt），其余追加
      const byId = new Map<string, Document>(prev.map((d) => [d.id, d]));
      for (const d of results) {
        const existing = byId.get(d.id);
        byId.set(d.id, existing ? { ...existing, ...d } : d);
      }
      return Array.from(byId.values());
    });
    if (results.length > 0) setActiveDocId(results[0].id);
  }, []);

  const updateDocument = useCallback(async (id: string, patch: Partial<Document>) => {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    await apiFetch(`/api/documents/${id}`, { method: "PUT", body: JSON.stringify(patch) });
  }, []);

  const saveDocumentBody = useCallback(async (id: string, newBody: string): Promise<DocumentVersion> => {
    const data = await apiFetch(`/api/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify({ body: newBody }),
    });
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, body: newBody, currentVersionId: data.version?.id ?? d.currentVersionId, updatedAt: new Date().toISOString() }
          : d
      )
    );
    return data.version as DocumentVersion;
  }, []);

  // 上传 .md 覆盖更新指定文档（spec doc-upload-update US-01）
  const uploadDocumentUpdate = useCallback(async (id: string, file: File): Promise<"merged" | "skipped"> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/documents/${id}/upload-update`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error ?? `API /api/documents/${id}/upload-update failed: ${res.status}`);
    }
    const data = await res.json();
    if (data.action === "merged" && data.document) {
      hydratedDocRef.current.add(id);
      setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...data.document } : d)));
    }
    return data.action;
  }, []);

  const deleteDocument = useCallback(async (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (activeDocId === id) setActiveDocId(null);
    hydratedDocRef.current.delete(id);
    await apiFetch(`/api/documents/${id}`, { method: "DELETE" });
  }, [activeDocId]);

  const renameDocument = useCallback(async (id: string, title: string) => {
    await updateDocument(id, { title });
  }, [updateDocument]);

  const moveDocument = useCallback(async (docId: string, folderId: string | null) => {
    await updateDocument(docId, { folderId });
  }, [updateDocument]);

  const saveDocumentFolders = useCallback(async (newFolders: DocumentFolder[]) => {
    setDocumentFolders(newFolders);
    await apiFetch("/api/document-folders", { method: "POST", body: JSON.stringify(newFolders) });
  }, []);

  const addDocumentFolder = useCallback(async (name: string) => {
    const folder: DocumentFolder = { id: generateId("df"), name };
    await saveDocumentFolders([...documentFolders, folder]);
  }, [documentFolders, saveDocumentFolders]);

  const renameDocumentFolder = useCallback(async (id: string, name: string) => {
    await saveDocumentFolders(documentFolders.map((f) => (f.id === id ? { ...f, name } : f)));
  }, [documentFolders, saveDocumentFolders]);

  const deleteDocumentFolder = useCallback(async (id: string) => {
    const affectedDocs = documents.filter((d) => d.folderId === id);
    setDocuments((prev) => prev.map((d) => (d.folderId === id ? { ...d, folderId: null } : d)));
    for (const doc of affectedDocs) {
      await apiFetch(`/api/documents/${doc.id}`, { method: "PUT", body: JSON.stringify({ folderId: null }) });
    }
    await saveDocumentFolders(documentFolders.filter((f) => f.id !== id));
  }, [documents, documentFolders, saveDocumentFolders]);


  // ── Annotation operations ───────────────────────────────────────────────────

  const loadAnnotations = useCallback(async (docId: string) => {
    try {
      const data = await apiFetch(`/api/documents/${docId}/annotations`);
      setAnnotationsByDoc((prev) => ({ ...prev, [docId]: data.annotations ?? [] }));
    } catch (e) {
      console.error({ module: "data", op: "loadAnnotations", err: e, context: { docId } });
    }
  }, []);

  const upsertAnnotation = useCallback(async (anno: Annotation) => {
    setAnnotationsByDoc((prev) => {
      const existing = prev[anno.docId] ?? [];
      const idx = existing.findIndex((a) => a.id === anno.id);
      const updated = idx === -1 ? [...existing, anno] : existing.map((a, i) => (i === idx ? anno : a));
      return { ...prev, [anno.docId]: updated };
    });
    setAnnotationsByDoc((prev) => {
      const annos = prev[anno.docId] ?? [];
      apiFetch(`/api/documents/${anno.docId}/annotations`, {
        method: "PUT",
        body: JSON.stringify({ annotations: annos }),
      }).catch((e) => console.error({ module: "data", op: "upsertAnnotation", err: e }));
      return prev;
    });
  }, []);

  const deleteAnnotation = useCallback(async (docId: string, annoId: string) => {
    setAnnotationsByDoc((prev) => {
      const updated = (prev[docId] ?? []).filter((a) => a.id !== annoId);
      apiFetch(`/api/documents/${docId}/annotations`, {
        method: "PUT",
        body: JSON.stringify({ annotations: updated }),
      }).catch((e) => console.error({ module: "data", op: "deleteAnnotation", err: e }));
      return { ...prev, [docId]: updated };
    });
  }, []);

  const setAnnotationsForDoc = useCallback(async (docId: string, annos: Annotation[]) => {
    setAnnotationsByDoc((prev) => ({ ...prev, [docId]: annos }));
    await apiFetch(`/api/documents/${docId}/annotations`, {
      method: "PUT",
      body: JSON.stringify({ annotations: annos }),
    });
  }, []);

  // ── Version operations ──────────────────────────────────────────────────────

  const loadVersions = useCallback(async (docId: string) => {
    try {
      const data = await apiFetch(`/api/documents/${docId}/versions`);
      setVersionsByDoc((prev) => ({ ...prev, [docId]: data.versions ?? [] }));
    } catch (e) {
      console.error({ module: "data", op: "loadVersions", err: e, context: { docId } });
    }
  }, []);

  const commitVersion = useCallback(async (
    docId: string,
    body: string,
    type: VersionType,
    sourceAnnotationIds?: string[],
  ): Promise<DocumentVersion> => {
    const data = await apiFetch(`/api/documents/${docId}/commit-version`, {
      method: "POST",
      body: JSON.stringify({ body, type, sourceAnnotationIds }),
    });
    const ver = data.version as DocumentVersion;
    setVersionsByDoc((prev) => {
      const existing = prev[docId];
      if (!existing) return prev;
      return { ...prev, [docId]: [...existing, ver] };
    });
    const switchCurrentTypes: VersionType[] = ["llm-rewrite", "manual-edit", "conversation-excerpt", "rolled-back-from"];
    if (switchCurrentTypes.includes(type)) {
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, body, currentVersionId: ver.id, updatedAt: new Date().toISOString() } : d))
      );
    }
    return ver;
  }, []);

  const rollbackToVersion = useCallback(async (docId: string, targetVersionId: string): Promise<DocumentVersion> => {
    const data = await apiFetch(`/api/documents/${docId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ targetVersionId }),
    });
    const ver = data.version as DocumentVersion;
    await loadVersions(docId);
    const docData = await apiFetch(`/api/documents/${docId}`);
    setDocuments((prev) => prev.map((d) => (d.id === docId ? docData : d)));
    return ver;
  }, [loadVersions]);

  const deleteVersion = useCallback(async (docId: string, versionId: string) => {
    await apiFetch(`/api/documents/${docId}/versions/${versionId}`, { method: "DELETE" });
    setVersionsByDoc((prev) => ({
      ...prev,
      [docId]: (prev[docId] ?? []).filter((v) => v.id !== versionId),
    }));
  }, []);

  return (
    <AppContext.Provider
      value={{
        folders,
        conversations,
        activeConversationId,
        setActiveConversationId,
        addConversations,
        moveConversation,
        deleteConversation,
        renameConversation,
        versionsByConv,
        loadConversationVersions,
        rollbackConversation,
        addFolder,
        renameFolder,
        deleteFolder,
        activeView,
        setActiveView,
        documents,
        documentFolders,
        activeDocId,
        setActiveDocId,
        annotationsByDoc,
        versionsByDoc,
        editMode,
        setEditMode,
        previewingVersionId,
        setPreviewingVersionId,
        versionPanelOpen,
        setVersionPanelOpen,
        settingsOpen,
        setSettingsOpen,
        llmConfig,
        obsidianConfig,
        setLlmConfig,
        setObsidianConfig,
        embeddingConfig,
        refreshEmbeddingConfig,
        saveEmbeddingConfig,
        addDocuments,
        updateDocument,
        saveDocumentBody,
        uploadDocumentUpdate,
        deleteDocument,
        renameDocument,
        moveDocument,
        addDocumentFolder,
        renameDocumentFolder,
        deleteDocumentFolder,
        loadAnnotations,
        upsertAnnotation,
        deleteAnnotation,
        setAnnotationsForDoc,
        loadVersions,
        commitVersion,
        rollbackToVersion,
        deleteVersion,
        theme,
        setTheme,
        language,
        setLanguage,
        isDrawerOpen,
        setDrawerOpen,
        searchOpen,
        setSearchOpen,
        searchJump,
        setSearchJump,
        aiSidebarOpen,
        setAiSidebarOpen,
        toggleAiSidebar,
        aiSessions,
        currentAiSession,
        setCurrentAiSession,
        saveAiSession,
        createNewAiSession,
        selectAiSession,
        deleteAiSession,
        refreshAiSessions,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};
