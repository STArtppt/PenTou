import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import ReactMarkdown from "react-markdown";
import { Check, ChevronLeft, ChevronRight, Clock3, CornerDownLeft, Copy, FileText, History, Loader2, PanelLeft, PanelRight, Play, Plus, Settings, Sparkles, Square, Trash2, X } from "lucide-react";
import { remarkPlugins } from "@/shared/markdown-gfm";
import clsx from "clsx";
import { toast } from "sonner";
import { useAppContext } from "../data";
import { useIsMobile } from "../hooks/useIsMobile";
import { useVisualViewport } from "../hooks/useVisualViewport";
import {
  readShortcutTipDismissed,
  writeShortcutTipDismissed,
} from "../ai-sidebar-prefs";
import { AskAiFab } from "./AskAiToggleButton";
import {
  AiChatSession,
  AiSidebarMessage,
  createEmptyAiChatSession,
  deriveAiChatTitle,
  generateAiMessageId,
} from "../ai-chats";
import { DEFAULT_PROMPT_AI_SIDEBAR, LLMError, chatCompletion, serializeConversation, ChatMessage } from "../llm";
import { fetchRetrievalHits, formatContextBlock } from "../skills/ask-ai-context";
import { buildContextHeader, sectionOf, wantsCurrentViewBody, type ViewContext } from "../ai-context";
import { runWithTools, type SkillDeps } from "../skill-runtime";
import { createToolExecutor } from "../skills/tool-executor";
import { AGENT_TOOLS, toolsForLLM } from "@/shared/agent-tools";
import { chipsForView, type IntentChip } from "../ai-chips";
import { isImeComposing } from "../ime";
import { generateDocId } from "../doc-utils";
import { copyText } from "../utils/clipboard";
import { useTranslation } from "../i18n";
import { formatDisplayDate, formatDisplayDateTime } from "../utils/dateFormat";
import { parsePlanRun } from "../skills/plan-doc";
import { preflightPlanDoc } from "../skills/run-plan";
import { PlanRunBanner } from "./PlanRunBanner";
import { ImageGalleryProvider, MarkdownImage, imageUrlTransform } from "./ImageLightbox";
import { RunTrace } from "./RunTrace";
import { stripTraceFence, RUN_TRACE_LANG } from "../run-trace";

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
  // 与 ChatBody 同构：pre 只把 isBlock 传给 code，由 code 决定渲染（含 RunTrace）
  pre: ({ children }: any) => (
    <>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) return React.cloneElement(child, { isBlock: true } as any);
        return child;
      })}
    </>
  ),
  code: ({ node, className, children, isBlock, ...props }: any) => {
    const language = typeof className === "string" ? className.match(/language-(\S+)/)?.[1] : undefined;
    if (isBlock && language === RUN_TRACE_LANG) {
      return <RunTrace source={String(children).replace(/\n$/, "")} />;
    }
    if (isBlock) {
      return (
        <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-6 text-foreground shadow-sm custom-scrollbar">
          <code className={clsx(className, "font-mono")} {...props}>{children}</code>
        </pre>
      );
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

const MESSAGE_CHAR_LIMIT = 18000;

/** 侧栏只向模型声明 read_current_view —— 少而精，模型更稳（design D8）。 */
const SIDEBAR_TOOLS = toolsForLLM(AGENT_TOOLS.filter((tool) => tool.name === "read_current_view"));

export function AiSidebar() {
  const {
    aiSidebarOpen,
    setAiSidebarOpen,
    aiSidebarSide,
    setAiSidebarSide,
    aiSessions,
    currentAiSession,
    setCurrentAiSession,
    saveAiSession,
    createNewAiSession,
    selectAiSession,
    deleteAiSession,
    refreshAiSessions,
    startSkillRun,
    abortSkillRun,
    runStatusOf,
    runRegistryVersion,
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
    activeProjectId,
    annotationsByDoc,
    setRewriteDialogOpen,
    rewriteDialogOpen,
    refreshDocuments,
  } = useAppContext();
  const { t, language } = useTranslation();
  const isMobile = useIsMobile();
  // 全屏面板贴合软键盘：键盘弹出时容器收缩到键盘之上，标题栏顶端不动（仅移动端 + 打开时生效）。
  const viewport = useVisualViewport(isMobile && aiSidebarOpen);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [shortcutTipDismissed, setShortcutTipDismissed] = useState(() => readShortcutTipDismissed());
  const wasRewriteOpenRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKeyRef = useRef<string | null>(null);
  const selectingHistoryRef = useRef(false);
  // 仅用于完成 toast 时判断用户是否仍在该会话（startSkillRun 跨 await 后读）
  const currentSessionIdRef = useRef(currentAiSession.id);
  currentSessionIdRef.current = currentAiSession.id;

  const hasLLM = !!(llmConfig.endpoint && llmConfig.apiKey && llmConfig.model);
  // 当前视图的完整快照留在内存里；进提示词的只有轻量头，正文经工具按需取（spec ask-ai-context）
  const view = useMemo(
    () => buildViewContext({ activeView, activeConversationId, activeDocId, conversations, documents, editMode }),
    [activeView, activeConversationId, activeDocId, conversations, documents, editMode],
  );
  const [contextEnabled, setContextEnabled] = useState(true);
  const carriesContext = contextEnabled && !!view;
  // chip 完全由本地状态算出：展示与视图切换零 LLM 调用（spec ai-intent-chips）
  // 执行态在 data.tsx registry，不再用 runningChip 钉死 UI
  const [armedChip, setArmedChip] = useState<IntentChip | null>(null);
  const currentRunStatus = runStatusOf(currentAiSession.id);
  void runRegistryVersion; // 订阅 registry 重渲染
  const chips = useMemo(
    () =>
      chipsForView({
        activeView,
        hasConversation: !!activeConversationId,
        hasDocument: !!activeDocId,
        hasCommentAnnotations: (annotationsByDoc[activeDocId ?? ""] ?? []).some((a: { comment?: string }) => a.comment),
        hasLLM,
      }),
    [activeView, activeConversationId, activeDocId, annotationsByDoc, hasLLM],
  );

  // 计划文档的执行状态（spec plan-run-status）：状态与操作同处上下文条幅下方那一条。
  // 执行入口只在这里 —— chip 组里没有、也不该有「执行计划」（design D6 修订）。
  const activeDoc = documents.find((doc) => doc.id === activeDocId);
  const planRun = useMemo(() => parsePlanRun(activeDoc?.aiPlanRun), [activeDoc?.aiPlanRun]);
  const showPlanBanner = activeView === "doc" && !!activeDoc?.aiPlan;

  const isCurrentEmpty = currentAiSession.messages.length === 0;
  const canOpenHistory = aiSessions.length > 0;
  const contextKey = `${activeView}:${activeView === "chat" ? activeConversationId ?? "" : activeDocId ?? ""}`;
  // 标签如实反映本轮**实际携带**的上下文对象：关掉开关就不是「上下文：某文档」了
  const contextDisplayLabel = carriesContext
    ? `${t("aiSidebar.contextPrefix")}: ${view!.title}`
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

  const clearArmed = () => setArmedChip(null);

  const handleStop = () => {
    // 问答流式
    abortRef.current?.abort();
    // 当前会话若是进行中的执行，一并终止
    if (runStatusOf(currentAiSession.id) === "running") {
      void abortSkillRun(currentAiSession.id);
    }
    clearArmed();
  };

  // 批注重写对话框关闭后清除选中（本轮确认流结束）
  useEffect(() => {
    if (wasRewriteOpenRef.current && !rewriteDialogOpen && armedChip?.confirmation === "rewrite-dialog") {
      clearArmed();
    }
    wasRewriteOpenRef.current = rewriteDialogOpen;
  }, [rewriteDialogOpen, armedChip]);

  const handleSend = async (text = input) => {
    // 流式中 / 执行中：回车/发送 = 停止
    if (streamingId || currentRunStatus === "running") {
      handleStop();
      return;
    }

    // 选中 chip：回车派发意图（与发送同义）
    if (armedChip) {
      const question = text.trim();
      if (armedChip.requiresInput && !question) {
        toast.info(t("aiSidebar.chipNeedsTopic"));
        return;
      }
      setInput("");
      if (armedChip.confirmation === "rewrite-dialog") {
        setRewriteDialogOpen(true);
        return;
      }
      // 无参 chip 忽略输入文本，按意图派发
      await dispatchSkill(armedChip, armedChip.requiresInput ? question : undefined);
      return;
    }

    const question = text.trim();
    if (!question) return;
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
      // eager 只给轻量头（约 200 字符）；正文经 read_current_view 按需取。
      // 但「总结/翻译/重写本文」这类明确指向当前视图的措辞在这里直接预取正文，
      // 不赌弱模型会调工具（design 风险项缓解）。
      const header = carriesContext ? buildContextHeader(view) : "";
      const eagerBody = carriesContext && wantsCurrentViewBody(question)
        ? `\n\n# 当前视图正文\n\n${view!.text}`
        : "";
      const augmentedContext = [
        header,
        eagerBody,
        retrievalBlock ? `\n\n# 检索到的相关片段\n\n${retrievalBlock}` : "",
      ].join("").trim();
      const messages = buildLLMMessages(answeredBase.messages, question, augmentedContext);
      const deps: SkillDeps = {
        apiBase: "",
        fetchImpl: fetch.bind(window),
        callLLM: chatCompletion,
        llmConfig,
        signal: controller.signal,
        executeTool: createToolExecutor({ view: makeViewResolver(view) }),
      };
      await runWithTools(deps, messages, {
        // 没有当前视图时不声明工具 —— 声明一个必然失败的工具只会诱导模型去撞墙
        tools: view ? SIDEBAR_TOOLS : [],
        onChunk: (chunk) => {
          partial += chunk;
          setCurrentAiSession((session) => ({
            ...session,
            updatedAt: new Date().toISOString(),
            messages: session.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: partial } : message
            ),
          }));
        },
      });
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

  /**
   * 点击 chip 进入选中态（spec ai-intent-chips）：清空输入、换引导语；回车才派发。
   * 流式问答中全禁用；技能执行在 registry 后台跑，不独占 chip。
   */
  const handleChip = (chip: IntentChip) => {
    if (chip.disabled || streamingId) return;
    if (armedChip?.id === chip.id) {
      clearArmed();
      return;
    }
    setArmedChip(chip);
    setInput("");
    inputRef.current?.focus();
  };

  const notifyRunFinished = (session: AiChatSession, successToastKey: string, placeholders?: Record<string, string | number>) => {
    const stillViewing = currentSessionIdRef.current === session.id;
    if (stillViewing) {
      toast.success(t(successToastKey as any, placeholders));
      return;
    }
    toast.success(t("aiSidebar.runDoneToast", { title: session.title || t("aiSidebar.runKindBadge") }), {
      action: {
        label: t("aiSidebar.runView"),
        onClick: () => {
          void selectAiSession(session.id);
        },
      },
    });
  };

  /**
   * 执行当前这份计划。经 registry 起会话，全程零 LLM。
   * 由状态条上的「执行」按钮直接调用 —— 不经 chip 的选中态，**计划文档本身就是批准形态**
   * （spec agent-write-policy 批准协议 / plan-run-status D6），再要求点一下回车是多余的一跳。
   *
   * 先预检：校验失败只更新状态条为「执行失败」+ toast，**不建** AI 会话，
   * 下方不出现「执行意图」气泡与错误消息（原因在状态条「详情」）。
   */
  const executeCurrentPlan = async () => {
    if (!activeDocId) return;
    const deps: SkillDeps = {
      apiBase: "",
      fetchImpl: fetch.bind(globalThis),
      callLLM: async () => {
        throw new Error("run-plan must not call LLM");
      },
      llmConfig,
    };
    const preflight = await preflightPlanDoc(deps, activeDocId);
    if (!preflight.ok) {
      await refreshDocuments();
      toast.error(preflight.error);
      return;
    }
    if (preflight.noop) {
      // 零勾选：无事可做，不建会话、不写终态
      toast.info(t("planRun.noopNoneChecked"));
      return;
    }

    const seed = {
      title: `${t("planRun.runSessionTitle")} · ${documents.find((d) => d.id === activeDocId)?.title ?? activeDocId}`,
      userContent: t("planRun.runSessionIntent"),
      skillId: "run-plan",
      model: llmConfig.model,
      contextType: "doc" as const,
      contextId: activeDocId,
    };
    const { session, output } = await startSkillRun(
      "run-plan",
      { planDocId: activeDocId },
      seed,
    );
    await refreshDocuments();
    const assistant = session.messages.find((m) => m.role === "assistant");
    if (assistant?.status === "error") {
      toast.error(assistant.error || t("aiSidebar.error"));
      return;
    }
    if (assistant?.status === "aborted") return;
    const result = output as { approved?: number; skipped?: number; cleaned?: number } | undefined;
    // 有清理条目时点明「归入待清理、一篇都没删」—— 否则「已执行」很容易被读成「已删除」
    notifyRunFinished(
      session,
      result?.cleaned ? "aiSidebar.chipPlanDoneCleaned" : "aiSidebar.chipPlanDone",
      {
        done: result?.approved ?? 0,
        skipped: result?.skipped ?? 0,
        cleaned: result?.cleaned ?? 0,
      },
    );
  };

  const dispatchSkill = async (chip: IntentChip, arg?: string) => {
    clearArmed();
    // 产出物正文的语言跟随界面语言（技能是纯逻辑，拿不到 i18n hook，只能由派发方带上）
    const skillInput: Record<string, unknown> =
      chip.id === "conversation-to-doc"
        ? { conversationId: activeConversationId! }
        : chip.id === "topic-digest"
          ? { topic: arg!, lang: language, ...(activeProjectId ? { projectId: activeProjectId } : {}) }
          : chip.id === "doc-folder-organize"
            ? { lang: language, ...(activeProjectId ? { projectId: activeProjectId } : {}) }
            : { ...(activeProjectId ? { projectId: activeProjectId } : {}) };

    const titleParts = [t(chip.labelKey)];
    if (arg) titleParts.push(arg);
    else if (chip.id === "conversation-to-doc") {
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv?.title) titleParts.push(conv.title);
    }
    const seed = {
      title: titleParts.join(" · "),
      userContent: arg
        ? `${t(chip.a11yLabelKey)}\n\n${arg}`
        : t(chip.a11yLabelKey),
      skillId: chip.id,
      model: llmConfig.model,
      contextType: activeView as "chat" | "doc",
      contextId: activeView === "chat" ? activeConversationId ?? undefined : activeDocId ?? undefined,
    };

    const { session, output } = await startSkillRun(chip.id, skillInput, seed);
    await refreshDocuments();

    const assistant = session.messages.find((m) => m.role === "assistant");
    if (assistant?.status === "error") {
      toast.error(assistant.error || t("aiSidebar.error"));
      return;
    }
    if (assistant?.status === "aborted") return;

    const out = output as { docId?: string; planDocId?: string } | undefined;
    const docId = out?.docId ?? out?.planDocId;
    // 产出文档时跳转（与改前行为一致）；用户是否仍在该会话只影响 toast，不影响跳转
    if (docId) {
      setActiveView("doc");
      setActiveDocId(docId);
    }

    const successKey =
      chip.confirmation === "plan-doc"
        ? "aiSidebar.chipPlanReady"
        : chip.id === "topic-digest"
          ? "aiSidebar.chipDigestReady"
          : "aiSidebar.chipDocReady";
    notifyRunFinished(session, successKey);
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
    // D2：剥离轨迹围栏，避免漏进用户正式文档
    const body = stripTraceFence(message.content);
    await createDocumentFromAi(body, titleFromMarkdown(body), currentAiSession.id);
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
                runStatusOf={runStatusOf}
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
                onAbort={(id) => void abortSkillRun(id)}
              />
            )}
          </div>
          {/* 桌面：切换停靠边（design D6，硬要求） */}
          {!isMobile && (
            <IconButton
              title={t(aiSidebarSide === "right" ? "aiSidebar.dockLeft" : "aiSidebar.dockRight")}
              onClick={() => setAiSidebarSide(aiSidebarSide === "right" ? "left" : "right")}
              icon={aiSidebarSide === "right" ? <PanelLeft size={16} /> : <PanelRight size={16} />}
            />
          )}
          <IconButton
            title={t("aiSidebar.collapse")}
            onClick={() => setAiSidebarOpen(false)}
            icon={isMobile ? <X size={18} /> : aiSidebarSide === "left" ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
          />
        </div>
      </header>

      {/* 固定区：快捷键提示 → 上下文栏 → 未配置模型提醒（design D11） */}
      <div className="shrink-0 px-4">
        {!isMobile && !shortcutTipDismissed && (
          <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="min-w-0 flex-1">
              {t("aiSidebar.shortcutTip")}{" "}
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/10 dark:text-zinc-200">⌘</kbd>{" "}
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/10 dark:text-zinc-200">I</kbd>
            </span>
            <IconButton
              title={t("aiSidebar.shortcutTipDismiss")}
              onClick={() => {
                writeShortcutTipDismissed(true);
                setShortcutTipDismissed(true);
              }}
              icon={<X size={14} />}
            />
          </div>
        )}
        <ContextPill
          label={contextDisplayLabel}
          enabled={contextEnabled}
          available={!!view}
          savedBodyHint={carriesContext && !!view?.hasUnsavedEdit}
          onToggle={() => setContextEnabled((on) => !on)}
          className={showPlanBanner ? "mb-2" : "mb-4"}
        />
        {showPlanBanner && (
          <PlanRunBanner
            run={planRun}
            ranAtLabel={planRun ? formatDisplayDateTime(planRun.ranAt, language) || planRun.ranAt : ""}
            canViewTrace={!!planRun?.sessionId && aiSessions.some((s) => s.id === planRun.sessionId)}
            running={currentRunStatus === "running"}
            onRun={() => void executeCurrentPlan()}
            onViewTrace={() => {
              if (planRun?.sessionId) void selectAiSession(planRun.sessionId);
            }}
          />
        )}
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
                  streaming={message.id === streamingId || message.status === "streaming"}
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
        <div className="rounded-md border border-zinc-200 bg-white p-3 transition-colors focus-within:border-zinc-400 dark:border-white/10 dark:bg-[#1A1A1A] dark:focus-within:border-white/30">
          <textarea
            ref={inputRef}
            value={input}
            maxLength={1000}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              // 输入法组合期的 Enter 是「上屏候选词」，不是「发送」——放行给 IME。
              if (isImeComposing(e)) return;
              if (e.key === "Escape") {
                // Esc：运行中不清选中；空闲有选中 → 取消选中
                if (!streamingId && currentRunStatus !== "running" && armedChip) {
                  e.preventDefault();
                  clearArmed();
                }
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={isMobile ? 2 : 3}
            placeholder={armedChip ? t(armedChip.armedPromptKey) : t("aiSidebar.placeholder")}
            className="w-full resize-none bg-transparent text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          {/* chip 组 + 模型名 + 发送：同一底行，chip 横向滚动不换行（design D10） */}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ChipBar
                chips={chips}
                armedId={armedChip?.id ?? null}
                streaming={!!streamingId}
                onPick={handleChip}
              />
            </div>
            <span className="max-w-[7rem] shrink-0 truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {llmConfig.model || t("settings.llm.model")}
            </span>
            <IconTooltip label={streamingId || currentRunStatus === "running" ? t("aiSidebar.stop") : t("aiSidebar.send")}>
              <Button
                variant="primary"
                size="icon"
                onClick={streamingId || currentRunStatus === "running" ? handleStop : () => handleSend()}
                disabled={
                  streamingId || currentRunStatus === "running"
                    ? false
                    : !(armedChip
                        ? armedChip.requiresInput
                          ? !!input.trim()
                          : true
                        : !!input.trim())
                }
                className="size-8 transition-[opacity,transform] hover:scale-[1.02] active:scale-95 disabled:opacity-30"
              >
                {streamingId || currentRunStatus === "running" ? <Square size={14} fill="currentColor" /> : <CornerDownLeft size={16} />}
              </Button>
            </IconTooltip>
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
        {!aiSidebarOpen && <AskAiFab side="right" className="md:hidden" />}
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

  const dockLeft = aiSidebarSide === "left";
  return (
    <>
      {/* 桌面收起：左下 / 右下 FAB（随停靠边），展开后隐藏 */}
      {!aiSidebarOpen && <AskAiFab side={aiSidebarSide} className="hidden md:flex" />}
      <div
        className={clsx(
          "ai-sidebar-shell shrink-0 overflow-hidden bg-white transition-[width,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-[#151515]",
          dockLeft ? "border-r" : "border-l",
          aiSidebarOpen ? "w-[min(100vw,384px)] border-zinc-200 dark:border-white/10" : "w-0 border-transparent",
        )}
        // React 18：inert 经 spread 透传 DOM（design D9）
        {...(!aiSidebarOpen ? ({ inert: "" } as React.HTMLAttributes<HTMLDivElement>) : {})}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || isImeComposing(e as unknown as React.KeyboardEvent)) return;
          // 运行中不清选中/不收起；空闲有选中 → 取消；无选中 → 收起
          if (streamingId || currentRunStatus === "running") return;
          if (armedChip) {
            e.preventDefault();
            clearArmed();
            return;
          }
          setAiSidebarOpen(false);
        }}
      >
        <aside
          className={clsx(
            "flex h-full w-[min(100vw,384px)] flex-col bg-white text-zinc-950 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-[#151515] dark:text-zinc-100",
            aiSidebarOpen
              ? "translate-x-0 opacity-100"
              : dockLeft
                ? "-translate-x-3 opacity-0"
                : "translate-x-3 opacity-0",
          )}
          aria-hidden={!aiSidebarOpen}
        >
          {panelContent}
        </aside>
      </div>
    </>
  );
}

