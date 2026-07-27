import type { ReactElement, ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";

type IconTooltipProps = {
  /** Visible tooltip text (and default aria-label when string). */
  label: ReactNode;
  children: ReactElement;
  side?: Side;
  /** Extra classes on the anchor span (e.g. absolute positioning for FABs). */
  className?: string;
  /** Override accessible name when `label` is not a plain string. */
  "aria-label"?: string;
};

/**
 * Product helper: wrap any icon-only control so hover/focus shows @startist/tooltip.
 * Always anchors on a span so:
 * - React 18 + disabled Button (pointer-events-none) still receives hover
 * - native <button> and startist Button both work without caller-side Provider
 *
 * Mount a single <TooltipProvider> near the app root (see App.tsx).
 */
export function IconTooltip({
  label,
  children,
  side = "top",
  className,
  "aria-label": ariaLabel,
}: IconTooltipProps) {
  const accessible =
    ariaLabel ?? (typeof label === "string" ? label : undefined);

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("inline-flex", className)} />}
        aria-label={accessible}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
