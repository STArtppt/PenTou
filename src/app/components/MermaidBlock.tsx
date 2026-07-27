import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Code2, Copy, Eye, Loader2, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import { copyText } from "../utils/clipboard";
import { renderMermaid, type MermaidTheme } from "../utils/mermaid";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import {
  Lightbox,
  LightboxBackdrop,
  LightboxPopup,
  LightboxPortal,
  LightboxTitle,
  LightboxToolbar,
} from "@/components/ui/lightbox";

type RenderStatus =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; svg: string; bindFunctions?: (el: Element) => void }
  | { kind: "error"; message: string };

interface MermaidBlockProps {
  source: string;
  className?: string;
}

function toMermaidTheme(theme: "light" | "dark"): MermaidTheme {
  return theme === "dark" ? "dark" : "default";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.split("\n")[0];
  return String(error || "Unknown error");
}

function sanitizeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function MermaidBlock({ source }: MermaidBlockProps) {
  const { theme } = useAppContext();
  const { t, language } = useTranslation();
  const reactId = sanitizeId(useId());
  const renderRef = useRef(0);
  const svgRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<RenderStatus>({ kind: "idle" });
  const [view, setView] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const text = source.replace(/\n$/, "");
  const mermaidTheme = toMermaidTheme(theme);

  useEffect(() => {
    if (!text.trim()) {
      setStatus({ kind: "error", message: t("mermaid.empty") });
      setView("source");
      return;
    }

    const renderVersion = renderRef.current + 1;
    renderRef.current = renderVersion;
    setStatus({ kind: "loading" });

    renderMermaid(`mermaid-${reactId}-${renderVersion}`, text, mermaidTheme)
      .then((result) => {
        if (renderRef.current !== renderVersion) return;
        setStatus({ kind: "ready", svg: result.svg, bindFunctions: result.bindFunctions });
        setView((current) => (current === "source" ? current : "preview"));
      })
      .catch((error) => {
        if (renderRef.current !== renderVersion) return;
        const isLoadError = /failed to load|fetch dynamically imported module|import/i.test(getErrorMessage(error));
        setStatus({
          kind: "error",
          message: isLoadError ? t("mermaid.loadFailed") : t("mermaid.renderFailed", { message: getErrorMessage(error) }),
        });
        setView("source");
      });
  }, [language, mermaidTheme, reactId, text]);

  useEffect(() => {
    if (status.kind !== "ready" || !svgRef.current) return;
    status.bindFunctions?.(svgRef.current);
  }, [status]);

  const handleCopy = useCallback(async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const showSource = view === "source" || status.kind === "error";

  return (
    <div data-testid="mermaid-block" className="relative group mt-4 mb-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#151515]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-100/80 px-4 py-2 dark:border-white/10 dark:bg-[#2A2A2A]">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">mermaid</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setView(showSource ? "preview" : "source")}
            disabled={status.kind !== "ready" && !showSource}
            className="h-auto gap-1 rounded px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground"
            title={showSource ? t("mermaid.showPreview") : t("mermaid.showSource")}
          >
            {showSource ? <Eye size={12} /> : <Code2 size={12} />}
            {showSource ? t("mermaid.preview") : t("mermaid.source")}
          </Button>
          {showSource ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-auto gap-1 rounded px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? t("main.copied") : t("main.copy")}
            </Button>
          ) : (
            <IconTooltip label={t("mermaid.fullscreen")}>
              <button
                ref={fullscreenButtonRef}
                type="button"
                onClick={() => setFullscreenOpen(true)}
                disabled={status.kind !== "ready"}
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-foreground"
              >
                <Maximize2 size={14} />
              </button>
            </IconTooltip>
          )}
        </div>
      </div>

      {status.kind === "loading" && (
        <div className="flex min-h-40 items-center justify-center gap-2 bg-zinc-50 text-sm text-zinc-500 dark:bg-[#111] dark:text-zinc-400">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
          {t("mermaid.rendering")}
        </div>
      )}

      {status.kind === "error" && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle size={14} />
            {status.message}
          </span>
        </div>
      )}

      {showSource ? (
        <pre className="max-h-[520px] overflow-auto bg-zinc-50 p-4 text-sm text-zinc-800 shadow-inner dark:bg-[#111] dark:text-zinc-300 custom-scrollbar">
          <code className="language-mermaid">{text}</code>
        </pre>
      ) : status.kind === "ready" ? (
        <button
          type="button"
          onClick={() => setFullscreenOpen(true)}
          className="block w-full cursor-zoom-in bg-white p-4 text-left dark:bg-[#151515]"
          title={t("mermaid.fullscreen")}
        >
          <div
            ref={svgRef}
            className="mermaid-svg mx-auto flex max-w-full justify-center overflow-x-auto text-zinc-900 dark:text-zinc-100 custom-scrollbar"
            dangerouslySetInnerHTML={{ __html: status.svg }}
          />
        </button>
      ) : null}

      {fullscreenOpen && status.kind === "ready" && (
        <MermaidFullscreenModal
          svg={status.svg}
          bindFunctions={status.bindFunctions}
          theme={theme}
          labels={{
            title: t("mermaid.fullscreen"),
            zoomIn: t("mermaid.zoomIn"),
            zoomOut: t("mermaid.zoomOut"),
            reset: t("mermaid.reset"),
            close: t("mermaid.close"),
          }}
          onClose={() => {
            setFullscreenOpen(false);
            fullscreenButtonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

interface MermaidFullscreenModalProps {
  svg: string;
  bindFunctions?: (el: Element) => void;
  /** App theme — lightbox is always dark; light mermaid needs a light plate for edge contrast. */
  theme: "light" | "dark";
  labels: {
    title: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
    close: string;
  };
  onClose: () => void;
}

function MermaidFullscreenModal({ svg, bindFunctions, theme, labels, onClose }: MermaidFullscreenModalProps) {
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const draggedRef = useRef(false);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Escape / focus-restore / body-scroll-lock 交给 @startist/lightbox (Base UI Dialog)。

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => Math.min(4, Math.max(0.25, Number((current * factor).toFixed(3)))));
  }, []);

  // Popup 内容经 Base UI Portal 挂载（晚于父 effect），改用回调 ref：节点挂上即绑定。
  const bindContent = useCallback((node: HTMLDivElement | null) => {
    if (node) bindFunctions?.(node);
  }, [bindFunctions]);

  const attachWheel = useCallback((node: HTMLDivElement | null) => {
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 1 / 1.2 : 1.2);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    wheelCleanupRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, [zoomBy]);

  // Lightbox 遮罩恒为 dark（zinc-950/85）。default 主题 lineColor=#333，透明 SVG 直接叠上去会丢边。
  // 给图一块与内联预览一致的底板，只包住图（不全屏铺白），随 pan/zoom 一起变换。
  const surfaceClass =
    theme === "dark"
      ? "bg-[#151515]"
      : "bg-white";

  // 与 ImageLightbox 一致：Popup 被 h-full 子层铺满，仅靠 Popup 上的 target===currentTarget 永远接不到「点遮罩」。
  // 关闭监听挂在全视口 mask 层；图本体 stopPropagation；拖拽松手不误关（spec US-04 AC3）。
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <Lightbox open onOpenChange={(next) => { if (!next) onClose(); }}>
      <LightboxPortal>
        <LightboxBackdrop />
        <LightboxPopup
          onMouseMove={(event) => {
            if (!dragRef.current) return;
            const dx = event.clientX - dragRef.current.x;
            const dy = event.clientY - dragRef.current.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) draggedRef.current = true;
            setPan({
              x: dragRef.current.panX + dx,
              y: dragRef.current.panY + dy,
            });
          }}
          onMouseUp={() => {
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            dragRef.current = null;
          }}
          onClick={handleBackdropClick}
        >
          <LightboxTitle className="sr-only">{labels.title}</LightboxTitle>
          <LightboxToolbar onClick={(event) => event.stopPropagation()}>
            <IconTooltip label={labels.zoomOut}>
              <button type="button" onClick={() => zoomBy(1 / 1.2)} className="rounded p-2 hover:bg-white/10">
                <Minus size={16} />
              </button>
            </IconTooltip>
            <span className="w-14 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
            <IconTooltip label={labels.zoomIn}>
              <button type="button" onClick={() => zoomBy(1.2)} className="rounded p-2 hover:bg-white/10">
                <Plus size={16} />
              </button>
            </IconTooltip>
            <IconTooltip label={labels.reset}>
              <button
                type="button"
                onClick={() => {
                  setScale(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="rounded p-2 hover:bg-white/10"
              >
                <RotateCcw size={16} />
              </button>
            </IconTooltip>
            <IconTooltip label={labels.close}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                onClick={(event) => event.stopPropagation()}
                className="rounded p-2 hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </IconTooltip>
          </LightboxToolbar>

          <div
            ref={attachWheel}
            data-testid="mermaid-fullscreen-mask"
            className="flex h-full w-full items-center justify-center overflow-hidden"
            onClick={handleBackdropClick}
          >
            <div
              className="cursor-grab active:cursor-grabbing"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                draggedRef.current = false;
                dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
              }}
            >
              <div
                ref={bindContent}
                data-testid="mermaid-fullscreen-surface"
                className={`rounded-xl p-6 shadow-2xl [&_svg]:max-h-[88vh] [&_svg]:max-w-[88vw] ${surfaceClass}`}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        </LightboxPopup>
      </LightboxPortal>
    </Lightbox>
  );
}
