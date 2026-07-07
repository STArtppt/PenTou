import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Minus, Plus, RotateCcw, X } from "lucide-react";
import { defaultUrlTransform } from "react-markdown";
import { useTranslation } from "../i18n";

/**
 * 图片渲染与全屏查看（spec media-assets US-01）。
 * - MarkdownImage：markdownComponents 的 img 渲染器（懒加载 / 样式约束 / 失败兜底占位）
 * - ImageLightbox：全屏查看，滚轮缩放、拖拽平移、Esc/遮罩关闭（交互对齐 MermaidBlock 全屏模式）
 */

/** ReactMarkdown urlTransform：默认白名单之外放行 data:image/（存量内容兼容，边界 5）。 */
export function imageUrlTransform(url: string): string {
  if (url.startsWith("data:image/")) return url;
  return defaultUrlTransform(url);
}

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  // 加载失败或 src 为空：占位框（含 alt 与原始链接），不出现浏览器裂图图标（US-01 AC3）
  if (!src || failed) {
    return (
      <span className="my-2 flex max-w-full flex-col gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium">
          <ImageOff size={14} />
          {t("image.failed")}{alt ? ` · ${alt}` : ""}
        </span>
        {src && !src.startsWith("data:") && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-blue-600 underline transition-colors hover:text-orange-500 dark:text-blue-400 dark:hover:text-yellow-400"
          >
            {src}
          </a>
        )}
      </span>
    );
  }

  return (
    <>
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={() => setOpen(true)}
        className="my-2 max-w-full cursor-zoom-in rounded-lg border border-zinc-200 dark:border-white/10"
      />
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();
  const wheelAreaRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<Element | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    lastActiveRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (lastActiveRef.current instanceof HTMLElement) lastActiveRef.current.focus();
    };
  }, [onClose]);

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => Math.min(4, Math.max(0.25, Number((current * factor).toFixed(3)))));
  }, []);

  useEffect(() => {
    const wheelArea = wheelAreaRef.current;
    if (!wheelArea) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 1 / 1.2 : 1.2);
    };

    wheelArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => wheelArea.removeEventListener("wheel", handleWheel);
  }, [zoomBy]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-sm"
      onMouseMove={(event) => {
        if (!dragRef.current) return;
        setPan({
          x: dragRef.current.panX + event.clientX - dragRef.current.x,
          y: dragRef.current.panY + event.clientY - dragRef.current.y,
        });
      }}
      onMouseUp={() => {
        dragRef.current = null;
      }}
      onMouseLeave={() => {
        dragRef.current = null;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-900/90 p-1 text-zinc-100 shadow-2xl">
        <button type="button" onClick={() => zoomBy(1 / 1.2)} className="rounded p-2 hover:bg-white/10" title={t("image.zoomOut")}>
          <Minus size={16} />
        </button>
        <span className="w-14 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} className="rounded p-2 hover:bg-white/10" title={t("image.zoomIn")}>
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
          className="rounded p-2 hover:bg-white/10"
          title={t("image.reset")}
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onClick={(event) => event.stopPropagation()}
          className="rounded p-2 hover:bg-white/10"
          title={t("image.close")}
        >
          <X size={16} />
        </button>
      </div>

      <div ref={wheelAreaRef} className="h-full w-full overflow-hidden">
        <div
          className="flex h-full w-full cursor-grab items-center justify-center active:cursor-grabbing"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          onMouseDown={(event) => {
            event.preventDefault();
            dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          }}
        >
          <img src={src} alt={alt ?? ""} draggable={false} className="max-h-[88vh] max-w-[88vw] select-none rounded-md" />
        </div>
      </div>
    </div>
  );
}
