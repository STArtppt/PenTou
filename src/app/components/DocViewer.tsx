import React, { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, MessageSquare, Highlighter, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useAppContext, Annotation } from "../data";
import { captureAnnotationFromSelection } from "../annotations";
import { generateAnnotationId, extractHeadings, slugify } from "../doc-utils";
import { useTranslation } from "../i18n";
import { copyText } from "../utils/clipboard";

interface Props {
  docId: string;
  body: string;
  annotations: Annotation[];
  annotateMode: boolean;
}

type PopupState =
  | { type: "action"; x: number; y: number; anchor: string; range: { start: number; end: number } }
  | { type: "comment-input"; x: number; y: number; anchor: string; range: { start: number; end: number } }
  | { type: "view"; x: number; y: number; annoId: string; comment?: string };

const HIGHLIGHT_COLOR = "#fde68a";
const COMMENT_COLOR = "#fed7aa";

export function DocViewer({ docId, body, annotations, annotateMode }: Props) {
  const { upsertAnnotation, deleteAnnotation } = useAppContext();
  const { t } = useTranslation();
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const rehypePlugins = useMemo(
    () => [createAnnotationHighlightPlugin(annotations)],
    [annotations],
  );

  const orphanedCount = annotations.filter((a) => a.orphanedAt).length;

  const closePopup = () => {
    setPopup(null);
    setCommentDraft("");
  };

  const handleMouseUp = () => {
    if (!annotateMode || popup?.type === "comment-input") return;
    const sel = captureAnnotationFromSelection(body);
    if (!sel) return;
    const selObj = window.getSelection();
    if (!selObj || selObj.isCollapsed) return;
    const range = selObj.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setPopup({
      type: "action",
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
      anchor: sel.anchor,
      range: sel.range,
    });
  };

  const handleHighlight = () => {
    if (!popup || popup.type !== "action") return;
    const anno: Annotation = {
      id: generateAnnotationId(),
      docId,
      anchor: popup.anchor,
      range: popup.range,
      type: "highlight",
      color: HIGHLIGHT_COLOR,
      createdAt: new Date().toISOString(),
    };
    upsertAnnotation(anno);
    closePopup();
    window.getSelection()?.removeAllRanges();
  };

  const handleStartComment = () => {
    if (!popup || popup.type !== "action") return;
    setPopup({ ...popup, type: "comment-input" });
    setCommentDraft("");
  };

  const handleSaveComment = () => {
    if (!popup || popup.type !== "comment-input" || !commentDraft.trim()) return;
    const anno: Annotation = {
      id: generateAnnotationId(),
      docId,
      anchor: popup.anchor,
      range: popup.range,
      type: "comment",
      comment: commentDraft.trim(),
      color: COMMENT_COLOR,
      createdAt: new Date().toISOString(),
    };
    upsertAnnotation(anno);
    closePopup();
    window.getSelection()?.removeAllRanges();
  };

  const handleMarkClick = (e: React.MouseEvent) => {
    if (!annotateMode) return;
    const mark = (e.target as HTMLElement).closest("mark[data-anno-id]") as HTMLElement | null;
    if (!mark) return;
    const annoId = mark.dataset.annoId!;
    const anno = annotations.find((a) => a.id === annoId);
    if (!anno) return;
    const rect = mark.getBoundingClientRect();
    setPopup({ type: "view", x: rect.left, y: rect.bottom + 8, annoId: anno.id, comment: anno.comment });
  };

  const handleDeleteAnno = (annoId: string) => {
    deleteAnnotation(docId, annoId);
    closePopup();
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!popup) return;
      const popupEl = document.getElementById("annotation-popup");
      if (popupEl && !popupEl.contains(e.target as Node)) {
        if (popup.type !== "comment-input") closePopup();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popup]);

  return (
    <div id="doc-scroll-container" className="relative flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-24 px-4 sm:px-8">
      {orphanedCount > 0 && (
        <div className="mx-auto max-w-4xl pt-6">
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
            {t("anno.orphanBanner", { n: orphanedCount })}
          </div>
        </div>
      )}

      {/* Wrapper to center paper + TOC */}
      <div className="flex justify-center w-full max-w-[1172px] mx-auto mt-6 mb-24 relative">
        {/* Paper Container */}
        <div className="w-full max-w-4xl bg-white dark:bg-[#1A1A1A] shadow-sm ring-1 ring-zinc-200 dark:ring-white/10 rounded-xl min-h-[800px] relative">
          <div
            className="px-8 sm:px-16 py-12 sm:py-16 text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 markdown-body"
            onMouseUp={handleMouseUp}
            onClick={handleMarkClick}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdComponents}>
              {body}
            </ReactMarkdown>
          </div>
        </div>

        {/* Document TOC - right side fixed */}
        <div className="hidden xl:block w-[240px] shrink-0 ml-[36px] pointer-events-none z-10">
          <div className="sticky top-6 pointer-events-auto">
            <DocumentTOC body={body} />
          </div>
        </div>
      </div>

      {popup && (
        <div
          id="annotation-popup"
          className="fixed z-50"
          style={{ top: Math.min(popup.y, window.innerHeight - 160), left: Math.max(8, Math.min(popup.x - 80, window.innerWidth - 176)) }}
        >
          {popup.type === "action" && (
            <div className="flex items-center gap-1 bg-zinc-900 dark:bg-[#2A2A2A] rounded-lg shadow-xl p-1 border border-white/10">
              <button
                onClick={handleHighlight}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-yellow-300 hover:bg-white/10 rounded-md transition-colors"
              >
                <Highlighter size={12} /> {t("anno.addHighlight")}
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button
                onClick={handleStartComment}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-white/10 rounded-md transition-colors"
              >
                <MessageSquare size={12} /> {t("anno.addComment")}
              </button>
              <button onClick={closePopup} className="p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors">
                <X size={12} />
              </button>
            </div>
          )}

          {popup.type === "comment-input" && (
            <div className="w-56 bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 rounded-lg shadow-xl p-3">
              <textarea
                autoFocus
                className="w-full text-xs bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-md p-2 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none resize-none focus:ring-1 focus:ring-orange-500 dark:focus:ring-yellow-400"
                rows={3}
                placeholder={t("anno.commentPlaceholder")}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveComment(); } }}
              />
              <div className="flex justify-end gap-1.5 mt-2">
                <button onClick={closePopup} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
                  {t("anno.cancel")}
                </button>
                <button
                  onClick={handleSaveComment}
                  disabled={!commentDraft.trim()}
                  className="px-2.5 py-1 text-xs font-medium bg-orange-500 dark:bg-yellow-400 text-white dark:text-zinc-900 rounded-md disabled:opacity-50 transition-colors hover:bg-orange-600 dark:hover:bg-yellow-500"
                >
                  {t("anno.save")}
                </button>
              </div>
            </div>
          )}

          {popup.type === "view" && (
            <div className="w-56 bg-white dark:bg-[#1A1A1A] border border-zinc-200 dark:border-white/10 rounded-lg shadow-xl p-3">
              {popup.comment ? (
                <p className="text-xs text-zinc-700 dark:text-zinc-300 mb-2 leading-relaxed">{popup.comment}</p>
              ) : (
                <p className="text-xs text-zinc-400 italic mb-2">(highlight)</p>
              )}
              <button
                onClick={() => handleDeleteAnno(popup.annoId)}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 size={11} /> {t("anno.delete")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type MarkdownTreeNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, any>;
  children?: MarkdownTreeNode[];
};

function createAnnotationHighlightPlugin(annotations: Annotation[]) {
  const activeAnnotations = annotations.filter((anno) => !anno.orphanedAt && anno.anchor);

  return () => (tree: MarkdownTreeNode) => {
    if (activeAnnotations.length === 0) return;

    const appliedAnnoIds = new Set<string>();

    const visit = (node: MarkdownTreeNode) => {
      if (!Array.isArray(node.children)) return;
      if (node.type === "element" && ["code", "pre", "script", "style"].includes(node.tagName ?? "")) return;

      const nextChildren: MarkdownTreeNode[] = [];

      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          nextChildren.push(...splitTextNodeByAnnotations(child.value, activeAnnotations, appliedAnnoIds));
          continue;
        }

        visit(child);
        nextChildren.push(child);
      }

      node.children = nextChildren;
    };

    visit(tree);
  };
}

