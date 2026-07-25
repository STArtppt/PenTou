import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";

import { cn } from "@/lib/utils";

type ScrollAreaProps = Omit<BaseScrollArea.Root.Props, "className"> & {
  className?: string;
  /** Class applied to the scrolling viewport — e.g. padding, or `min-w-0` containment. */
  viewportClassName?: string;
};

/**
 * Scroll container on the Base UI ScrollArea primitive. Overlay scrollbars stay
 * hidden by default, fade in on hover or while scrolling (data-hovering /
 * data-scrolling), and the bar thickens when you hover it. Token-only thumb
 * (muted-foreground wash), never a decorative color. The viewport caps its own
 * width, so descendants can `overflow-x-auto` without expanding the container.
 */
function ScrollArea({ className, viewportClassName, children, ...props }: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <BaseScrollArea.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          viewportClassName,
        )}
      >
        {children}
      </BaseScrollArea.Viewport>
      <Scrollbar orientation="vertical" />
      <Scrollbar orientation="horizontal" />
      <BaseScrollArea.Corner className="bg-transparent" />
    </BaseScrollArea.Root>
  );
}

type ScrollbarProps = Omit<BaseScrollArea.Scrollbar.Props, "className"> & {
  className?: string;
};

/**
 * Overlay scrollbar. Hidden (opacity-0) at rest; fades in on hover/scroll and
 * grows from 8px to 10px while hovered. Thumb is a rounded muted-foreground
 * wash that deepens on hover; `p-0.5` keeps it off the viewport edge.
 */
function Scrollbar({ orientation = "vertical", className, ...props }: ScrollbarProps) {
  return (
    <BaseScrollArea.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5 opacity-0 transition-[opacity,width,height] duration-150 ease-out data-hovering:opacity-100 data-scrolling:opacity-100",
        "data-[orientation=vertical]:w-2 data-[orientation=vertical]:hover:w-2.5",
        "data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:hover:h-2.5 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    >
      <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/60" />
    </BaseScrollArea.Scrollbar>
  );
}

export { ScrollArea, type ScrollAreaProps };
