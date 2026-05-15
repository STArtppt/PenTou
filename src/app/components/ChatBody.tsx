import React, { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { Bot, User, Terminal, Copy, Check, Import, Loader2, FileText, Quote } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { useAppContext, Message, Platform } from "../data";
import { RightNav } from "./RightNav";
import { useTranslation } from "../i18n";
import { convertConversationToDocument, LLMError } from "../llm";
import { excerptConversationToDoc, generateDocId, mergeRewriteWithExistingBody } from "../doc-utils";

export function ChatBody() {
  const {
    conversations,
    activeConversationId,
    setDrawerOpen,
    isLoading,
    llmConfig,
    documents,
    addDocuments,
    updateDocument,
    commitVersion,
    setActiveView,
    setActiveDocId,
    setSettingsOpen,
  } = useAppContext();
  const { t } = useTranslation();

  const conversation = conversations.find((c) => c.id === activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [converting, setConverting] = useState(false);
  const [excerpting, setExcerpting] = useState(false);

  const handleConvertToDoc = async () => {
    if (!conversation) return;
    const hasLLM = !!(llmConfig.apiKey && llmConfig.endpoint && llmConfig.model);
    if (!hasLLM) {
      setSettingsOpen(true);
      return;
    }
    setConverting(true);
    try {
      const markdown = await convertConversationToDocument(conversation, llmConfig);
      const now = new Date().toISOString();
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : conversation.title;
      const existingDoc = documents.find((d) => d.sourceConversationId === conversation.id);

      if (existingDoc) {
        const nextBody = mergeRewriteWithExistingBody(existingDoc.body, markdown);
        await commitVersion(existingDoc.id, nextBody, "llm-rewrite");
        await updateDocument(existingDoc.id, {
          title,
          sourcePlatform: conversation.platform,
          generatedBy: llmConfig.model,
          generatedAt: now,
        });
        setActiveView("doc");
        setActiveDocId(existingDoc.id);
        return;
      }

      const docId = generateDocId();
      await addDocuments([{
        id: docId,
        title,
        folderId: null,
        createdAt: now,
        updatedAt: now,
        body: markdown,
        currentVersionId: "",
        sourceConversationId: conversation.id,
        sourcePlatform: conversation.platform,
        generatedBy: llmConfig.model,
        generatedAt: now,
      }]);

      setActiveView("doc");
      setActiveDocId(docId);
    } catch (e: any) {
      const msg = e instanceof LLMError
        ? `LLM Error ${e.context.status}: ${e.message} (model: ${e.context.model})`
        : String(e);
      console.error({ module: "ChatBody", op: "convertToDoc", err: msg });
      alert(msg);
    } finally {
      setConverting(false);
    }
  };

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
  }, [activeConversationId]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-[#1A1A1A] text-zinc-400 min-w-0">
        <Loader2 size={48} className="mb-4 opacity-50 animate-spin text-orange-500 dark:text-yellow-400" />
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
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-orange-600 dark:hover:bg-yellow-400 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
        >
          <Import size={18} /> {t("main.importData")}
        </button>
      </div>
    );
  }

  const turnCount = Math.floor(conversation.messages.length / 2);

  return (
    <div className="flex-1 flex bg-white dark:bg-[#1A1A1A] relative overflow-hidden min-w-0 min-h-0">
      <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0 min-h-0">
        {/* Top Metadata Bar */}
        <header className="shrink-0 h-14 border-b border-zinc-200 dark:border-white/10 px-6 flex items-center justify-between bg-white/80 dark:bg-[#1A1A1A]/80 backdrop-blur-md z-10 sticky top-0">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 truncate max-w-lg">
              {conversation.title}
            </h1>
            <div className="flex items-center gap-2 text-xs font-medium shrink-0">
              <span className="px-2 py-1 rounded-md bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 flex items-center gap-1.5">
                <PlatformIcon platform={conversation.platform} />
                {conversation.platform}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
            <button
              onClick={handleConvertToDoc}
              disabled={converting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-orange-500 dark:hover:text-yellow-400 transition-colors"
            >
              {converting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {t("toolbar.convertToDoc", { defaultValue: "转为文档" })}
            </button>
          </div>
        </header>

        {/* Message List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-32 pt-8">
          <div className="max-w-4xl mx-auto px-6 space-y-12">
            {conversation.messages.map((msg) => (
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
      </div>

      <RightNav messages={conversation.messages} scrollContainer={scrollRef} />
    </div>
  );
}

function isValidDate(d: any) {
  const date = new Date(d);
  return date instanceof Date && !isNaN(date.getTime());
}

function CodeBlock({ children, className }: any) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const language = className ? className.replace(/language-/, "") : "snippet";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="relative group mt-4 mb-6">
      <div className="absolute flex items-center justify-between top-0 left-0 right-0 px-4 py-2 bg-zinc-200/50 dark:bg-[#2A2A2A] rounded-t-lg border-b border-zinc-200 dark:border-white/10">
        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 dark:text-zinc-400">{language}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-500 hover:text-orange-500 dark:text-zinc-400 dark:hover:text-yellow-400 transition-colors flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t("main.copied") : t("main.copy")}
        </button>
      </div>
      <pre className="bg-zinc-50 dark:bg-[#111] border border-zinc-200 dark:border-white/10 rounded-lg p-4 pt-12 overflow-x-auto text-sm font-mono text-zinc-800 dark:text-zinc-300 shadow-sm custom-scrollbar">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
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
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="flex items-center gap-3 mb-1 group/header">
      <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{name}</span>
      {timestamp && isValidDate(timestamp) && (
        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
          {format(new Date(timestamp), "h:mm a")}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/header:opacity-100 p-1 rounded-md text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
        title={t("main.copyMessage")}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        onClick={onExcerpt}
        disabled={excerpting}
        className="opacity-0 group-hover/header:opacity-100 p-1 rounded-md text-zinc-400 hover:text-orange-500 dark:hover:text-yellow-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all"
        title={t("main.excerptConversation")}
      >
        {excerpting ? <Loader2 size={14} className="animate-spin" /> : <Quote size={14} />}
      </button>
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
    if (isBlock) return <CodeBlock className={className} {...props}>{children}</CodeBlock>;
    return (
      <code className="bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200" {...props}>
        {children}
      </code>
    );
  },
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 hover:border-orange-500 dark:hover:border-yellow-400 bg-zinc-50 dark:bg-white/5 pl-4 py-2 my-4 rounded-r text-zinc-700 dark:text-zinc-300 italic transition-colors" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-blue-600 dark:text-blue-400 hover:text-orange-500 dark:hover:text-yellow-400 underline transition-colors" target="_blank" rel="noopener noreferrer" {...props} />
  ),
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
    <div id={`msg-${message.id}`} className="flex gap-4 transition-all scroll-mt-24 group w-full">
      <div className="shrink-0 pt-1">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400">
            <User size={18} />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center border border-zinc-200 dark:border-white/10 text-white dark:text-zinc-900 shadow-sm">
            <Bot size={18} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <MessageHeader
          name={isUser ? t("main.you") : platform}
          timestamp={message.timestamp}
          content={message.content}
          onExcerpt={onExcerpt}
          excerpting={excerpting}
        />
        <div className={clsx(
          "max-w-none text-[15px] leading-7 mt-1 markdown-body break-words",
          isUser
            ? "bg-zinc-50 dark:bg-white/5 inline-block px-5 py-4 border border-zinc-100 dark:border-white/10 rounded-2xl rounded-tl-sm text-zinc-800 dark:text-zinc-200 shadow-sm"
            : "text-zinc-800 dark:text-zinc-200",
        )}>
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "CLI") return <Terminal size={12} />;
  return <Bot size={12} />;
}