function splitTextNodeByAnnotations(
  value: string,
  annotations: Annotation[],
  appliedAnnoIds: Set<string>,
): MarkdownTreeNode[] {
  let nodes: MarkdownTreeNode[] = [{ type: "text", value }];

  for (const anno of annotations) {
    if (appliedAnnoIds.has(anno.id)) continue;

    const nextNodes: MarkdownTreeNode[] = [];
    let applied = false;

    for (const node of nodes) {
      if (applied || node.type !== "text" || typeof node.value !== "string") {
        nextNodes.push(node);
        continue;
      }

      const idx = node.value.indexOf(anno.anchor);
      if (idx === -1) {
        nextNodes.push(node);
        continue;
      }

      const before = node.value.slice(0, idx);
      const after = node.value.slice(idx + anno.anchor.length);
      if (before) nextNodes.push({ type: "text", value: before });
      nextNodes.push({
        type: "element",
        tagName: "mark",
        properties: {
          "data-anno-id": anno.id,
          className: `annotation-highlight annotation-${anno.type}`,
          style: {
            backgroundColor: anno.color,
            borderRadius: "2px",
            padding: "0 1px",
          },
          ...(anno.comment ? { title: anno.comment } : {}),
        },
        children: [{ type: "text", value: anno.anchor }],
      });
      if (after) nextNodes.push({ type: "text", value: after });
      applied = true;
      appliedAnnoIds.add(anno.id);
    }

    nodes = nextNodes;
  }

  return nodes;
}