/**
 * 上下文控件（spec ask-ai-context）：由被动显示升级为可开关。
 * 知情权保留（标签如实反映本轮携带什么），控制权新增（用户可以关掉）。
 * 关掉后模型仍可经 read_current_view 按需取用 —— 关的是 eager 注入，不是能力。
 */
function ContextPill({
  label,
  enabled,
  available,
  savedBodyHint,
  onToggle,
  className,
}: {
  label: string;
  enabled: boolean;
  available: boolean;
  savedBodyHint: boolean;
  onToggle: () => void;
  /** 下方紧跟计划状态条时收窄间距，让两条读成一组 */
  className?: string;
}) {
  const { t } = useTranslation();
  const on = enabled && available;
  return (
    <div className={className ?? "mb-4"}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!available}
        onClick={onToggle}
        title={t(on ? "aiSidebar.contextOn" : "aiSidebar.contextOff")}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-600 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:bg-zinc-50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:shadow-none dark:hover:bg-white/10 dark:disabled:hover:bg-white/5"
      >
        <span
          className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", on ? "bg-[#35B86B]" : "bg-zinc-300 dark:bg-zinc-600")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {available && (
          <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
            {t(on ? "aiSidebar.contextOn" : "aiSidebar.contextOff")}
          </span>
        )}
      </button>
      {savedBodyHint && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("aiSidebar.savedBodyHint")}</p>
      )}
    </div>
  );
}

