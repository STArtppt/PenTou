import React, { useState, useEffect, useMemo, useRef, useCallback, useContext, createContext } from "react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { remarkPlugins } from "@/shared/markdown-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { MessageSquare, Highlighter, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { useAppContext, Annotation } from "../data";
import { captureAnnotationFromSelection } from "../annotations";
import { generateAnnotationId, extractHeadings, slugify } from "../doc-utils";
import { useTranslation } from "../i18n";
import { locateAndFlash } from "../utils/searchJump";
import { MermaidBlock } from "./MermaidBlock";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { ImageGalleryProvider, MarkdownImage } from "./ImageLightbox";
import { useScrollActivity } from "../hooks/useScrollActivity";
import { isImeComposing } from "../ime";
import { docUrlTransform } from "../markdown-url";
import { parseInAppLink, isInAppHref } from "../in-app-links";

interface Props {
  docId: string;
  body: string;
  annotations: Annotation[];
  annotateMode: boolean;
  /** 预览历史版本时正文不是当前正文，复选框 MUST 不可点 —— 勾了会把旧版本写回去。 */
  bodyReadOnly?: boolean;
  /**
   * 纸面内、`.markdown-body` 之后的页脚槽（元数据面板等）。
   * 必须在标注根之外，避免选中面板文本触发标注浮层。
   */
  footerSlot?: React.ReactNode;
}

type PopupState =
  | { type: "action"; x: number; y: number; anchor: string; range: { start: number; end: number } }
  | { type: "comment-input"; x: number; y: number; anchor: string; range: { start: number; end: number } }
  | { type: "view"; x: number; y: number; annoId: string; comment?: string };

const HIGHLIGHT_COLOR = "#fde68a";
const COMMENT_COLOR = "#fed7aa";

export function DocViewer({
  docId,
  body,
  annotations,
  annotateMode,
  bodyReadOnly = false,
  footerSlot,
}: Props) {
  const {
    upsertAnnotation,
    deleteAnnotation,
    searchJump,
    setSearchJump,
    toggleDocumentTask,
    openInAppLink,
  } = useAppContext();
  const { t } = useTranslation();

  // 搜索跳转：打开文档后用 snippetText 在正文块中定位、滚动并临时高亮（spec hybrid-search US-03）。
  useEffect(() => {
    if (!searchJump || searchJump.type !== "document" || searchJump.id !== docId) return;
    if (!body) return;
    const raf = requestAnimationFrame(() => {
      const root = document.querySelector(".markdown-body");
      const els = root
        ? (Array.from(root.querySelectorAll("p,li,h1,h2,h3,h4,blockquote,td,pre")) as HTMLElement[])
        : [];
      const candidates = els.map((el) => ({ el, text: el.textContent ?? "" }));
      const ok = locateAndFlash(candidates, searchJump.snippetText);
      if (!ok) document.getElementById("doc-scroll-container")?.scrollTo({ top: 0, behavior: "smooth" });
      setSearchJump(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [searchJump, docId, body, setSearchJump]);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const { isScrolling: isContentScrolling, markScrollActive: markContentScrollActive } = useScrollActivity();
  // rehype-raw 解析文档内嵌 HTML（如 minerU 转换含合并单元格的 PDF 表格时输出的 <table>），
  // rehype-sanitize 过滤危险节点；标注插件必须排在 sanitize 之后，其生成的 mark 才不被剥离。
  const rehypePlugins = useMemo(
    () => [rehypeRaw, [rehypeSanitize, htmlSanitizeSchema] as any, createAnnotationHighlightPlugin(annotations)],
    [annotations],
  );

  const orphanedCount = annotations.filter((a) => a.orphanedAt).length;

  // 勾选是**浏览动作**：立即写回正文并保存，但不建版本、不要求进编辑模式
  const handleToggleTask = useCallback(
    (line: number) => {
      if (bodyReadOnly) return;
      toggleDocumentTask(docId, line);
    },
    [bodyReadOnly, docId, toggleDocumentTask],
  );

  const handleInAppLink = useCallback(
    (href: string) => {
      // 目标非法或已不存在时明确提示，MUST NOT 静默无反应；正文一个字都不改（design D4）
      if (!openInAppLink(parseInAppLink(href))) toast.error(t("doc.inAppLinkMissing"));
    },
    [openInAppLink, t],
  );

  const components = useMemo(
    () =>
      makeMdComponents({
        annotateMode: annotateMode || bodyReadOnly,
        onToggleTask: handleToggleTask,
        onInAppLink: handleInAppLink,
      }),
    [annotateMode, bodyReadOnly, handleToggleTask, handleInAppLink],
  );

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
    <div
      id="doc-scroll-container"
      className={clsx(
        "relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar subtle-scrollbar pb-24 px-4 sm:px-8",
        isContentScrolling && "subtle-scrollbar-active",
      )}
      onScroll={markContentScrollActive}
    >
      {orphanedCount > 0 && (
        <div className="mx-auto max-w-4xl pt-6">
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {t("anno.orphanBanner", { n: orphanedCount })}
          </div>
        </div>
      )}

      {/* Wrapper to center paper + reserve TOC space */}
      <div className="flex justify-center w-full max-w-[1166px] mx-auto mt-6 mb-24 relative">
        {/* Paper Container */}
        <div className="w-full min-w-0 max-w-4xl bg-white dark:bg-[#1A1A1A] shadow-sm ring-1 ring-zinc-200 dark:ring-white/10 rounded-xl min-h-[800px] relative">
          <div
            className={clsx(
              "px-8 text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 sm:px-16 markdown-body",
              // 有元数据面板时收紧底部留白，间距交给面板自身的上外边距；无面板时保持原文纸面边距
              footerSlot ? "pt-12 pb-0 sm:pt-16" : "py-12 sm:py-16",
            )}
            onMouseUp={handleMouseUp}
            onClick={handleMarkClick}
          >
            <ImageGalleryProvider>
              <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={docUrlTransform}>
                {body}
              </ReactMarkdown>
            </ImageGalleryProvider>
          </div>
          {footerSlot}
        </div>

        <div className="hidden xl:block w-[240px] shrink-0 ml-[30px] sticky top-6 self-start">
          <DocumentTOC body={body} />
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 rounded-md transition-colors"
              >
                <Highlighter size={12} /> {t("anno.addHighlight")}
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button
                onClick={handleStartComment}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 rounded-md transition-colors"
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
                className="w-full text-xs bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-md p-2 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none resize-none focus:ring-1 focus:ring-ring"
                rows={3}
                placeholder={t("anno.commentPlaceholder")}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveComment(); } }}
              />
              <div className="flex justify-end gap-1.5 mt-2">
                <Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs text-muted-foreground" onClick={closePopup}>
                  {t("anno.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="h-auto px-2.5 py-1 text-xs"
                  onClick={handleSaveComment}
                  disabled={!commentDraft.trim()}
                >
                  {t("anno.save")}
                </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteAnno(popup.annoId)}
                className="h-auto gap-1.5 px-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={11} /> {t("anno.delete")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 在默认白名单上放行三处：
 *
 * 1. 合并单元格属性（minerU 表格降级为 HTML 的主要原因就是 colspan/rowspan）；
 * 2. `input` 的 `checked` —— 默认 schema 只允许 `disabled=true` 与 `type=checkbox`，
 *    并在 `required` 里把 `disabled` **强制**设回 true。不解开这两条，任务复选框既读不到
 *    勾选状态、也永远是禁用的（spec interactive-task-checkbox）；
 * 3. `href` 的 `pentou:` 协议 —— sanitize 与 react-markdown 的 `urlTransform` 是**两道**独立的
 *    净化，只放行一边链接照样会被清空（design D4 标注的最易漏点）。
 */
const htmlSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan"],
    th: [...(defaultSchema.attributes?.th ?? []), "colSpan", "rowSpan"],
    // type 仍锁死为 checkbox：放行的是勾选态，不是任意表单控件
    input: [["type", "checkbox"], "checked", "disabled"],
  },
  required: {
    ...defaultSchema.required,
    input: { type: "checkbox" },
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "pentou"],
  },
};

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

/**
 * 任务项所在的**原始 Markdown 行号**。
 *
 * remark-gfm 生成的 `<input type="checkbox">` 节点**没有 position**（它是 to-hast 阶段凭空插进
 * 列表项里的），因此行号只能从 `li` 拿。也刻意不用「页面上第 N 个 checkbox」去数 ——
 * 嵌套列表下渲染顺序与原文顺序并不总是一致（design D9）。
 */
const TaskLineContext = createContext<number | null>(null);

/** 可点选的任务复选框（spec interactive-task-checkbox）。 */
function TaskCheckbox({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: (line: number) => void;
}) {
  const line = useContext(TaskLineContext);
  return (
    <input
      type="checkbox"
      className="mr-1.5 align-middle accent-primary disabled:opacity-60"
      checked={checked}
      disabled={disabled || line === null}
      readOnly={disabled}
      // 冒泡到容器上的 handleMouseUp / handleMarkClick 会触发空选区与批注逻辑（design D10）
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        if (line !== null) onToggle(line);
      }}
    />
  );
}

