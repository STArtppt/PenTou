import React, { useRef, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { MermaidBlock } from "./MermaidBlock";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { ImageGalleryProvider, MarkdownImage, imageUrlTransform } from "./ImageLightbox";
import { formatDisplayDateTime } from "../utils/dateFormat";
import { useScrollActivity } from "../hooks/useScrollActivity";
import {
  conversationMetaFields,
  technicalDetailFields,
} from "../metadata-fields";

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
              {/* 元数据面板：滚动区内、首条消息前；版本预览时不渲染。
                  与消息列表拆开，避免 space-y-12 把面板下间距拉得与文档页不一致。 */}
              {!previewingVersionId ? (
                <MetadataPanel
                  entryId={conversation.id}
                  fields={metaFields}
                  technical={techFields}
                  className="mb-8"
                />
              ) : null}
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

function MessageHeader({
  name,
  timestamp,
  content,
  onExcerpt,
  excerpting,
}: {
  name: string;
  timestamp: string;
  content: string;
  onExcerpt: () => void;
  excerpting: boolean;
}) {
  const { t, language } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 group/header">
      {/* 名称 + 时间戳：移动端分两行（窄屏时间戳不再被挤换行），桌面同一行。 */}
      <div className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
        <span className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-100">{name}</span>
        {timestamp && isValidDate(timestamp) && (
          <span className="whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-500 font-medium">
            {formatDisplayDateTime(timestamp, language)}
          </span>
        )}
      </div>
      <IconTooltip label={t("main.copyMessage")}>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="size-7 text-zinc-400 opacity-100 transition-all md:opacity-0 md:group-hover/header:opacity-100"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </IconTooltip>
      <IconTooltip label={t("main.excerptConversation")}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onExcerpt}
          disabled={excerpting}
          className="size-7 text-zinc-400 opacity-100 transition-all md:opacity-0 md:group-hover/header:opacity-100"
        >
          {excerpting ? <Loader2 size={14} className="animate-spin" /> : <Quote size={14} />}
        </Button>
      </IconTooltip>
    </div>
  );
}

const markdownComponents = {
  h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold mt-8 mb-4 text-zinc-900 dark:text-zinc-50" {...props} />,
  h2: ({ node, ...props }: any) => <h2 className="text-xl font-bold mt-8 mb-4 text-zinc-900 dark:text-zinc-50 border-b border-zinc-200 dark:border-white/10 pb-2" {...props} />,
  h3: ({ node, ...props }: any) => <h3 className="text-lg font-bold mt-6 mb-3 text-zinc-900 dark:text-zinc-50" {...props} />,
  p: ({ node, ...props }: any) => <p className="mb-4 last:mb-0" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="list-disc pl-6 mb-4 space-y-1" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="list-decimal pl-6 mb-4 space-y-1" {...props} />,
  li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
  pre: ({ children, ...props }: any) => (
    <>{React.Children.map(children, (child) => {
      if (React.isValidElement(child)) return React.cloneElement(child, { isBlock: true } as any);
      return child;
    })}</>
  ),
  code: ({ node, className, children, isBlock, ...props }: any) => {
    const language = className?.match(/language-(\S+)/)?.[1];
    if (isBlock && language === "mermaid") {
      return <MermaidBlock source={String(children).replace(/\n$/, "")} className={className} />;
    }
    if (isBlock) return <MarkdownCodeBlock className={className}>{children}</MarkdownCodeBlock>;
    return (
      <code className="bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200" {...props}>
        {children}
      </code>
    );
  },
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 hover:border-foreground/40 bg-zinc-50 dark:bg-white/5 pl-4 py-2 my-4 rounded-r text-zinc-700 dark:text-zinc-300 italic transition-colors" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-blue-600 dark:text-blue-400 hover:text-foreground underline transition-colors" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  img: ({ node, src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto mb-4 border border-zinc-200 dark:border-white/10 rounded-lg">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-white/10" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="bg-zinc-50 dark:bg-white/5" {...props} />,
  tbody: ({ node, ...props }: any) => <tbody className="divide-y divide-zinc-200 dark:divide-white/10 bg-white dark:bg-[#1A1A1A]" {...props} />,
  tr: ({ node, ...props }: any) => <tr className="transition-colors hover:bg-zinc-50 dark:hover:bg-white/5" {...props} />,
  th: ({ node, ...props }: any) => <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider" {...props} />,
  td: ({ node, ...props }: any) => <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300" {...props} />,
};

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
      {/* 角色头：头像 + 名称/时间 + 操作按钮同一行。移动端头像居中对齐两行文本，桌面顶端对齐。 */}
      <div className="flex items-center gap-3 md:items-start md:gap-4">
        <div className="shrink-0 md:pt-1">
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
          content={message.content}
          onExcerpt={onExcerpt}
          excerpting={excerpting}
        />
      </div>
      {/* 正文：移动端与头像左对齐铺满（消除长文左侧空隙）；桌面 pl-12 缩进对齐到名称下方。 */}
      <div className="mt-2 md:mt-1 md:pl-12">
        <div className={clsx(
          "max-w-full text-[15px] leading-7 markdown-body break-words",
          isUser
            ? "bg-zinc-50 dark:bg-white/5 inline-block px-5 py-4 border border-zinc-100 dark:border-white/10 rounded-2xl rounded-tl-sm text-zinc-800 dark:text-zinc-200 shadow-sm"
            : "text-zinc-800 dark:text-zinc-200",
        )}>
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} urlTransform={imageUrlTransform}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
