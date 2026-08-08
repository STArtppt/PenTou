import type { ComponentProps } from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";

import { cn } from "@/lib/utils";

/**
 * Independent expand/collapse panel (Base UI Collapsible).
 *
 * Use for single blocks or nested independent sections (e.g. metadata panel +
 * technical details). Prefer Accordion only when items must be mutually exclusive.
 *
 * Composition:
 *   Collapsible > CollapsibleTrigger + CollapsiblePanel
 *
 * Controlled: open + onOpenChange. Uncontrolled: defaultOpen (default false).
 * Panel height animates via --collapsible-panel-height; reduced-motion disables it.
 */

type CollapsibleProps = Omit<BaseCollapsible.Root.Props, "className"> & {
  className?: string;
};

function Collapsible({ className, ...props }: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      data-slot="collapsible"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

type CollapsibleTriggerProps = Omit<BaseCollapsible.Trigger.Props, "className"> & {
  className?: string;
};

/**
 * Native <button>. Base UI sets aria-expanded + panel association;
 * Enter / Space toggle. data-panel-open when open (for chevron etc.).
 */
function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
  return (
    <BaseCollapsible.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

type CollapsiblePanelProps = Omit<BaseCollapsible.Panel.Props, "className"> & {
  className?: string;
};

/**
 * Height transition uses CSS var set by Base UI.
 * data-starting-style / data-ending-style collapse to h-0 for enter/exit.
 * prefers-reduced-motion: no height animation.
 */
function CollapsiblePanel({ className, ...props }: CollapsiblePanelProps) {
  return (
    <BaseCollapsible.Panel
      data-slot="collapsible-panel"
      className={cn(
        "h-[var(--collapsible-panel-height)] overflow-hidden text-sm text-foreground",
        "transition-[height] duration-150 ease-out",
        "data-starting-style:h-0 data-ending-style:h-0",
        "motion-reduce:transition-none",
        // keepMounted / closed: stay out of layout unless hidden="until-found"
        "[&[hidden]:not([hidden='until-found'])]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** Optional content wrapper — not a Base UI part. Padding lives here, not on Panel. */
function CollapsibleContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="collapsible-content"
      className={cn("px-3 pb-3 pt-2.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
  CollapsibleContent,
  type CollapsibleProps,
  type CollapsibleTriggerProps,
  type CollapsiblePanelProps,
};