/**
 * 意图 chip 区（spec ai-intent-chips）：让用户发现 AI 能做什么。
 * 前置条件不满足时呈现为不可用并说明原因，而不是点了才失败。
 */
function ChipBar({
  chips,
  armedId,
  streaming,
  onPick,
}: {
  chips: IntentChip[];
  armedId: string | null;
  streaming: boolean;
  onPick: (chip: IntentChip) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-nowrap gap-1.5">
      {chips.map((chip) => {
        // 仅问答流式时锁 chip；技能执行在后台，可并行起多次
        const locked = streaming;
        const a11y = t(chip.a11yLabelKey);
        return (
          <button
            key={chip.id}
            type="button"
            disabled={chip.disabled || locked}
            onClick={() => onPick(chip)}
            title={chip.disabledReasonKey ? t(chip.disabledReasonKey) : a11y}
            aria-label={a11y}
            aria-pressed={armedId === chip.id}
            className={clsx(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-45",
              armedId === chip.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10",
            )}
          >
            <Sparkles size={11} />
            {t(chip.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/** 从会话消息推导展示用运行状态（registry 优先，落盘 status 兜底）。 */
export function sessionRunDisplayStatus(
  session: AiChatSession,
  live: string | null | undefined,
): "running" | "done" | "error" | "aborted" | null {
  if (session.kind !== "run") return null;
  if (live === "running" || live === "done" || live === "error" || live === "aborted") return live;
  const assistant = [...session.messages].reverse().find((m) => m.role === "assistant");
  if (!assistant) return null;
  if (assistant.status === "streaming") return "running";
  if (assistant.status === "error") return "error";
  if (assistant.status === "aborted") return "aborted";
  if (assistant.status === "done") return "done";
  return null;
}

function HistoryPanel({
  sessions,
  currentId,
  runStatusOf,
  onSelect,
  onDelete,
  onAbort,
}: {
  sessions: AiChatSession[];
  currentId: string;
  runStatusOf: (id: string) => string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAbort: (id: string) => void;
}) {
  const { t, language } = useTranslation();
  return (
    <div className="absolute right-0 top-8 w-[302px] rounded-lg border border-zinc-100 bg-white p-3 shadow-[0_10px_30px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-[#202020] dark:shadow-[0_16px_38px_rgba(0,0,0,0.5)]">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-sm text-zinc-400 dark:text-zinc-500">
        <Clock3 size={13} />
        <span>{t("aiSidebar.historyPanelTitle")}</span>
      </div>
      <div className="max-h-[238px] space-y-1 overflow-y-auto custom-scrollbar">
        {sessions.map((session) => {
          const runStatus = sessionRunDisplayStatus(session, runStatusOf(session.id));
          return (
            <div
              key={session.id}
              data-testid={`history-item-${session.id}`}
              className={clsx(
                "flex items-center gap-1 rounded-md text-left text-sm",
                session.id === currentId ? "bg-zinc-100 dark:bg-white/10" : "hover:bg-zinc-50 dark:hover:bg-white/5",
              )}
            >
              <button onClick={() => onSelect(session.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
                <div className="flex items-center gap-1.5">
                  {session.kind === "run" && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-violet-100 px-1 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                      title={t("aiSidebar.runKindBadge")}
                    >
                      <Play size={9} />
                      {t("aiSidebar.runKindBadge")}
                    </span>
                  )}
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                    {session.title || t("aiSidebar.newChat")}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  <span className="min-w-0 flex-1 truncate">
                    {runStatus === "running" && (
                      <span className="mr-1 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <Loader2 size={11} className="animate-spin" />
                        {t("aiSidebar.runStatusRunning")}
                      </span>
                    )}
                    {runStatus === "error" && (
                      <span className="mr-1 text-red-600 dark:text-red-400">{t("aiSidebar.runStatusError")}</span>
                    )}
                    {runStatus === "aborted" && (
                      <span className="mr-1 text-zinc-400">{t("aiSidebar.runStatusAborted")}</span>
                    )}
                    {runStatus === "done" && (
                      <span className="mr-1 text-emerald-600 dark:text-emerald-400">{t("aiSidebar.runStatusDone")}</span>
                    )}
                    {!runStatus && (firstUserQuestion(session) || t("aiSidebar.newChat"))}
                  </span>
                  <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{formatRelativeTime(session.updatedAt, language)}</span>
                </div>
              </button>
              {runStatus === "running" && (
                <IconTooltip label={t("aiSidebar.abortRun")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-zinc-400 hover:bg-amber-500/10 hover:text-amber-600"
                    aria-label={t("aiSidebar.abortRun")}
                    data-testid={`abort-run-${session.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbort(session.id);
                    }}
                  >
                    <Square size={12} fill="currentColor" />
                  </Button>
                </IconTooltip>
              )}
              <IconTooltip label={t("aiSidebar.delete")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-1 size-7 text-zinc-400 hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </IconTooltip>
            </div>
          );
        })}
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
    <IconTooltip label={title}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onClick}
        className="size-8 text-zinc-600 dark:text-zinc-400"
      >
        {icon}
      </Button>
    </IconTooltip>
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
          // 用户气泡反色（亮：深底白字 / 暗：浅底深字）。App 根上 selection:bg-foreground/* 会生成
          // `.selection\\:… ::selection` 后代选择器，与气泡规则同优先级且 CSS 源序更靠后 → 盖掉
          // 普通 selection: 覆盖。必须用 ! 提高优先级，才能在反色底上框选可读。
          ? "inline-block rounded-lg bg-zinc-950 px-3 py-2 text-white selection:!bg-white/40 selection:!text-white dark:bg-zinc-100 dark:text-zinc-950 dark:selection:!bg-zinc-950/30 dark:selection:!text-zinc-950"
          : "ai-sidebar-markdown block break-words px-0 py-0 text-zinc-800 dark:text-zinc-200",
      )}>
        {message.status === "error" ? (
          <div>
            <p className="text-red-700 dark:text-red-400">{message.error || t("aiSidebar.error")}</p>
            {/*
              执行类消息（runSkillId，含 run-plan）不给重试：
              - run-plan：计划已失败/中断后重试无意义（快照脏或校验必再撞墙），入口在状态条详情
              - 其它技能：retry 只是把上一条用户文案当问答再 send，并不会重跑 startSkillRun
            */}
            {!message.runSkillId ? (
              <button onClick={onRetry} className="mt-1 text-xs font-medium underline">{t("aiSidebar.retry")}</button>
            ) : null}
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={remarkPlugins} components={aiMarkdownComponents} urlTransform={imageUrlTransform}>{message.content || (streaming ? "..." : "")}</ReactMarkdown>
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
          {message.status === "aborted" && (
            <span className="mr-1 text-xs text-zinc-400 dark:text-zinc-500">{t("aiSidebar.runStatusAborted")}</span>
          )}
          {message.status === "error" && (
            <span className="mr-1 text-xs text-red-600 dark:text-red-400">{t("aiSidebar.runStatusError")}</span>
          )}
          {message.status === "done" && message.runSkillId && (
            <span className="mr-1 text-xs text-emerald-600 dark:text-emerald-400">{t("aiSidebar.runStatusDone")}</span>
          )}
          {streaming && <Loader2 size={13} className="animate-spin text-zinc-400 dark:text-zinc-500" />}
          <IconTooltip label={t("main.copy")}>
            <Button variant="ghost" size="icon" className="size-7 text-zinc-400" onClick={onCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </Button>
          </IconTooltip>
          {message.content.trim() && (
            <IconTooltip label={t("aiSidebar.toDoc")}>
              <Button variant="ghost" size="icon" className="size-7 text-zinc-400" onClick={onToDoc}>
                <FileText size={13} />
              </Button>
            </IconTooltip>
          )}
        </div>
      )}
    </div>
  );
}

function buildViewContext(params: {
  activeView: "chat" | "doc";
  activeConversationId: string | null;
  activeDocId: string | null;
  conversations: any[];
  documents: any[];
  editMode: string;
}): ViewContext | null {
  if (params.activeView === "chat") {
    const conv = params.conversations.find((item) => item.id === params.activeConversationId);
    if (!conv) return null;
    return { kind: "chat", title: conv.title, text: serializeConversation(conv), hasUnsavedEdit: false };
  }
  const doc = params.documents.find((item) => item.id === params.activeDocId);
  if (!doc) return null;
  // 编辑模式下取的是**已保存**正文（与既有语义一致），因此明确告知模型有未保存的编辑
  return { kind: "doc", title: doc.title, text: doc.body ?? "", hasUnsavedEdit: params.editMode === "edit" };
}

/**
 * `read_current_view` 的执行体。按节取用返回该节**完整**文本，不做中段截断 ——
 * 绕开中段腰斩正是把正文改成按需取用的顺带收益。
 */
function makeViewResolver(view: ViewContext | null) {
  return {
    read: async (section?: string) => {
      if (!view) return null;
      if (!section) return { kind: view.kind, title: view.title, text: view.text };
      const found = sectionOf(view.text, section);
      if (found === null) throw new Error(`《${view.title}》里没有名为「${section}」的一节`);
      return { kind: view.kind, title: `${view.title} · ${section}`, text: found };
    },
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

function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 40);
  const line = markdown.split("\n").map((part) => part.trim()).find(Boolean) ?? "AI response";
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

/** 整线程转文档：剥离轨迹围栏（D2）。导出供单测钉住。 */
export function serializeAiThread(session: AiChatSession): string {
  return session.messages
    .filter((message) => message.content.trim())
    .map((message) => {
      const body = stripTraceFence(message.content);
      return `## ${message.role === "user" ? "User" : "Assistant"}\n\n${body}`;
    })
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