interface MdComponentOptions {
  annotateMode: boolean;
  onToggleTask: (line: number) => void;
  onInAppLink: (href: string) => void;
}

/**
 * 组件表由**工厂**产出而不是模块级常量：可点链接与可勾选框都要拿到回调
 * （design D4 第 2 点）。调用侧用 `useMemo` + `useCallback` 保持引用稳定，
 * 避免长文档每次渲染重建整棵树。
 */
function makeMdComponents({ annotateMode, onToggleTask, onInAppLink }: MdComponentOptions) {
  return {
    ...mdComponents,
    li: ({ node, ...props }: any) => {
      const line = node?.position?.start?.line;
      const el = <li className="pl-1" {...props} />;
      return typeof line === "number" ? (
        <TaskLineContext.Provider value={line}>{el}</TaskLineContext.Provider>
      ) : (
        el
      );
    },
    input: ({ node, type, checked, disabled, ...props }: any) => {
      if (type !== "checkbox") return <input type={type} disabled={disabled} {...props} />;
      // 批注模式下用户的意图是划词而不是勾选，两种模式抢同一次鼠标事件必然出怪（design D10）
      return <TaskCheckbox checked={!!checked} disabled={annotateMode} onToggle={onToggleTask} />;
    },
    a: ({ node, href, ...props }: any) => {
      if (isInAppHref(href)) {
        return (
          <a
            className="text-blue-600 dark:text-blue-400 hover:text-foreground underline transition-colors cursor-pointer"
            href={href}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInAppLink(href);
            }}
            {...props}
          />
        );
      }
      // 其余链接行为完全不变
      return (
        <a
          className="text-blue-600 dark:text-blue-400 hover:text-foreground underline transition-colors"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        />
      );
    },
  };
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
    <a className="text-blue-600 dark:text-blue-400 hover:text-foreground underline transition-colors" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  img: ({ node, src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
  code: ({ node, className, children, isBlock, ...props }: any) => {
    const language = className?.match(/language-(\S+)/)?.[1];
    if (isBlock && language === "mermaid") {
      return <MermaidBlock source={String(children).replace(/\n$/, "")} className={className} />;
    }
    if (isBlock) return <MarkdownCodeBlock className={className}>{children}</MarkdownCodeBlock>;
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
  const { isScrolling: isTocScrolling, markScrollActive: markTocScrollActive } = useScrollActivity();
  const tocScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tocScrollTimer.current = null;
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

  useEffect(() => {
    return () => {
      if (tocScrollTimer.current) clearTimeout(tocScrollTimer.current);
    };
  }, []);

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
      <div className="absolute left-0 top-[42px] bottom-[18px] w-[2px] bg-zinc-200 dark:bg-white/10 rounded-full" />
      <div
        className={clsx(
          "max-h-[calc(100vh-150px)] overflow-y-auto rightnav-scrollbar relative pr-1",
          isTocScrolling && "toc-scrollbar-active",
        )}
        onScroll={markTocScrollActive}
      >
        <div className="flex flex-col gap-[2px] relative z-10">
          {headings.map((h, i) => {
            const isActive = activeSlug === h.slug;
            return (
              <button
                key={i}
                onClick={() => scrollToHeading(h.slug)}
                className={clsx(
                  "relative text-left w-full pr-3 py-1.5 text-xs transition-colors hover:text-foreground truncate group",
                  isActive ? "text-foreground font-medium" : "text-zinc-500 dark:text-zinc-400",
                  h.level === 1 && "text-[13px] mt-1 pl-4",
                  h.level === 2 && "pl-7",
                  h.level === 3 && "pl-10 text-xs",
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[16px] bg-primary rounded-full" />
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
