import type { ComponentProps } from "react";
import { useRef } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

/**
 * Fullscreen dark media viewer ("lightbox", z=60 — the layer above modal=50 in
 * the layering table: dropdown=30 / modal=50 / lightbox=60 / toast=70). Base UI
 * Dialog underneath for Escape / focus-trap / outside dismiss; the dark blurred
 * backdrop is the surface.
 *
 * The Popup fills the viewport as the interaction surface (pan / click). Because
 * it covers the backdrop, consumers implement click-to-close on the Popup with a
 * `target === currentTarget` guard (so dragging on the media doesn't close it),
 * and render a floating toolbar + centered media inside. Always include a
 * LightboxTitle (sr-only is fine) for the a11y label.
 *
 * Focus: default initialFocus is the popup surface itself (tabIndex=-1 via Base UI),
 * not the first toolbar button — avoids a heavy browser focus ring on open. Toolbar
 * buttons keep a subdued focus-visible ring for keyboard Tab.
 *
 * Composition:
 *   Lightbox > LightboxPortal > LightboxBackdrop
 *     + LightboxPopup > LightboxTitle(sr-only) + toolbar + media + LightboxClose
 */

/** Soft keyboard focus for dark chrome buttons (suppress browser default white ring). */
const LIGHTBOX_BUTTON_FOCUS =
  "outline-none focus:outline-none focus-visible:bg-white/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/35";

type LightboxProps = BaseDialog.Root.Props;

function Lightbox(props: LightboxProps) {
  return <BaseDialog.Root data-slot="lightbox" {...props} />;
}

type LightboxPortalProps = BaseDialog.Portal.Props;

function LightboxPortal(props: LightboxPortalProps) {
  return <BaseDialog.Portal data-slot="lightbox-portal" {...props} />;
}

type LightboxBackdropProps = Omit<BaseDialog.Backdrop.Props, "className"> & {
  className?: string;
};

function LightboxBackdrop({ className, ...props }: LightboxBackdropProps) {
  return (
    <BaseDialog.Backdrop
      data-slot="lightbox-backdrop"
      className={cn(
        // lightbox = 60; dark, blurred, fixed-transparency surface
        "fixed inset-0 z-[60] bg-zinc-950/85 backdrop-blur-sm transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute",
        className,
      )}
      {...props}
    />
  );
}

type LightboxPopupProps = Omit<BaseDialog.Popup.Props, "className"> & {
  className?: string;
};

function LightboxPopup({ className, initialFocus, ...props }: LightboxPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Base UI 默认 focus 首个 tabbable（工具栏按钮）→ 鼠标点开即出现重描边。
  // 灯箱应 focus 弹层本身（与 touch 默认一致）；消费者可传 initialFocus 覆盖。
  const resolvedInitialFocus =
    initialFocus !== undefined ? initialFocus : () => popupRef.current;

  return (
    <BaseDialog.Popup
      ref={popupRef}
      data-slot="lightbox-popup"
      initialFocus={resolvedInitialFocus}
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center p-4 text-zinc-100 outline-none transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        // 内部原生 button 统一克制 focus 环（含 ImageLightbox 手写工具栏 / 翻页键）
        "[&_button]:outline-none [&_button]:focus:outline-none [&_button]:focus-visible:bg-white/10 [&_button]:focus-visible:ring-1 [&_button]:focus-visible:ring-inset [&_button]:focus-visible:ring-white/35",
        className,
      )}
      {...props}
    />
  );
}

type LightboxTitleProps = Omit<BaseDialog.Title.Props, "className"> & {
  className?: string;
};

function LightboxTitle({ className, ...props }: LightboxTitleProps) {
  return (
    <BaseDialog.Title
      data-slot="lightbox-title"
      className={cn(className)}
      {...props}
    />
  );
}

type LightboxCloseProps = Omit<BaseDialog.Close.Props, "className"> & {
  className?: string;
};

function LightboxClose({ className, ...props }: LightboxCloseProps) {
  return (
    <BaseDialog.Close
      data-slot="lightbox-close"
      className={cn(
        "rounded p-2 text-zinc-100 transition-colors hover:bg-white/10",
        LIGHTBOX_BUTTON_FOCUS,
        className,
      )}
      {...props}
    />
  );
}

/** Floating toolbar helper — absolute pill, dark, top-right by default. */
function LightboxToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="lightbox-toolbar"
      className={cn(
        "absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-900/90 p-1 text-zinc-100 shadow-2xl",
        className,
      )}
      {...props}
    />
  );
}

export {
  Lightbox,
  LightboxPortal,
  LightboxBackdrop,
  LightboxPopup,
  LightboxTitle,
  LightboxClose,
  LightboxToolbar,
  LIGHTBOX_BUTTON_FOCUS,
  type LightboxProps,
  type LightboxPortalProps,
  type LightboxBackdropProps,
  type LightboxPopupProps,
  type LightboxTitleProps,
  type LightboxCloseProps,
};
