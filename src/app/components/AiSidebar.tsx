import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, Clock3, CornerDownLeft, Copy, FileText, History, Loader2, MessageSquare, Plus, Settings, Square, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { useAppContext } from "../data";
import { useIsMobile } from "../hooks/useIsMobile";
import { useVisualViewport } from "../hooks/useVisualViewport";
import {
  AiChatSession,
  AiSidebarMessage,
  createEmptyAiChatSession,
  deriveAiChatTitle,
  generateAiMessageId,
} from "../ai-chats";
import { DEFAULT_PROMPT_AI_SIDEBAR, LLMError, chatCompletion, serializeConversation, ChatMessage } from "../llm";
import { fetchRetrievalHits, formatContextBlock } from "../skills/ask-ai-context";
import { generateDocId } from "../doc-utils";
import { copyText } from "../utils/clipboard";
import { useTranslation } from "../i18n";
import { formatDisplayDate } from "../utils/dateFormat";
import { ImageGalleryProvider, MarkdownImage, imageUrlTransform } from "./ImageLightbox";

// 图片获得与对话/文档一致的渲染（spec media-assets US-01）
const aiMarkdownComponents = {
  h1: ({ node, ...props }: any) => <h1 className="mt-5 mb-2 text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-zinc-950 dark:text-zinc-50" {...props} />,
  h2: ({ node, ...props }: any) => <h2 className="mt-5 mb-2 border-b border-zinc-200/80 pb-1.5 text-[1.35rem] font-semibold leading-tight tracking-[-0.015em] text-zinc-900 dark:border-white/10 dark:text-zinc-100" {...props} />,
  h3: ({ node, ...props }: any) => <h3 className="mt-4 mb-2 text-[1.1rem] font-semibold leading-snug text-zinc-900 dark:text-zinc-100" {...props} />,
  p: ({ node, ...props }: any) => <p className="mb-3 leading-7 last:mb-0" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="mb-3 list-disc space-y-1.5 pl-5 marker:text-zinc-400 dark:marker:text-zinc-600" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400" {...props} />,
  li: ({ node, ...props }: any) => <li className="pl-1 leading-7" {...props} />,
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="my-4 rounded-r-md border-l-2 border-zinc-300 bg-zinc-50/80 py-2 pl-3 text-zinc-700 dark:border-zinc-600 dark:bg-white/5 dark:text-zinc-300" {...props} />
  ),
  pre: ({ children, ...props }: any) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[13px] leading-6 text-zinc-800 shadow-sm custom-scrollbar dark:border-white/10 dark:bg-[#1A1A1A] dark:text-zinc-200" {...props}>
      {children}
    </pre>
  ),
  code: ({ node, className, children, ...props }: any) => {
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return <code className={clsx(className, "font-mono")} {...props}>{children}</code>;
    }
    return (
      <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.92em] text-zinc-800 dark:bg-white/10 dark:text-zinc-200" {...props}>
        {children}
      </code>
    );
  },
  img: ({ node, src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
  a: ({ node, ...props }: any) => (
    <a className="text-blue-600 underline decoration-blue-200 underline-offset-2 transition-colors hover:text-foreground dark:text-blue-400 dark:decoration-blue-400/40 dark:hover:text-foreground" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  table: ({ node, ...props }: any) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-white/10">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-white/10" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="bg-zinc-50 dark:bg-white/5" {...props} />,
  tbody: ({ node, ...props }: any) => <tbody className="divide-y divide-zinc-200 dark:divide-white/10 bg-white dark:bg-[#1A1A1A]" {...props} />,
  th: ({ node, ...props }: any) => <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-zinc-700 dark:text-zinc-200" {...props} />,
  td: ({ node, ...props }: any) => <td className="px-3 py-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300" {...props} />,
};

const CONTEXT_CHAR_LIMIT = 12000;
const MESSAGE_CHAR_LIMIT = 18000;

type ContextSnapshot = {
  label: string;
  content: string;
  truncated: boolean;
  savedBodyHint: boolean;
};

export function AiSidebar() {
  const {
    aiSidebarOpen,
    setAiSidebarOpen,
    aiSessions,
    currentAiSession,
    setCurrentAiSession,
    saveAiSession,
    createNewAiSession,
    selectAiSession,
    deleteAiSession,
    refreshAiSessions,
    activeView,
    activeConversationId,
    activeDocId,
    conversations,
    documents,
    editMode,
    llmConfig,
    setSettingsOpen,
    addDocuments,
    setActiveView,
    setActiveDocId,
  } = useAppContext();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // 全屏面板贴合软键盘：键盘弹出时容器收缩到键盘之上，标题栏顶端不动（仅移动端 + 打开时生效）。
  const viewport = useVisualViewport(isMobile && aiSidebarOpen);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKeyRef = useRef<string | null>(null);
  const selectingHistoryRef = useRef(false);

  const hasLLM = !!(llmConfig.endpoint && llmConfig.apiKey && llmConfig.model);
  const context = useMemo(() => {
    return buildContextSnapshot({
      activeView,
      activeConversationId,
      activeDocId,
      conversations,
      documents,
      editMode,
    });
  }, [activeView, activeConversationId, activeDocId, conversations, documents, editMode]);

  const isCurrentEmpty = currentAiSession.messages.length === 0;
  const canOpenHistory = aiSessions.length > 0;
  const contextKey = `${activeView}:${activeView === "chat" ? activeConversationId ?? "" : activeDocId ?? ""}`;
  const contextDisplayLabel = context.label
    ? `${t("aiSidebar.contextPrefix")}: ${context.label}`
    : t("aiSidebar.noContext");

  // 移动端进入不自动聚焦（避免一进来就弹软键盘并顶起面板，调整批次 issue 1）；桌面维持自动聚焦。
  useEffect(() => {
    if (!aiSidebarOpen || isMobile) return;
    inputRef.current?.focus();
  }, [aiSidebarOpen, currentAiSession.id, isMobile]);

  useEffect(() => {
    if (!aiSidebarOpen) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [aiSidebarOpen, currentAiSession.messages, streamingId]);

  useEffect(() => {
    if (contextKeyRef.current === null) {
      contextKeyRef.current = contextKey;
      return;
    }
    if (contextKeyRef.current === contextKey) return;
    contextKeyRef.current = contextKey;
    if (selectingHistoryRef.current) {
      selectingHistoryRef.current = false;
      return;
    }
    setInput("");
    setHistoryOpen(false);
    if (streamingId) {
      abortRef.current?.abort();
    }
    if (!isCurrentEmpty || streamingId) {
      setCurrentAiSession(createEmptyAiChatSession());
    }
  }, [contextKey, isCurrentEmpty, setCurrentAiSession, streamingId]);

  const persist = async (session: AiChatSession) => {
    setCurrentAiSession(session);
    try {
      await saveAiSession(session);
      await refreshAiSessions();
    } catch {
      toast.error(t("aiSidebar.saveFailed"));
    }
  };

  const handleSend = async (text = input) => {
    const question = text.trim();
    if (!question || streamingId) return;
    if (!hasLLM) {
      setSettingsOpen(true);
      toast.info(t("aiSidebar.configureModel"));
      return;
    }

    setInput("");
    const now = new Date().toISOString();
    const userMessage: AiSidebarMessage = {
      id: generateAiMessageId(),
      role: "user",
      content: question,
      status: "done",
      contextLabel: contextDisplayLabel,
    };
    const assistantMessage: AiSidebarMessage = {
      id: generateAiMessageId(),
      role: "assistant",
      content: "",
      status: "streaming",
      contextLabel: contextDisplayLabel,
      retrievalStatus: "searching",
    };
    const baseSession: AiChatSession = {
      ...currentAiSession,
      title: currentAiSession.title || deriveAiChatTitle(question),
      model: llmConfig.model,
      contextType: currentAiSession.contextType ?? activeView,
      contextId: currentAiSession.contextId ?? (activeView === "chat" ? activeConversationId ?? undefined : activeDocId ?? undefined),
      updatedAt: now,
      messages: [...currentAiSession.messages, userMessage, assistantMessage],
    };
    setCurrentAiSession(baseSession);
    setStreamingId(assistantMessage.id);

    const controller = new AbortController();
    abortRef.current = controller;
    let partial = "";

    // 检索增强（ask-ai-context，Option 1）：先经 /api/search 取相关片段注入上下文；
    // 与技能走同一 /api 契约。检索失败不阻断作答，退回仅用当前视图上下文。
    let citations: NonNullable<AiSidebarMessage["citations"]> = [];
    let retrievalBlock = "";
    try {
      const hits = await fetchRetrievalHits(question, { apiBase: "", fetchImpl: fetch.bind(window) });
      citations = hits.map((h) => ({ type: h.type, id: h.id, title: h.title }));
      if (hits.length) retrievalBlock = formatContextBlock(hits);
    } catch {
      /* 检索失败：忽略，仅用当前上下文作答 */
    }
    // 把检索结果落进一个新的会话快照，供后续 finish / catch 复用；不能只靠函数式 setState，
    // 否则 finishAssistantMessage 从过期的 baseSession 重建会把 retrievalStatus 改回 searching、丢掉 citations。
    const answeredBase: AiChatSession = {
      ...baseSession,
      messages: baseSession.messages.map((message) =>
        message.id === assistantMessage.id
          ? { ...message, retrievalStatus: "done" as const, retrievalCount: citations.length, citations }
          : message,
      ),
    };
    setCurrentAiSession(answeredBase);

    try {
      const augmentedContext = retrievalBlock
        ? `${context.content}\n\n# 检索到的相关片段\n\n${retrievalBlock}`.trim()
        : context.content;
      const messages = buildLLMMessages(answeredBase.messages, question, augmentedContext);
      partial = await chatCompletion(
        llmConfig,
        messages,
        (chunk) => {
          partial += chunk;
          setCurrentAiSession((session) => ({
            ...session,
            updatedAt: new Date().toISOString(),
            messages: session.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: partial } : message
            ),
          }));
        },
        controller.signal,
      );
      const doneSession = finishAssistantMessage(answeredBase, assistantMessage.id, partial, controller.signal.aborted ? "aborted" : "done");
      await persist(doneSession);
    } catch (e: any) {
      const summary = e instanceof LLMError
        ? `LLM Error ${e.context.status}: ${e.message}`
        : String(e?.message ?? e);
      const errorSession: AiChatSession = {
        ...answeredBase,
        updatedAt: new Date().toISOString(),
        messages: answeredBase.messages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content: "", status: "error", error: summary, retrievalStatus: undefined }
            : message
        ),
      };
      setCurrentAiSession(errorSession);
    } finally {
      abortRef.current = null;
      setStreamingId(null);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewSession = async () => {
    if (isCurrentEmpty) return;
    await createNewAiSession();
    setHistoryOpen(false);
    if (!isMobile) inputRef.current?.focus(); // 移动端不主动聚焦（issue 1）
  };

  const handleSelectSession = async (id: string) => {
    selectingHistoryRef.current = true;
    try {
      const result = await selectAiSession(id);
      if (!result.didJump) {
        selectingHistoryRef.current = false;
      }
      setHistoryOpen(false);
    } catch (e) {
      selectingHistoryRef.current = false;
      throw e;
    }
  };

  const handleDeleteSession = async (id: string) => {
    await deleteAiSession(id);
    await refreshAiSessions().catch(() => {});
  };

  const handleCopy = async (message: AiSidebarMessage) => {
    if (await copyText(message.content)) {
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 1600);
    }
  };

  const handleMessageToDoc = async (message: AiSidebarMessage) => {
    await createDocumentFromAi(message.content, titleFromMarkdown(message.content), currentAiSession.id);
  };

  const handleThreadToDoc = async () => {
    const body = serializeAiThread(currentAiSession);
    const title = currentAiSession.title || deriveAiChatTitle(currentAiSession.messages.find((m) => m.role === "user")?.content ?? "AI chat");
    await createDocumentFromAi(body, title, currentAiSession.id);
  };

  const createDocumentFromAi = async (body: string, title: string, sessionId: string) => {
    const now = new Date().toISOString();
    const docId = generateDocId();
    await addDocuments([{
      id: docId,
      title,
      folderId: null,
      createdAt: now,
      updatedAt: now,
      body,
      currentVersionId: "",
      sourceAiChatId: sessionId,
      generatedBy: llmConfig.model,
      generatedAt: now,
    }]);
    setActiveView("doc");
    setActiveDocId(docId);
    toast.success(t("aiSidebar.docCreated"));
  };

  const panelContent = (
    <>
      <header className="relative z-10 shrink-0 px-4 py-3">
        <div className="flex h-8 items-center gap-1">
          <h2 className="flex-1 text-sm font-semibold tracking-normal text-zinc-950 dark:text-zinc-100">{t("aiSidebar.chat")}</h2>
          <IconButton
            title={t("aiSidebar.newChat")}
            disabled={isCurrentEmpty}
            onClick={handleNewSession}
            icon={<Plus size={16} />}
          />
          <div
            className="relative"
            onMouseEnter={() => canOpenHistory && setHistoryOpen(true)}
            onMouseLeave={() => setHistoryOpen(false)}
          >
            <IconButton
              title={t("aiSidebar.history")}
              disabled={!canOpenHistory}
              onClick={() => setHistoryOpen((open) => !open)}
              icon={<History size={16} />}
            />
            {historyOpen && canOpenHistory && (
              <HistoryPanel
                sessions={aiSessions}
                currentId={currentAiSession.id}
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
              />
            )}
          </div>
          <IconButton
            title={t("aiSidebar.close")}
            onClick={() => setAiSidebarOpen(false)}
            icon={isMobile ? <X size={18} /> : <ChevronRight size={17} />}
          />
        </div>
      </header>

      {/* 固定区：上下文感知栏 + 未配置模型提醒。移动端全屏时与标题栏一起全程固定，不随键盘 / 消息滚动（issue 2）。 */}
      <div className="shrink-0 px-4">
        <ContextPill context={context} label={contextDisplayLabel} />
        {!hasLLM && (
          <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">{t("aiSidebar.configureModel")}</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-2 h-auto gap-1.5 px-2.5 py-1.5 text-xs"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={13} />
              {t("toolbar.settings")}
            </Button>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4 pt-1 custom-scrollbar">
        {currentAiSession.messages.length === 0 ? (
          <EmptyState activeView={activeView} onAsk={handleSend} faded={isMobile && inputFocused} />
        ) : (
          <ImageGalleryProvider>
            <div className="space-y-5">
              {currentAiSession.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  streaming={message.id === streamingId}
                  copied={copiedId === message.id}
                  onCopy={() => handleCopy(message)}
                  onToDoc={() => handleMessageToDoc(message)}
                  onRetry={() => message.role === "assistant" && retryMessage(currentAiSession, message.id, handleSend)}
                />
              ))}
            </div>
          </ImageGalleryProvider>
        )}
      </div>

      <footer className="shrink-0 bg-white px-4 pb-4 pt-2 dark:bg-[#151515]">
        {currentAiSession.messages.some((message) => message.role === "assistant" && message.content.trim()) && (
          <Button
            variant="outline"
            size="sm"
            className="mb-3 h-auto gap-1.5 px-2.5 py-1.5 text-xs"
            onClick={handleThreadToDoc}
          >
            <FileText size={14} />
            {t("aiSidebar.threadToDoc")}
          </Button>
        )}
        {/* 快捷键提示：移动端不显示（无实体键盘，issue 2）。 */}
        {!isMobile && (
          <div className="mb-3 text-[13px] text-zinc-500 dark:text-zinc-400">
            {t("aiSidebar.shortcutTip")} <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/10 dark:text-zinc-200">⌘</kbd> <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/10 dark:text-zinc-200">I</kbd>
          </div>
        )}
        <div className="rounded-md border border-zinc-200 bg-white p-3 transition-colors focus-within:border-zinc-400 dark:border-white/10 dark:bg-[#1A1A1A] dark:focus-within:border-white/30">
          <textarea
            ref={inputRef}
            value={input}
            maxLength={1000}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={isMobile ? 2 : 3}
            placeholder={t("aiSidebar.placeholder")}
            className="w-full resize-none bg-transparent text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <div className="flex items-end gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {llmConfig.model || t("settings.llm.model")}
            </span>
            <Button
              variant="primary"
              size="icon"
              onClick={streamingId ? handleStop : () => handleSend()}
              disabled={!streamingId && !input.trim()}
              className="size-8 transition-[opacity,transform] hover:scale-[1.02] active:scale-95 disabled:opacity-30"
              title={streamingId ? t("aiSidebar.stop") : t("aiSidebar.send")}
            >
              {streamingId ? <Square size={14} fill="currentColor" /> : <CornerDownLeft size={16} />}
            </Button>
          </div>
        </div>
      </footer>
    </>
  );

  // 移动端（spec US-05，调整批次）：右下 Ask AI 悬浮按钮 + 全屏面板（复用同一 Chat 内容主体）。
  // 关键：容器保持 `fixed inset-0` **绝对不动**——iOS Safari 上若随 visualViewport 用 transform/height 移动容器，
  // 会与系统聚焦滚动打架，出现「整屉上下刷动 / 闪烁露底」（issue 1/2，纯 iOS 行为）。改为仅给内容列加
  // `paddingBottom = 键盘高度`：标题 / 上下文 / 提醒固定在顶不动，中部消息区被压缩，仅 footer 输入框抬到键盘之上。
  // scrollRef `overscroll-contain` 阻断链式滚动；motion 的 y 仅用于开合滑入，不参与键盘避让。
  if (isMobile) {
    return (
      <>
        {!aiSidebarOpen && (
          <button
            onClick={() => setAiSidebarOpen(true)}
            aria-label={t("aiSidebar.chat")}
            className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 transition-transform active:scale-95 md:hidden"
          >
            <MessageSquare size={22} />
          </button>
        )}
        {createPortal(
          <AnimatePresence>
            {aiSidebarOpen && (
              <motion.div
                key="ai-fullscreen"
                className="fixed inset-0 z-[60] flex min-w-0 flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] text-zinc-950 dark:bg-[#151515] dark:text-zinc-100 md:hidden"
                style={viewport && viewport.keyboard > 0 ? { paddingBottom: viewport.keyboard } : undefined}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 34, stiffness: 340 }}
              >
                {panelContent}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div
      className={clsx(
        "ai-sidebar-shell shrink-0 overflow-hidden border-l bg-white transition-[width,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-[#151515]",
        aiSidebarOpen ? "w-[min(100vw,384px)] border-zinc-200 dark:border-white/10" : "w-0 border-transparent",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") setAiSidebarOpen(false);
      }}
    >
      <aside
        className={clsx(
          "flex h-full w-[min(100vw,384px)] flex-col bg-white text-zinc-950 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-[#151515] dark:text-zinc-100",
          aiSidebarOpen ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0",
        )}
        aria-hidden={!aiSidebarOpen}
      >
        {panelContent}
      </aside>
    </div>
  );
}

function ContextPill({ context, label }: { context: ContextSnapshot; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:shadow-none">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#35B86B]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
      {context.truncated && (
        <p className="mt-1 text-xs text-destructive">{t("aiSidebar.contextTruncated")}</p>
      )}
      {context.savedBodyHint && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("aiSidebar.savedBodyHint")}</p>
      )}
    </div>
  );
}

function HistoryPanel({
  sessions,
  currentId,
  onSelect,
  onDelete,
}: {
  sessions: AiChatSession[];
  currentId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t, language } = useTranslation();
  return (
    <div className="absolute right-0 top-8 w-[302px] rounded-lg border border-zinc-100 bg-white p-3 shadow-[0_10px_30px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-[#202020] dark:shadow-[0_16px_38px_rgba(0,0,0,0.5)]">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-sm text-zinc-400 dark:text-zinc-500">
        <Clock3 size={13} />
        <span>{t("aiSidebar.historyPanelTitle")}</span>
      </div>
      <div className="max-h-[238px] space-y-1 overflow-y-auto custom-scrollbar">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={clsx(
              "flex items-center gap-2 rounded-md text-left text-sm",
              session.id === currentId ? "bg-zinc-100 dark:bg-white/10" : "hover:bg-zinc-50 dark:hover:bg-white/5",
            )}
          >
            <button onClick={() => onSelect(session.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
              <div className="truncate font-medium text-zinc-800 dark:text-zinc-100">{session.title || t("aiSidebar.newChat")}</div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[13px] font-normal text-zinc-500 dark:text-zinc-400">
                <span className="min-w-0 flex-1 truncate">{firstUserQuestion(session) || t("aiSidebar.newChat")}</span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{formatRelativeTime(session.updatedAt, language)}</span>
              </div>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="mr-1 size-7 text-zinc-400 hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
              title={t("aiSidebar.delete")}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ activeView, onAsk, faded }: { activeView: "chat" | "doc"; onAsk: (text: string) => void; faded?: boolean }) {
  const { t } = useTranslation();
  const prompts = [activeView === "doc" ? t("aiSidebar.docQuickOne") : t("aiSidebar.quickOne"), t("aiSidebar.quickTwo")];
  return (
    <div
      className={clsx(
        // 输入框聚焦（移动端上移）时原位置渐隐，避免与上浮的输入框争空间（issue 2）。
        "flex min-h-[180px] flex-1 flex-col justify-end pb-2 transition-opacity duration-200",
        faded && "pointer-events-none opacity-0",
      )}
    >
      <div className="space-y-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onAsk(prompt)}
            className="block w-full cursor-pointer text-left text-sm font-medium leading-6 text-foreground transition-colors hover:text-foreground/70"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function IconButton({ title, disabled, onClick, icon }: { title: string; disabled?: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="size-8 text-zinc-600 dark:text-zinc-400"
    >
      {icon}
    </Button>
  );
}

function MessageBubble({
  message,
  streaming,
  copied,
  onCopy,
  onToDoc,
  onRetry,
}: {
  message: AiSidebarMessage;
  streaming: boolean;
  copied: boolean;
  onCopy: () => void;
  onToDoc: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  return (
    <div className={clsx("group", isUser ? "text-right" : "text-left")}>
      <div className={clsx(
        "max-w-full text-sm leading-6",
        isUser
          ? "inline-block rounded-lg bg-zinc-950 px-3 py-2 text-white dark:bg-zinc-100 dark:text-zinc-950"
          : "ai-sidebar-markdown block break-words px-0 py-0 text-zinc-800 dark:text-zinc-200",
      )}>
        {message.status === "error" ? (
          <div>
            <p className="text-red-700 dark:text-red-400">{message.error || t("aiSidebar.error")}</p>
            <button onClick={onRetry} className="mt-1 text-xs font-medium underline">{t("aiSidebar.retry")}</button>
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={aiMarkdownComponents} urlTransform={imageUrlTransform}>{message.content || (streaming ? "..." : "")}</ReactMarkdown>
        )}
      </div>
      {!isUser && message.retrievalStatus && (
        <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {message.retrievalStatus === "searching" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" />
              {t("aiSidebar.retrievalSearching")}
            </span>
          ) : (message.retrievalCount ?? 0) > 0 ? (
            <span>{t("aiSidebar.retrievalFound", { n: message.retrievalCount ?? 0 })}</span>
          ) : (
            <span>{t("aiSidebar.retrievalNone")}</span>
          )}
          {message.citations && message.citations.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-1">
              {message.citations.map((c) => (
                <li key={`${c.type}:${c.id}`} className="truncate">· {c.title}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!isUser && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {message.status === "aborted" && <span className="mr-1 text-xs text-zinc-400 dark:text-zinc-500">{t("aiSidebar.aborted")}</span>}
          {streaming && <Loader2 size={13} className="animate-spin text-zinc-400 dark:text-zinc-500" />}
          <Button variant="ghost" size="icon" className="size-7 text-zinc-400" onClick={onCopy} title={t("main.copy")}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </Button>
          {message.content.trim() && (
            <Button variant="ghost" size="icon" className="size-7 text-zinc-400" onClick={onToDoc} title={t("aiSidebar.toDoc")}>
              <FileText size={13} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function buildContextSnapshot(params: {
  activeView: "chat" | "doc";
  activeConversationId: string | null;
  activeDocId: string | null;
  conversations: any[];
  documents: any[];
  editMode: string;
}): ContextSnapshot {
  if (params.activeView === "chat") {
    const conv = params.conversations.find((item) => item.id === params.activeConversationId);
    if (!conv) return { label: "", content: "", truncated: false, savedBodyHint: false };
    const truncated = truncateMiddle(serializeConversation(conv), CONTEXT_CHAR_LIMIT);
    return {
      label: conv.title,
      content: truncated.text,
      truncated: truncated.truncated,
      savedBodyHint: false,
    };
  }
  const doc = params.documents.find((item) => item.id === params.activeDocId);
  if (!doc) return { label: "", content: "", truncated: false, savedBodyHint: false };
  const truncated = truncateMiddle(doc.body ?? "", CONTEXT_CHAR_LIMIT);
  return {
    label: doc.title,
    content: truncated.text,
    truncated: truncated.truncated,
    savedBodyHint: params.editMode === "edit",
  };
}

function buildLLMMessages(messages: AiSidebarMessage[], latestQuestion: string, context: string): ChatMessage[] {
  const system = context
    ? `${DEFAULT_PROMPT_AI_SIDEBAR}\n\n# Current context\n\n${context}`
    : DEFAULT_PROMPT_AI_SIDEBAR;
  const history = messages
    .filter((message) => message.status !== "streaming" && message.status !== "error")
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  const withoutLatest = history.slice(0, -1);
  const packed: ChatMessage[] = [{ role: "system", content: system }];
  let budget = MESSAGE_CHAR_LIMIT - system.length - latestQuestion.length;
  const selected: ChatMessage[] = [];
  for (let i = withoutLatest.length - 1; i >= 0; i--) {
    const item = withoutLatest[i];
    if (budget <= 0) break;
    if (item.content.length <= budget) {
      selected.unshift(item);
      budget -= item.content.length;
    }
  }
  packed.push(...selected);
  packed.push({ role: "user", content: latestQuestion });
  return packed;
}

function finishAssistantMessage(
  session: AiChatSession,
  messageId: string,
  content: string,
  status: "done" | "aborted",
): AiChatSession {
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    messages: session.messages.map((message) =>
      message.id === messageId ? { ...message, content, status } : message
    ),
  };
}

function truncateMiddle(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const keep = Math.floor((limit - 40) / 2);
  const removed = text.length - keep * 2;
  return {
    text: `${text.slice(0, keep)}\n\n...（已截断 ${removed} 字）...\n\n${text.slice(-keep)}`,
    truncated: true,
  };
}

function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 40);
  const line = markdown.split("\n").map((part) => part.trim()).find(Boolean) ?? "AI response";
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

function serializeAiThread(session: AiChatSession): string {
  return session.messages
    .filter((message) => message.content.trim())
    .map((message) => `## ${message.role === "user" ? "User" : "Assistant"}\n\n${message.content}`)
    .join("\n\n---\n\n");
}

function retryMessage(session: AiChatSession, assistantId: string, send: (text: string) => void) {
  const index = session.messages.findIndex((message) => message.id === assistantId);
  const previous = index > 0 ? session.messages[index - 1] : null;
  if (previous?.role === "user") send(previous.content);
}

function firstUserQuestion(session: AiChatSession): string {
  return session.messages.find((message) => message.role === "user")?.content.trim().split("\n")[0] ?? "";
}

function formatRelativeTime(value: string, language: "en" | "zh"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) return "now";
  if (absMs < hour) return `${Math.max(1, Math.round(absMs / minute))}m`;
  if (absMs < day) return `${Math.round(absMs / hour)}h`;
  if (absMs < 7 * day) return `${Math.round(absMs / day)}d`;
  return formatDisplayDate(date, language);
}
