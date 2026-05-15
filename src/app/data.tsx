import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { DEFAULT_LLM_CONFIG } from "./llm";
import { generateDocId, generateAnnotationId } from "./doc-utils";

export type Platform = "ChatGPT" | "DeepSeek" | "Gemini" | "Claude" | "CLI" | "Cursor" | "Copilot" | "Codex";

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
  addConversations: (convs: Conversation[]) => Promise<void>;
  moveConversation: (convId: string, folderId: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
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
  addDocuments: (docs: Document[]) => Promise<void>;
  updateDocument: (id: string, patch: Partial<Document>) => Promise<void>;
  saveDocumentBody: (id: string, newBody: string) => Promise<DocumentVersion>;
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
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isLoading: boolean;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Conversation state ──
  const [folders, setFolders] = useState<Folder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // ── Document state ──
  const [activeView, setActiveViewState] = useState<ActiveView>(() => {
    return (localStorage.getItem("pentou-active-view") as ActiveView) ?? "chat";
  });
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentFolders, setDocumentFolders] = useState<DocumentFolder[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [annotationsByDoc, setAnnotationsByDoc] = useState<Record<string, Annotation[]>>({});
  const [versionsByDoc, setVersionsByDoc] = useState<Record<string, DocumentVersion[]>>({});
  const [editMode, setEditMode] = useState<EditMode>("off");
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmConfig, setLlmConfigState] = useState<LLMConfig>(loadLLMFromLocalStorage);
  const [obsidianConfig, setObsidianConfigState] = useState<ObsidianConfig>(loadObsidianFromLocalStorage);

  // ── UI state ──
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("pentou-theme") as "light" | "dark") ?? "light";
  });
  const [language, setLanguageState] = useState<"en" | "zh">(() => {
    return (localStorage.getItem("pentou-language") as "en" | "zh") ?? "en";
  });
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
      if (convs.length > 0) setActiveConversationId(convs[0].id);
      setDocuments(docsData as Document[]);
      setDocumentFolders(docFoldersData as DocumentFolder[]);
    }).finally(() => setIsLoading(false));
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

  const setLlmConfig = useCallback((cfg: LLMConfig) => {
    setLlmConfigState(cfg);
    localStorage.setItem("pentou-llm-config", JSON.stringify(cfg));
  }, []);

  const setObsidianConfig = useCallback((cfg: ObsidianConfig) => {
    setObsidianConfigState(cfg);
    localStorage.setItem("pentou-obsidian-config", JSON.stringify(cfg));
  }, []);

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

  const addConversations = useCallback(async (convs: Conversation[]) => {
    const results: Conversation[] = [];
    for (const conv of convs) {
      try {
        await apiFetch("/api/conversations", { method: "POST", body: JSON.stringify(conv) });
        results.push(conv);
      } catch (e) {
        console.error("Failed to save conversation", conv.id, e);
      }
    }
    // Newly added conversations already carry their full messages; mark them hydrated
    // so on-demand fetch doesn't run when the user activates them right after import.
    results.forEach((c) => hydratedConvRef.current.add(c.id));
    setConversations((prev) => {
      const existing = new Set(prev.map((c) => c.id));
      const fresh = results.filter((c) => !existing.has(c.id));
      return [...prev, ...fresh];
    });
    if (results.length > 0) setActiveConversationId(results[0].id);
  }, []);

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
      const existing = new Set(prev.map((d) => d.id));
      const fresh = results.filter((d) => !existing.has(d.id));
      return [...prev, ...fresh];
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
        addDocuments,
        updateDocument,
        saveDocumentBody,
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
        searchQuery,
        setSearchQuery,
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
