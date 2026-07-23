import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, RotateCcw, X } from "lucide-react";
import { defaultUrlTransform } from "react-markdown";
import { useTranslation } from "../i18n";

/**
 * 图片渲染与全屏查看（spec media-assets US-01 / §4.7 v0.5）。
 * - MarkdownImage：markdownComponents 的 img 渲染器（懒加载 / 样式约束 / 失败兜底占位）
 * - ImageGalleryProvider：按渲染容器收集有序图集
 * - ImageLightbox：缩放/平移/Esc/遮罩关闭；多图时左右翻页
 */

/** ReactMarkdown urlTransform：默认白名单之外放行 data:image/（存量内容兼容，边界 5）。 */
export function imageUrlTransform(url: string): string {
  if (url.startsWith("data:image/")) return url;
  return defaultUrlTransform(url);
}

export type GalleryItem = { id: string; src: string; alt?: string };

type GalleryContextValue = {
  register: (item: GalleryItem) => void;
  unregister: (id: string) => void;
  getItems: () => GalleryItem[];
};

const ImageGalleryContext = createContext<GalleryContextValue | null>(null);

/** 挂在 ChatBody / DocViewer / AiSidebar 消息列表根（决策 12）。 */
export function ImageGalleryProvider({ children }: { children: React.ReactNode }) {
  const itemsRef = useRef(new Map<string, GalleryItem>());
  const orderRef = useRef<string[]>([]);

  const register = useCallback((item: GalleryItem) => {
    if (!itemsRef.current.has(item.id)) {
      orderRef.current.push(item.id);
    }
    itemsRef.current.set(item.id, item);
  }, []);

  const unregister = useCallback((id: string) => {
    itemsRef.current.delete(id);
    orderRef.current = orderRef.current.filter((x) => x !== id);
  }, []);

  const getItems = useCallback((): GalleryItem[] => {
    return orderRef.current
      .map((id) => itemsRef.current.get(id))
      .filter((item): item is GalleryItem => Boolean(item?.src));
  }, []);

  const value = useMemo(
    () => ({ register, unregister, getItems }),
    [register, unregister, getItems],
  );

  return (
    <ImageGalleryContext.Provider value={value}>
      {children}
    </ImageGalleryContext.Provider>
  );
}

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const gallery = useContext(ImageGalleryContext);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [gallerySnapshot, setGallerySnapshot] = useState<GalleryItem[] | null>(null);
  const [startIndex, setStartIndex] = useState(0);

  // 成功渲染时向图集注册；失败占位不入集（US-01 AC6）
  useEffect(() => {
    if (!gallery || !src || failed) return;
    gallery.register({ id, src, alt });
    return () => gallery.unregister(id);
  }, [gallery, id, src, alt, failed]);

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
            className="break-all text-blue-600 underline transition-colors hover:text-foreground dark:text-blue-400 dark:hover:text-foreground"
          >
            {src}
          </a>
        )}
      </span>
    );
  }

  const openLightbox = () => {
    const items = gallery?.getItems() ?? [];
    // 无 Provider 或图集未含自身时退化为单图
    const list = items.some((item) => item.id === id)
      ? items
      : [{ id, src, alt }];
    const index = Math.max(0, list.findIndex((item) => item.id === id));
    setGallerySnapshot(list);
    setStartIndex(index);
    setOpen(true);
  };

  return (
    <>
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={openLightbox}
        className="my-2 max-w-full cursor-zoom-in rounded-lg border border-zinc-200 dark:border-white/10"
      />
      {open && gallerySnapshot && (
        <ImageLightbox
          items={gallerySnapshot}
          initialIndex={startIndex}
          onClose={() => {
            setOpen(false);
            setGallerySnapshot(null);
          }}
        />
      )}
    </>
  );
}

interface ImageLightboxProps {
  items: GalleryItem[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ items, initialIndex, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();
  const wheelAreaRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<Element | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const draggedRef = useRef(false);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)),
  );
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const total = items.length;
  const multi = total >= 2;
  const current = items[index] ?? items[0];
  const canPrev = multi && index > 0;
  const canNext = multi && index < total - 1;

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const goPrev = useCallback(() => {
    setIndex((i) => {
      if (i <= 0) return i;
      return i - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= total - 1) return i;
      return i + 1;
    });
  }, [total]);

  // 翻页重置缩放/平移（US-01 AC4）
  useEffect(() => {
    resetView();
  }, [index, resetView]);

  useEffect(() => {
    lastActiveRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (lastActiveRef.current instanceof HTMLElement) lastActiveRef.current.focus();
    };
  }, [onClose, goPrev, goNext]);

  const zoomBy = useCallback((factor: number) => {
    setScale((currentScale) => Math.min(4, Math.max(0.25, Number((currentScale * factor).toFixed(3)))));
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

  /** 点击遮罩关闭；拖拽松手不误关（US-01 AC2 / §4.7）。 */
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (event.target === event.currentTarget) onClose();
  };

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-sm"
      data-testid="image-lightbox"
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
      <div
        className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-900/90 p-1 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {multi && (
          <span
            className="min-w-[3.25rem] px-1 text-center text-xs tabular-nums text-zinc-300"
            data-testid="image-lightbox-counter"
          >
            {index + 1} / {total}
          </span>
        )}
        <button type="button" onClick={() => zoomBy(1 / 1.2)} className="rounded p-2 hover:bg-white/10" title={t("image.zoomOut")}>
          <Minus size={16} />
        </button>
        <span className="w-14 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.2)} className="rounded p-2 hover:bg-white/10" title={t("image.zoomIn")}>
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={resetView}
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

      {multi && (
        <>
          <button
            type="button"
            data-testid="image-lightbox-prev"
            disabled={!canPrev}
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-lg border border-white/10 bg-zinc-900/90 p-2 text-zinc-100 shadow-2xl transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            title={t("image.prev")}
            aria-label={t("image.prev")}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            data-testid="image-lightbox-next"
            disabled={!canNext}
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-lg border border-white/10 bg-zinc-900/90 p-2 text-zinc-100 shadow-2xl transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            title={t("image.next")}
            aria-label={t("image.next")}
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      <div
        ref={wheelAreaRef}
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
          <img
            src={current.src}
            alt={current.alt ?? ""}
            draggable={false}
            data-testid="image-lightbox-img"
            className="max-h-[88vh] max-w-[88vw] select-none rounded-md"
          />
        </div>
      </div>
    </div>
  );
}
