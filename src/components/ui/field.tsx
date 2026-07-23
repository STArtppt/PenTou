import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Form field layout: a label above its control, with an optional description
 * below. Token-only styling (foreground / muted-foreground). Drop-in for the
 * common `<Field label=…>{control}</Field>` shape; `label` and `htmlFor` are
 * optional so it also works as a bare labelled group.
 */

type FieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
};

function Field({ label, description, children, className, htmlFor }: FieldProps) {
  return (
    <div data-slot="field" className={cn("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium leading-none text-foreground"
        >
          {label}
        </label>
      ) : null}
      {children}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export { Field, type FieldProps };
