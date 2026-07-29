import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Static status / attribution label. Not a button — use for metadata chips
 * (source, capture method, tags). Leading icon slot is optional; layout does
 * not collapse or leave a hole when icon is omitted.
 *
 * Token-only surfaces (secondary / outline / muted). No decorative color.
 * rounded-md (8px) for compact chip density vs control rounded-lg.
 */
const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Filled primary — rare for chips; available for strong status
        default: "border-transparent bg-primary text-primary-foreground",
        // Neutral filled chip (topbar attribution default)
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        // Bordered, transparent fill
        outline: "border-border bg-transparent text-foreground",
        // Soft muted — secondary text on muted surface
        muted: "border-border bg-muted text-muted-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        md: "px-2.5 py-1 text-xs [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "sm",
    },
  },
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Optional leading icon (e.g. lucide node or BrandIcon). */
    icon?: React.ReactNode;
  };

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, icon, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        data-slot="badge"
        className={cn(badgeVariants({ variant, size, className }))}
        {...props}
      >
        {icon ?? null}
        {children != null && children !== false ? (
          <span className="min-w-0 truncate">{children}</span>
        ) : null}
      </span>
    );
  },
);
Badge.displayName = "Badge";

export { Badge, badgeVariants, type BadgeProps };
