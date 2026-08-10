import React, { useRef, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User, Copy, Check, Import, Loader2, Quote, History, EyeOff, Globe, Terminal, PenLine, FolderKanban } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/IconTooltip";
import { toast } from "sonner";
import { useAppContext, Message, Platform } from "../data";
import { RightNav } from "./RightNav";
import { VersionPanel } from "./VersionPanel";
import { MetadataPanel } from "./MetadataPanel";
import { useTranslation } from "../i18n";
import { excerptConversationToDoc, generateDocId } from "../doc-utils";
import { copyText } from "../utils/clipboard";
import { locateAndFlash } from "../utils/searchJump";
import { BrandIcon } from "./BrandIcon";
import { topBarSourceLabel } from "./topBarSourceLabel";
import { resolveCaptureMethod } from "./topBarAttribution";
import { ImageGalleryProvider } from "./ImageLightbox";
import { formatDisplayDateTime } from "../utils/dateFormat";
import { useScrollActivity } from "../hooks/useScrollActivity";
import {
  conversationMetaFields,
  technicalDetailFields,
} from "../metadata-fields";
import {
  imageUrlTransform,
  markdownComponents,
  remarkPlugins,
} from "./chatMarkdown";
import { ReasoningPanel } from "./ReasoningPanel";

export function ChatBody() {
  const {
    conversations,
    folders,
    activeConversationId,
    setDrawerOpen,
    isLoading,
    documents,
    addDocuments,
    commitVersion,
    setActiveView,
    setActiveDocId,
    setVersionPanelOpen,
    versionsByConv,
    previewingVersionId,
    setPreviewingVersionId,
    searchJump,
    setSearchJump,
    aiSidebarOpen,
  } = useAppContext();
  const { t, language } = useTranslation();

  const conversation = conversations.find((c) => c.id === activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 搜索跳转：打开对话后用 snippetText 在已渲染消息中定位、滚动并临时高亮（spec hybrid-search US-03）。
  useEffect(() => {
    if (!searchJump || searchJump.type !== "conversation" || searchJump.id !== activeConversationId) return;
    const msgs = conversation?.messages ?? [];
    if (msgs.length === 0) return; // 等待消息 hydrate
    const raf = requestAnimationFrame(() => {
      const candidates = msgs
        .map((m) => {
          const el = document.getElementById(`msg-${m.id}`);
          return el ? { el, text: m.content } : null;
        })
        .filter((c): c is { el: HTMLElement; text: string } => c !== null);
      const ok = locateAndFlash(candidates, searchJump.snippetText);
      if (!ok) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setSearchJump(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [searchJump, activeConversationId, conversation?.messages, setSearchJump]);
  const [excerpting, setExcerpting] = useState(false);
  const [previewMessages, setPreviewMessages] = useState<Message[] | null>(null);
  const { isScrolling: isContentScrolling, markScrollActive: markContentScrollActive } = useScrollActivity();

  // 预览历史版本时拉取该版本的 messages（spec US-03）
  useEffect(() => {
    if (!previewingVersionId || !activeConversationId) {
      setPreviewMessages(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/conversations/${activeConversationId}/versions/${previewingVersionId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setPreviewMessages(data.messages ?? null); })
      .catch(() => { if (!cancelled) setPreviewMessages(null); });
    return () => { cancelled = true; };
  }, [previewingVersionId, activeConversationId]);

  const handleExcerptMessage = async (message: Message) => {
    if (!conversation || excerpting) return;
    const existingDoc = documents.find((d) => d.sourceConversationId === conversation.id);
    setExcerpting(true);
    try {
      const result = await excerptConversationToDoc({
        conversation,
        message,
        existingDoc,
        createDoc: async (body, title) => {
          const docId = generateDocId();
          const now = new Date().toISOString();
          await addDocuments([{
            id: docId,
            title,
            folderId: null,
            createdAt: now,
            updatedAt: now,
            body,
            currentVersionId: "",
            sourceConversationId: conversation.id,
            sourcePlatform: conversation.platform,
            versionType: "conversation-excerpt",
          }]);
          return { id: docId };
        },
        appendToDoc: async (body) => {
          if (!existingDoc) return;
          await commitVersion(existingDoc.id, body, "conversation-excerpt");
        },
      });

      if (result.status === "already-excerpted") {
        toast.info(t("main.excerptAlready"));
        return;
      }

      toast.success(result.status === "created" ? t("main.excerptCreated") : t("main.excerptAppended"));
      setActiveView("doc");
      setActiveDocId(result.docId);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      toast.error(msg.includes("对话无内容可摘录") ? t("main.excerptEmpty") : msg);
    } finally {
      setExcerpting(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPreviewingVersionId(null); // 切换会话时退出版本预览
  }, [activeConversationId, setPreviewingVersionId]);

  // Hooks must run unconditionally (before any early return).
  const metaFields = useMemo(
    () =>
      conversation
        ? conversationMetaFields(conversation, folders, {
            formatDateTime: (iso) => formatDisplayDateTime(iso, language),
          })
        : [],
    [conversation, folders, language],
  );
  const techFields = useMemo(
    () =>
      conversation
        ? technicalDetailFields({
            id: conversation.id,
            currentVersionId: conversation.currentVersionId,
            ingestSource: conversation.ingestSource,
          })
        : [],
    [conversation],
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-[#1A1A1A] text-zinc-400 min-w-0">
        <Loader2 size={48} className="mb-4 opacity-50 animate-spin text-muted-foreground" />
        <h2 className="text-xl font-semibold mb-2 text-zinc-600 dark:text-zinc-300">{t("main.loading")}</h2>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-[#1A1A1A] text-zinc-400 min-w-0">
        <Bot size={48} className="mb-4 opacity-50" />
        <h2 className="text-xl font-semibold mb-2 text-zinc-600 dark:text-zinc-300">{t("main.noConv")}</h2>
        <p className="text-sm mb-6">{t("main.selectConv")}</p>
        <Button
          variant="primary"
          size="lg"
          className="gap-2 font-semibold shadow-sm"
          onClick={() => setDrawerOpen(true)}
        >
          <Import size={18} /> {t("main.importData")}
        </Button>
      </div>
    );
  }

  const displayMessages = previewingVersionId ? (previewMessages ?? conversation.messages) : conversation.messages;
  const previewVersionNum = previewingVersionId
    ? (versionsByConv[conversation.id] ?? []).find((v) => v.id === previewingVersionId)?.version ?? "?"
    : null;

  return (
    <div className="flex-1 flex bg-white dark:bg-[#1A1A1A] relative overflow-hidden min-w-0 min-h-0">
      <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0 min-h-0">
        {/* Top Metadata Bar — 双行布局（spec content-topbar-attribution）：标题 / 时间+徽章。
            移动端隐藏，由 MobileTopBar+FAB 承接（spec mobile-responsive US-03）。 */}
        <header className="shrink-0 min-h-14 border-b border-zinc-200 dark:border-white/10 px-6 hidden md:flex items-center justify-between gap-4 bg-white/80 dark:bg-[#1A1A1A]/80 backdrop-blur-md z-10 sticky top-0">
          <div className="flex min-w-0 flex-col gap-1 py-2">
            <h1 className="max-w-lg truncate text-base font-semibold text-zinc-800 dark:text-zinc-100">
              {conversation.title}
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {conversation.updatedAt && (
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {t("version.updatedAt", { time: formatDisplayDateTime(conversation.updatedAt, language) })}
                </span>
              )}
              {/* 品牌/形态 + 采集方式 + 项目（有 sourceProject 才显示） */}
              <Badge
                variant="secondary"
                size="sm"
                icon={<BrandIcon platform={conversation.platform} size={12} />}
              >
                {topBarSourceLabel(conversation.platform, conversation.ingestSource)}
              </Badge>
              {(() => {
                const method = resolveCaptureMethod(conversation.ingestSource);
                const captureIcon =
                  method === "web" ? <Globe /> : method === "terminal" ? <Terminal /> : <PenLine />;
                const captureLabel =
                  method === "web"
                    ? t("capture.web")
                    : method === "terminal"
                    ? t("capture.terminal")
                    : t("capture.manual");
                return (
                  <Badge variant="secondary" size="sm" icon={captureIcon}>
                    {captureLabel}
                  </Badge>
                );
              })()}
              {conversation.sourceProject ? (
                <Badge variant="secondary" size="sm" icon={<FolderKanban />}>
                  {conversation.sourceProject}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <IconTooltip label={t("toolbar.versionHistory")}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setVersionPanelOpen(true)}
                aria-label={t("toolbar.versionHistory")}
                className="size-8 text-muted-foreground"
              >
                <History size={16} />
              </Button>
            </IconTooltip>
          </div>
        </header>

        {previewingVersionId && (
          <div className="shrink-0 flex items-center gap-2 px-6 py-2 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-200 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300">
            <span className="flex-1">{t("doc.previewBanner", { n: previewVersionNum ?? "..." })}</span>
            <button
              onClick={() => setPreviewingVersionId(null)}
              className="flex items-center gap-1 hover:underline font-medium"
            >
              <EyeOff size={12} /> {t("doc.stopPreview")}
            </button>
          </div>
        )}

        {/* Message List */}
        <div
          ref={scrollRef}
          className={clsx(
            "flex-1 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar subtle-scrollbar pb-32 pt-8",
            isContentScrolling && "subtle-scrollbar-active",
          )}
          onScroll={markContentScrollActive}
        >
          <ImageGalleryProvider>
            <div className="mx-auto max-w-4xl px-6">
              <div className="space-y-12">
                {displayMessages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    platform={conversation.platform}
                    onExcerpt={() => handleExcerptMessage(msg)}
                    excerpting={excerpting}
                  />
                ))}
              </div>
              {/* 元数据面板：滚动区内、末条消息之后；版本预览时不渲染。
                  与消息列表拆开，避免 space-y-12 把面板上间距拉得与文档页不一致。 */}
              {!previewingVersionId ? (
                <MetadataPanel
                  entryId={conversation.id}
                  fields={metaFields}
                  technical={techFields}
                  className="mt-12"
                />
              ) : null}
            </div>
          </ImageGalleryProvider>
        </div>
      </div>

      <div className={clsx("hidden md:block", aiSidebarOpen && "max-[1280px]:hidden")}>
        <RightNav messages={displayMessages} scrollContainer={scrollRef} />
      </div>
      <VersionPanel kind="conversation" />
    </div>
  );
}

function isValidDate(d: any) {
  const date = new Date(d);
  return date instanceof Date && !isNaN(date.getTime());
}

/** 角色头：只承载名称 + 时间戳；操作按钮已下沉到正文底部（见 MessageActions）。 */
function MessageHeader({
  name,
  timestamp,
  align = "left",
}: {
  name: string;
  timestamp: string;
  /** 用户消息右对齐时，名称贴近头像。 */
  align?: "left" | "right";
}) {
  const { language } = useTranslation();
  const isRight = align === "right";

  return (
    // 名称 + 时间戳恒定两行（桌面也是）：与正文/头像同宽对齐的布局下，两行比一行更稳，
    // 窄屏时间戳也不会被挤换行。
    <div className={clsx("flex min-w-0 flex-1 flex-col gap-0.5", isRight && "items-end")}>
      <span className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-100">{name}</span>
      {timestamp && isValidDate(timestamp) && (
        <span className="whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-500 font-medium">
          {formatDisplayDateTime(timestamp, language)}
        </span>
      )}
    </div>
  );
}

/**
 * 正文底部的消息操作条（复制消息 / 摘录对话）。
 * AI 侧左对齐且常驻；用户侧右对齐、桌面悬停整条消息才显形（触屏无 hover，窄屏常驻）。
 */
function MessageActions({
  content,
  onExcerpt,
  excerpting,
  align = "left",
}: {
  content: string;
  onExcerpt: () => void;
  excerpting: boolean;
  align?: "left" | "right";
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const isRight = align === "right";

  const handleCopy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={clsx(
        "mt-1.5 flex items-center gap-1",
        isRight &&
          // group-focus-within：键盘 Tab 进来时也要显形，否则按钮可聚焦却不可见
          "justify-end opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
      )}
    >
      <IconTooltip label={t("main.copyMessage")}>
        <Button variant="ghost" size="icon" onClick={handleCopy} className="size-7 text-zinc-400">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </IconTooltip>
      <IconTooltip label={t("main.excerptConversation")}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onExcerpt}
          disabled={excerpting}
          className="size-7 text-zinc-400"
        >
          {excerpting ? <Loader2 size={14} className="animate-spin" /> : <Quote size={14} />}
        </Button>
      </IconTooltip>
    </div>
  );
}

function MessageBubble({
  message,
  platform,
  onExcerpt,
  excerpting,
}: {
  message: Message;
  platform: Platform;
  onExcerpt: () => void;
  excerpting: boolean;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  return (
    <div id={`msg-${message.id}`} className="transition-all scroll-mt-24 group w-full">
      {/* 角色头：AI 左对齐；用户右对齐（头像在右，名称贴近头像）。头像居中对齐名称/时间两行。 */}
      <div className={clsx("flex items-center gap-3", isUser && "flex-row-reverse")}>
        <div className="shrink-0">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400">
              <User size={18} />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center border border-zinc-200 dark:border-white/10 text-white dark:text-zinc-900 shadow-sm">
              <BrandIcon platform={platform} size={18} />
            </div>
          )}
        </div>
        <MessageHeader
          name={isUser ? t("main.you") : platform}
          timestamp={message.timestamp}
          align={isUser ? "right" : "left"}
        />
      </div>
      {/* 正文：与头像同起于容器边界，不预留头像槽 —— 桌面留槽会让正文左/右边界与拉通全宽的
          元数据面板对不齐。用户侧 text-right 把 inline-block 气泡靠右，气泡内 text-left 保持可读。 */}
      <div className={clsx("mt-2", isUser && "text-right")}>
        {/* reasoning 面板在正文容器之前（spec message-reasoning） */}
        {!isUser ? <ReasoningPanel reasoning={message.reasoning} /> : null}
        <div className={clsx(
          "max-w-full text-[15px] leading-7 markdown-body break-words",
          isUser
            ? "bg-zinc-50 dark:bg-white/5 inline-block px-5 py-4 border border-zinc-100 dark:border-white/10 rounded-2xl rounded-tr-sm text-left text-zinc-800 dark:text-zinc-200 shadow-sm"
            : "text-zinc-800 dark:text-zinc-200",
        )}>
          <ReactMarkdown components={markdownComponents} remarkPlugins={remarkPlugins} urlTransform={imageUrlTransform}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
      <MessageActions
        content={message.content}
        onExcerpt={onExcerpt}
        excerpting={excerpting}
        align={isUser ? "right" : "left"}
      />
    </div>
  );
}
