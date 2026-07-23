import type { ComponentProps } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

/**
 * Modal layer: z-50 (dropdown=30 / modal=50 / lightbox=60 / toast=70).
 * Lightbox (z=60) is out of scope for this primitive — use a separate shell later.
 *
 * Composition (Base UI semantics, render prop — no asChild/Slot):
 *   Dialog > DialogTrigger + DialogPortal > DialogBackdrop + DialogPopup
 *     > DialogHeader / DialogTitle / DialogDescription / body / DialogFooter / DialogClose
 */

type DialogProps = BaseDialog.Root.Props;

function Dialog(props: DialogProps) {
  return <BaseDialog.Root data-slot="dialog" {...props} />;
}

type DialogTriggerProps = Omit<BaseDialog.Trigger.Props, "className"> & {
  className?: string;
};

function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return (
    <BaseDialog.Trigger
      data-slot="dialog-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

type DialogPortalProps = BaseDialog.Portal.Props;

function DialogPortal(props: DialogPortalProps) {
  return <BaseDialog.Portal data-slot="dialog-portal" {...props} />;
}

type DialogBackdropProps = Omit<BaseDialog.Backdrop.Props, "className"> & {
  className?: string;
};

function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        // modal = 50; fixed transparency overlay (not a semantic color token)
        "fixed inset-0 z-50 min-h-dvh bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute",
        className,
      )}
      {...props}
    />
  );
}

type DialogViewportProps = Omit<BaseDialog.Viewport.Props, "className"> & {
  className?: string;
};

/**
 * Optional scroll container around Popup for long content.
 * Prefer: Portal > Backdrop + Viewport > Popup.
 */
function DialogViewport({ className, ...props }: DialogViewportProps) {
  return (
    <BaseDialog.Viewport
      data-slot="dialog-viewport"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4",
        className,
      )}
      {...props}
    />
  );
}

type DialogPopupProps = Omit<BaseDialog.Popup.Props, "className"> & {
  className?: string;
};

function DialogPopup({ className, ...props }: DialogPopupProps) {
  return (
    <BaseDialog.Popup
      data-slot="dialog-popup"
      className={cn(
        // rounded-lg = var(--radius) = 0.625rem = 10px; hierarchy via border, not shadow
        "fixed top-1/2 left-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-background p-6 text-foreground outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 max-sm:max-w-[calc(100vw-2rem)]",
        className,
      )}
      {...props}
    />
  );
}

type DialogTitleProps = Omit<BaseDialog.Title.Props, "className"> & {
  className?: string;
};

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  );
}

type DialogDescriptionProps = Omit<BaseDialog.Description.Props, "className"> & {
  className?: string;
};

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

type DialogCloseProps = Omit<BaseDialog.Close.Props, "className"> & {
  className?: string;
};

function DialogClose({ className, ...props }: DialogCloseProps) {
  return (
    <BaseDialog.Close
      data-slot="dialog-close"
      className={cn(className)}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("text-sm", className)}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogViewport,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogHeader,
  DialogBody,
  DialogFooter,
  type DialogProps,
  type DialogTriggerProps,
  type DialogPortalProps,
  type DialogBackdropProps,
  type DialogViewportProps,
  type DialogPopupProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogCloseProps,
};