function DocCodeBlock({ children, className }: any) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const language = className ? className.replace(/language-/, "") : "snippet";

  const handleCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group mt-4 mb-6">
      <div className="absolute flex items-center justify-between top-0 left-0 right-0 px-4 py-2 bg-zinc-200/50 dark:bg-[#2A2A2A] rounded-t-lg border-b border-zinc-200 dark:border-white/10">
        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 dark:text-zinc-400">{language}</span>
        <button
          type="button"
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

const mdComponents = {
  h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold mt-8 mb-4 text-zinc-900 dark:text-zinc-50" {...props} />,
  h2: ({ node, ...props }: any) => <h2 className="text-xl font-bold mt-8 mb-4 text-zinc-900 dark:text-zinc-50 border-b border-zinc-200 dark:border-white/10 pb-2" {...props} />,
  h3: ({ node, ...props }: any) => <h3 className="text-lg font-bold mt-6 mb-3 text-zinc-900 dark:text-zinc-50" {...props} />,
  p: ({ node, ...props }: any) => <p className="mb-4 last:mb-0" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="list-disc pl-6 mb-4 space-y-1" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="list-decimal pl-6 mb-4 space-y-1" {...props} />,
  li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-white/5 pl-4 py-2 my-4 rounded-r italic text-zinc-600 dark:text-zinc-400" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-blue-600 dark:text-blue-400 hover:text-orange-500 dark:hover:text-yellow-400 underline transition-colors" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  code: ({ node, className, children, isBlock, ...props }: any) => {
    if (isBlock) return <DocCodeBlock className={className} {...props}>{children}</DocCodeBlock>;
    return <code className="bg-zinc-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200" {...props}>{children}</code>;
  },
  pre: ({ children }: any) => (
    <>{React.Children.map(children, (child) => {
      if (React.isValidElement(child)) return React.cloneElement(child, { isBlock: true } as any);
      return child;
    })}</>
  ),
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto mb-4 border border-zinc-200 dark:border-white/10 rounded-lg">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-white/10" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="bg-zinc-50 dark:bg-white/5" {...props} />,
  tbody: ({ node, ...props }: any) => <tbody className="divide-y divide-zinc-200 dark:divide-white/10 bg-white dark:bg-[#1A1A1A]" {...props} />,
  th: ({ node, ...props }: any) => <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider" {...props} />,
  td: ({ node, ...props }: any) => <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300" {...props} />,
};

function DocumentTOC({ body }: { body: string }) {
  const { t } = useTranslation();
  const headings = useMemo(() => extractHeadings(body), [body]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    const container = document.getElementById("doc-scroll-container");
    if (!container) return;

    const handleScroll = () => {
      const els = document.querySelectorAll("h1, h2, h3");
      let foundSlug = null;
      for (let i = 0; i < els.length; i++) {
        const el = els[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        // 150px threshold from viewport top
        if (rect.top < 150) {
          const text = el.innerText;
          if (text) foundSlug = slugify(text);
        } else {
          break;
        }
      }
      if (foundSlug) setActiveSlug(foundSlug);
      else if (els.length > 0) {
        const text = (els[0] as HTMLElement).innerText;
        if (text) setActiveSlug(slugify(text));
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    // setTimeout to allow rendering
    setTimeout(handleScroll, 100);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [body]);

  if (headings.length === 0) return null;

  const scrollToHeading = (slug: string) => {
    const els = document.querySelectorAll("h1, h2, h3");
    for (const el of els) {
      const text = (el as HTMLElement).innerText;
      if (text && slugify(text) === slug) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  };

  return (
    <div className="w-[240px] shrink-0 relative py-2 text-sm select-none">
      <div className="font-bold text-zinc-800 dark:text-zinc-200 mb-3 pl-4">
        {t("doc.toc", { defaultValue: "目录" })}
      </div>
      <div className="max-h-[calc(100vh-200px)] overflow-y-auto rightnav-scrollbar relative">
        {/* 2px Divider Line */}
        <div className="absolute left-0 top-[10px] bottom-[10px] w-[2px] bg-zinc-200 dark:bg-white/10 rounded-full" />
        
        <div className="flex flex-col gap-[2px] relative z-10">
          {headings.map((h, i) => {
            const isActive = activeSlug === h.slug;
            return (
              <button
                key={i}
                onClick={() => scrollToHeading(h.slug)}
                className={clsx(
                  "relative text-left w-full pr-3 py-1.5 text-xs transition-colors hover:text-orange-500 dark:hover:text-yellow-400 truncate group",
                  isActive ? "text-orange-500 dark:text-yellow-400 font-medium" : "text-zinc-500 dark:text-zinc-400",
                  h.level === 1 && "text-[13px] mt-1 pl-4",
                  h.level === 2 && "pl-7",
                  h.level === 3 && "pl-10 text-[11px]",
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[16px] bg-orange-500 dark:bg-yellow-400 rounded-full" />
                )}
                {h.text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
