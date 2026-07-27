import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Hover/focus hint on the Base UI Tooltip primitive (render prop — no Radix,
 * no asChild). Floating layer z-70 (toast tier) so tooltips stay above Dialog/
 * Drawer (50) and Lightbox (60) when portaled to body. Inverted primary surface
 * for short labels; arrow tracks side via data-side.
 *
 * Composition:
 *   TooltipProvider > Tooltip > TooltipTrigger + TooltipContent
 * Wrap a non-button host with render prop:
 *   <TooltipTrigger render={<Button size="icon" />}>…</TooltipTrigger>
 */

type TooltipProviderProps = TooltipPrimitive.Provider.Props;

function TooltipProvider({ delay = 300, ...props }: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

type TooltipProps = TooltipPrimitive.Root.Props;

function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

type TooltipTriggerProps = Omit<TooltipPrimitive.Trigger.Props, "className"> & {
  className?: string;
};

function TooltipTrigger({ className, ...props }: TooltipTriggerProps) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, "className"> & {
  className?: string;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  align?: TooltipPrimitive.Positioner.Props["align"];
  /**
   * When false, omit the pointer arrow (useful for dense toolbars where the
   * arrow adds noise). Default true.
   */
  showArrow?: boolean;
};

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  showArrow = true,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        // toast tier = 70 (above lightbox z-[60]); same arbitrary form as lightbox
        className="z-[70]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            // inverted primary = high-contrast short label; floating → shadow ok
            "z-[70] w-fit max-w-xs origin-[var(--transform-origin)] rounded-md bg-primary px-2.5 py-1 text-xs text-balance text-primary-foreground shadow-md transition-[opacity,transform] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
          {showArrow ? (
            <TooltipPrimitive.Arrow
              data-slot="tooltip-arrow"
              // SVG path points down by default. Rotate so the tip always faces
              // the trigger: top → no rotate, bottom → 180°, left → -90°, right → 90°.
              className="flex data-[side=bottom]:top-[-6px] data-[side=bottom]:rotate-180 data-[side=left]:right-[-8px] data-[side=left]:-rotate-90 data-[side=right]:left-[-8px] data-[side=right]:rotate-90 data-[side=top]:bottom-[-6px]"
            >
              <svg
                width="12"
                height="6"
                viewBox="0 0 12 6"
                fill="none"
                className="block"
                aria-hidden
              >
                <path d="M0 0L6 6L12 0" className="fill-primary" />
              </svg>
            </TooltipPrimitive.Arrow>
          ) : null}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
  type TooltipProviderProps,
};
