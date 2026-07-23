import type { ComponentProps } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Side sheet ("drawer") on the Base UI Dialog primitive — inherits Escape /
 * outside-close / focus-trap / blurred backdrop, slid in from an edge. This is
 * the shadcn "Sheet" pattern; Base UI Drawer's swipe/snap gestures are
 * intentionally out of scope (desktop side panels don't need them).
 *
 * Composition:
 *   Drawer > DrawerTrigger + DrawerPortal > DrawerBackdrop
 *     + DrawerPopup(side) > DrawerHeader/DrawerTitle/DrawerDescription
 *                           / DrawerBody / DrawerFooter / DrawerClose
 */

type DrawerProps = BaseDialog.Root.Props;

function Drawer(props: DrawerProps) {
  return <BaseDialog.Root data-slot="drawer" {...props} />;
}

type DrawerTriggerProps = Omit<BaseDialog.Trigger.Props, "className"> & {
  className?: string;
};

function DrawerTrigger({ className, ...props }: DrawerTriggerProps) {
  return (
    <BaseDialog.Trigger
      data-slot="drawer-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

type DrawerPortalProps = BaseDialog.Portal.Props;

function DrawerPortal(props: DrawerPortalProps) {
  return <BaseDialog.Portal data-slot="drawer-portal" {...props} />;
}

type DrawerBackdropProps = Omit<BaseDialog.Backdrop.Props, "className"> & {
  className?: string;
};

function DrawerBackdrop({ className, ...props }: DrawerBackdropProps) {
  return (
    <BaseDialog.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        "fixed inset-0 z-50 min-h-dvh bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute",
        className,
      )}
      {...props}
    />
  );
}

const drawerVariants = cva(
  "fixed z-50 flex flex-col bg-background text-foreground shadow-xl outline-none transition-transform duration-200 ease-out",
  {
    variants: {
      side: {
        left: "left-0 top-0 h-dvh w-full max-w-md border-r border-border data-starting-style:-translate-x-full data-ending-style:-translate-x-full",
        right:
          "right-0 top-0 h-dvh w-full max-w-md border-l border-border data-starting-style:translate-x-full data-ending-style:translate-x-full",
        top: "top-0 left-0 w-dvw max-h-[85vh] border-b border-border data-starting-style:-translate-y-full data-ending-style:-translate-y-full",
        bottom:
          "bottom-0 left-0 w-dvw max-h-[85vh] border-t border-border data-starting-style:translate-y-full data-ending-style:translate-y-full",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

type DrawerPopupProps = Omit<BaseDialog.Popup.Props, "className"> &
  VariantProps<typeof drawerVariants> & {
    className?: string;
  };

function DrawerPopup({ className, side, ...props }: DrawerPopupProps) {
  return (
    <BaseDialog.Popup
      data-slot="drawer-popup"
      className={cn(drawerVariants({ side, className }))}
      {...props}
    />
  );
}

type DrawerTitleProps = Omit<BaseDialog.Title.Props, "className"> & {
  className?: string;
};

function DrawerTitle({ className, ...props }: DrawerTitleProps) {
  return (
    <BaseDialog.Title
      data-slot="drawer-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  );
}

type DrawerDescriptionProps = Omit<BaseDialog.Description.Props, "className"> & {
  className?: string;
};

function DrawerDescription({ className, ...props }: DrawerDescriptionProps) {
  return (
    <BaseDialog.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

type DrawerCloseProps = Omit<BaseDialog.Close.Props, "className"> & {
  className?: string;
};

function DrawerClose({ className, ...props }: DrawerCloseProps) {
  return (
    <BaseDialog.Close
      data-slot="drawer-close"
      className={cn(className)}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex shrink-0 flex-col gap-1.5 border-b border-border p-4",
        className,
      )}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DrawerBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

/** Layout helper — not a Base UI part. */
function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerBackdrop,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  drawerVariants,
  type DrawerProps,
  type DrawerTriggerProps,
  type DrawerPortalProps,
  type DrawerBackdropProps,
  type DrawerPopupProps,
  type DrawerTitleProps,
  type DrawerDescriptionProps,
  type DrawerCloseProps,
};
