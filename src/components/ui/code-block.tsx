"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CodeBlockFile = {
  filename: string;
  code: string;
  language?: string;
  panelClassName?: string;
  paneStyle?: React.CSSProperties;
  highlightLines?: number[];
  highlightClassName?: string;
  showLineNumbers?: boolean;
};

export type CodeBlockProps = React.ComponentProps<"div"> & {
  code?: string;
  language?: string;
  /** Header label. Defaults to `language` (or "code") when omitted. */
  filename?: string;
  files?: CodeBlockFile[];
  panelClassName?: string;
  paneStyle?: React.CSSProperties;
  highlightLines?: number[];
  highlightClassName?: string;
  showLineNumbers?: boolean;
  /** Disable Shiki and render plain pre/code. Default true. */
  syntaxHighlighting?: boolean;
  maxHeightClassName?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function splitShikiLines(html: string): string[] {
  const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  if (!match) return [html];
  const lines = match[1].split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function escapeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function highlight(code: string, lang = "tsx"): Promise<string> {
  try {
    const { codeToHtml } = await import("shiki");
    return await codeToHtml(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
    });
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function fallbackCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CodeBlockCopyButton({
  code,
  className,
  ...props
}: React.ComponentProps<"button"> & { code: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    if (typeof navigator === "undefined") return;

    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(code)
        .then(done)
        .catch(() => {
          fallbackCopy(code);
          done();
        });
    } else {
      fallbackCopy(code);
      done();
    }
  }, [code]);

  return (
    <button
      type="button"
      data-slot="code-block-copy"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

// ─── Pane ────────────────────────────────────────────────────────────────────

type CodeBlockPaneProps = {
  code: string;
  language?: string;
  showCopy?: boolean;
  className?: string;
  style?: React.CSSProperties;
  highlightLines?: number[];
  highlightClassName?: string;
  showLineNumbers?: boolean;
  syntaxHighlighting?: boolean;
  maxHeightClassName?: string;
};

function CodeBlockPane({
  code,
  language = "tsx",
  showCopy = true,
  className,
  style,
  highlightLines,
  // Semantic highlight: primary wash (no decorative amber)
  highlightClassName = "bg-primary/10",
  showLineNumbers = false,
  syntaxHighlighting = true,
  maxHeightClassName = "max-h-80",
}: CodeBlockPaneProps) {
  const [html, setHtml] = React.useState("");

  React.useEffect(() => {
    if (!syntaxHighlighting) {
      setHtml("");
      return;
    }
    let cancelled = false;
    highlight(code, language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, syntaxHighlighting]);

  const hasHighlights = Boolean(highlightLines?.length);
  const useLineView = hasHighlights || showLineNumbers;
  const lines = React.useMemo(
    () => (html ? splitShikiLines(html) : []),
    [html],
  );

  return (
    <div
      data-slot="code-block-pane"
      className={cn("relative", className)}
      style={style}
    >
      <div
        className={cn(
          "overflow-auto",
          maxHeightClassName,
        )}
      >
        {showCopy ? (
          <CodeBlockCopyButton
            code={code}
            className="absolute top-2 right-2 z-10"
          />
        ) : null}

        {syntaxHighlighting && html ? (
          useLineView ? (
            <pre className="shiki m-0 bg-transparent p-0 font-mono text-sm leading-relaxed">
              <code className="block w-max min-w-full">
                {lines.map((line, i) => {
                  const lineNumber = i + 1;
                  const isHighlighted =
                    highlightLines?.includes(lineNumber) ?? false;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-stretch px-4 py-px",
                        isHighlighted && highlightClassName,
                        isHighlighted &&
                          "border-l-2 border-primary pl-[calc(1rem-2px)]",
                      )}
                    >
                      {showLineNumbers ? (
                        <span className="mr-4 w-4 shrink-0 select-none text-right font-mono text-xs leading-relaxed text-muted-foreground/50">
                          {lineNumber}
                        </span>
                      ) : null}
                      <span
                        className="flex-1"
                        dangerouslySetInnerHTML={{
                          __html: line || "&nbsp;",
                        }}
                      />
                    </div>
                  );
                })}
              </code>
            </pre>
          ) : (
            <div
              className={cn(
                "[&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:p-4 [&>pre]:font-mono [&>pre]:text-sm [&>pre]:leading-relaxed [&>pre]:whitespace-pre",
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        ) : (
          <pre className="m-0 p-4 font-mono text-sm leading-relaxed whitespace-pre text-foreground">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

function CodeBlock({
  code,
  language = "tsx",
  filename,
  files,
  className,
  panelClassName,
  paneStyle,
  highlightLines,
  highlightClassName,
  showLineNumbers,
  syntaxHighlighting = true,
  maxHeightClassName,
  ...props
}: CodeBlockProps) {
  const normalizedFiles: CodeBlockFile[] = React.useMemo(() => {
    if (files && files.length > 0) return files;
    if (code !== undefined) {
      const label = filename ?? language ?? "code";
      return [
        {
          filename: label,
          code,
          language,
          panelClassName,
          paneStyle,
          highlightLines,
          highlightClassName,
          showLineNumbers,
        },
      ];
    }
    return [];
  }, [
    files,
    code,
    language,
    filename,
    panelClassName,
    paneStyle,
    highlightLines,
    highlightClassName,
    showLineNumbers,
  ]);

  const isMulti = normalizedFiles.length > 1;
  const [activeTab, setActiveTab] = React.useState(
    normalizedFiles[0]?.filename ?? "",
  );

  React.useEffect(() => {
    if (
      normalizedFiles.length > 0 &&
      !normalizedFiles.some((f) => f.filename === activeTab)
    ) {
      setActiveTab(normalizedFiles[0].filename);
    }
  }, [normalizedFiles, activeTab]);

  const activeFile =
    normalizedFiles.find((f) => f.filename === activeTab) ??
    normalizedFiles[0];

  if (normalizedFiles.length === 0) return null;

  return (
    <div
      data-slot="code-block"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-muted/50 text-sm",
        className,
      )}
      {...props}
    >
      <div
        data-slot="code-block-header"
        className="flex items-center justify-between gap-2 border-b border-border"
      >
        {isMulti ? (
          <div
            role="tablist"
            aria-label="Code files"
            className="flex min-w-0 flex-1 items-center overflow-x-auto"
          >
            {normalizedFiles.map((file) => {
              const selected = file.filename === activeTab;
              return (
                <button
                  key={file.filename}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(file.filename)}
                  className={cn(
                    "relative shrink-0 px-3 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    selected
                      ? "text-foreground after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5 after:rounded-full after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {file.filename}
                </button>
              );
            })}
          </div>
        ) : (
          <span
            data-slot="code-block-filename"
            className="px-3 py-2 text-xs font-medium text-muted-foreground"
          >
            {normalizedFiles[0].filename}
          </span>
        )}

        {activeFile ? (
          <CodeBlockCopyButton
            code={activeFile.code}
            className="mr-1 shrink-0"
          />
        ) : null}
      </div>

      {activeFile ? (
        <CodeBlockPane
          key={activeFile.filename}
          code={activeFile.code}
          language={activeFile.language}
          showCopy={false}
          className={activeFile.panelClassName}
          style={activeFile.paneStyle}
          highlightLines={activeFile.highlightLines}
          highlightClassName={activeFile.highlightClassName}
          showLineNumbers={activeFile.showLineNumbers}
          syntaxHighlighting={syntaxHighlighting}
          maxHeightClassName={maxHeightClassName}
        />
      ) : null}
    </div>
  );
}

export { CodeBlock, CodeBlockPane, CodeBlockCopyButton };
