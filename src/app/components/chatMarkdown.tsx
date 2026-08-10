/**
 * 会话消息共用的 Markdown 渲染配置。
 * 从 ChatBody 抽出，供 MessageBubble 与 ReasoningPanel 共用，避免复制一份。
 */
import React from "react";
import { remarkPlugins } from "@/shared/markdown-gfm";
import { MermaidBlock } from "./MermaidBlock";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownImage, imageUrlTransform } from "./ImageLightbox";

export { remarkPlugins, imageUrlTransform };

export const markdownComponents = {
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
  // dark 底色用 background token，避免新文件引入硬编码 hex（lint:ui）
  tbody: ({ node, ...props }: any) => <tbody className="divide-y divide-zinc-200 dark:divide-white/10 bg-white dark:bg-background" {...props} />,
  tr: ({ node, ...props }: any) => <tr className="transition-colors hover:bg-zinc-50 dark:hover:bg-white/5" {...props} />,
  th: ({ node, ...props }: any) => <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider" {...props} />,
  td: ({ node, ...props }: any) => <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300" {...props} />,
};
