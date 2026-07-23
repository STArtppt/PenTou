import type { ReactNode } from "react";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Confirmation modal on the Base UI AlertDialog primitive (no outside/Escape
 * dismiss — the user must choose an action). Modal layer z-50; backdrop blurs
 * page content to focus attention. Replaces window.confirm.
 *
 * Convenience API (controlled):
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title=… description=…
 *     confirmLabel="Delete" confirmVariant="danger" onConfirm={fn} />
 *
 * Raw parts are also exported for bespoke composition.
 */

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirm button variant — defaults to danger for destructive actions. */
  confirmVariant?: ButtonProps["variant"];
  onConfirm: () => void;
};

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop
          data-slot="confirm-dialog-backdrop"
          className="fixed inset-0 z-50 min-h-dvh bg-black/50 backdrop-blur-sm transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute"
        />
        <BaseAlertDialog.Popup
          data-slot="confirm-dialog-popup"
          className="fixed top-1/2 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-background p-6 text-foreground outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 max-sm:max-w-[calc(100vw-2rem)]"
        >
          <div className="flex flex-col gap-1.5">
            <BaseAlertDialog.Title className="text-base leading-none font-semibold">
              {title}
            </BaseAlertDialog.Title>
            {description ? (
              <BaseAlertDialog.Description className="text-sm text-muted-foreground">
                {description}
              </BaseAlertDialog.Description>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <BaseAlertDialog.Close render={<Button variant="ghost" size="sm" />}>
              {cancelLabel}
            </BaseAlertDialog.Close>
            <Button
              variant={confirmVariant}
              size="sm"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}

/** Raw Base UI parts for bespoke composition. */
const ConfirmDialogRoot = BaseAlertDialog.Root;
const ConfirmDialogTrigger = BaseAlertDialog.Trigger;
const ConfirmDialogPortal = BaseAlertDialog.Portal;
const ConfirmDialogBackdrop = BaseAlertDialog.Backdrop;
const ConfirmDialogPopup = BaseAlertDialog.Popup;
const ConfirmDialogTitle = BaseAlertDialog.Title;
const ConfirmDialogDescription = BaseAlertDialog.Description;
const ConfirmDialogClose = BaseAlertDialog.Close;

export {
  ConfirmDialog,
  ConfirmDialogRoot,
  ConfirmDialogTrigger,
  ConfirmDialogPortal,
  ConfirmDialogBackdrop,
  ConfirmDialogPopup,
  ConfirmDialogTitle,
  ConfirmDialogDescription,
  ConfirmDialogClose,
  type ConfirmDialogProps,
};
