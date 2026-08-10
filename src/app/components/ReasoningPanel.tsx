/**
 * 消息级推理过程折叠面板（spec message-reasoning）。
 * 组合 registry collapsible 原语；默认收起；无边框卡片壳。
 * 标题固定为「搜索链、思考链等文本」——凡采集到的非正文都进此块。
 * 展开区有最大高度，底部「查看全部 / 收起」控制内容截断（与外层折叠无关）。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { MessageReasoning } from "../data";
import { useTranslation } from "../i18n";
import {
  imageUrlTransform,
  markdownComponents,
  remarkPlugins,
} from "./chatMarkdown";

export type ReasoningPanelProps = {
  reasoning?: MessageReasoning | null;
  className?: string;
};

/** 展开区默认最大高度（px）；超出后出现「查看全部」。 */
const BODY_MAX_HEIGHT_PX = 240;

/** 参考资料链接：浅灰固定长度胶囊，溢出省略（非蓝色下划线）。 */
function RefPillLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const label = typeof children === "string" ? children : String(children ?? "");
  const className = cn(
    "inline-flex max-w-[10rem] shrink-0 items-center truncate rounded-full",
    "bg-muted px-2.5 py-1 text-xs text-muted-foreground no-underline",
    "transition-colors hover:bg-muted/80 hover:text-foreground",
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={label}
      >
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={label}>
      {children}
    </span>
  );
}

/** 搜索段 Markdown：链接 → 胶囊；段落里的链接行 → flex wrap。 */
const searchMarkdownComponents = {
  ...markdownComponents,
  a: ({ href, children }: any) => <RefPillLink href={href}>{children}</RefPillLink>,
  p: ({ children }: any) => (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 last:mb-0">{children}</div>
  ),
  ul: ({ children }: any) => (
    <ul className="mb-2 list-disc space-y-0.5 pl-5 text-muted-foreground last:mb-0">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 last:mb-0">{children}</div>
  ),
  li: ({ children }: any) => <li className="text-sm leading-6">{children}</li>,
  strong: ({ children }: any) => (
    <strong className="text-xs font-medium text-muted-foreground">{children}</strong>
  ),
};

/** 思考段：弱化正文样式，与答案区区分。 */
const thinkingMarkdownComponents = {
  ...markdownComponents,
  a: ({ href, children, ...props }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children }: any) => (
    <p className="mb-2 text-sm leading-6 text-muted-foreground last:mb-0">{children}</p>
  ),
  li: ({ children }: any) => (
    <li className="pl-1 text-sm leading-6 text-muted-foreground">{children}</li>
  ),
};

/** 标题 + 箭头紧跟其后（不右对齐）。 */
function TriggerLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
      <span className="truncate text-sm font-normal text-muted-foreground">{children}</span>
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-data-panel-open:rotate-90 motion-reduce:transition-none"
        aria-hidden
      />
    </span>
  );
}

function Section({
  title,
  body,
  variant,
}: {
  title: string;
  body: string;
  variant: "search" | "thinking";
}) {
  const components =
    variant === "search" ? searchMarkdownComponents : thinkingMarkdownComponents;
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="text-sm leading-6 text-muted-foreground markdown-body break-words">
        <ReactMarkdown
          components={components}
          remarkPlugins={remarkPlugins}
          urlTransform={imageUrlTransform}
        >
          {body}
        </ReactMarkdown>
      </div>
    </section>
  );
}

/**
 * 展开区内容：默认截到最大高度，溢出时底部「查看全部 / 收起」。
 * 此 useState 只管内容截断，外层折叠仍由 Collapsible 原语负责。
 */
function ClampedBody({
  children,
  measureKey,
}: {
  children: ReactNode;
  /** 内容变化时重新测量 */
  measureKey: string;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      // scrollHeight 在 max-height 截断下仍是完整高度
      setOverflows(el.scrollHeight > BODY_MAX_HEIGHT_PX + 4);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measureKey, expanded]);

  // 内容变短后若不再溢出，复位 expanded
  useLayoutEffect(() => {
    if (!overflows && expanded) setExpanded(false);
  }, [overflows, expanded]);

  return (
    <div data-slot="reasoning-clamped-body">
      <div
        ref={bodyRef}
        data-slot="reasoning-body"
        data-expanded={expanded ? "true" : "false"}
        className={cn(
          "space-y-3",
          !expanded && overflows && "overflow-hidden",
        )}
        style={
          !expanded && overflows
            ? { maxHeight: BODY_MAX_HEIGHT_PX }
            : undefined
        }
      >
        {children}
      </div>
      {overflows ? (
        <button
          type="button"
          data-slot="reasoning-expand-toggle"
          className={cn(
            "mt-1.5 text-xs font-medium text-muted-foreground",
            "hover:text-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "rounded-sm",
          )}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("reasoning.collapse") : t("reasoning.expandAll")}
        </button>
      ) : null}
    </div>
  );
}

export function ReasoningPanel({ reasoning, className }: ReasoningPanelProps) {
  const { t } = useTranslation();
  const search = reasoning?.search?.trim() || "";
  const thinking = reasoning?.thinking?.trim() || "";
  if (!search && !thinking) return null;

  const measureKey = `${search.length}:${thinking.length}:${search.slice(0, 32)}:${thinking.slice(0, 32)}`;

  return (
    <div
      data-slot="reasoning-panel"
      className={cn("mb-2 text-muted-foreground", className)}
    >
      {/* 不传 defaultOpen：缺省收起。Trigger 覆盖为 ghost；标题固定「…等文本」。 */}
      <Collapsible>
        <CollapsibleTrigger
          className={cn(
            "inline-flex w-auto max-w-full justify-start gap-0 rounded-none px-0 py-0.5 font-normal",
            "text-muted-foreground hover:bg-transparent hover:text-foreground",
            "focus-visible:ring-offset-0",
          )}
        >
          <TriggerLabel>{t("reasoning.title")}</TriggerLabel>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <CollapsibleContent className="space-y-0 px-0 pb-1 pt-2 text-muted-foreground">
            <ClampedBody measureKey={measureKey}>
              {search ? (
                <Section title={t("reasoning.search")} body={search} variant="search" />
              ) : null}
              {thinking ? (
                <Section title={t("reasoning.thinking")} body={thinking} variant="thinking" />
              ) : null}
            </ClampedBody>
          </CollapsibleContent>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
