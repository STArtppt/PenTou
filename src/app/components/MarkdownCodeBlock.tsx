import type { ReactNode } from "react";

import { CodeBlock } from "@/components/ui/code-block";

/**
 * Markdown fenced-code adapter for @startist/code-block.
 * Used by ChatBody + DocViewer so both surfaces share one visual primitive.
 */
export function MarkdownCodeBlock({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const text = String(children ?? "").replace(/\n$/, "");
  const language = className?.replace(/language-/, "") || "snippet";

  return (
    <CodeBlock
      code={text}
      language={language === "snippet" ? "text" : language}
      filename={language}
      className="my-4"
    />
  );
}
