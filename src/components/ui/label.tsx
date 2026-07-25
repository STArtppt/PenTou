import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Form label. Native <label>, token-only (foreground). Matches the label
 * styling baked into Field; use standalone for a bare labelled control outside
 * the Field layout. peer-disabled dims it in step with its disabled control.
 */
function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
