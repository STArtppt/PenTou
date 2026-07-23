import { Input as BaseInput } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

type InputProps = Omit<BaseInput.Props, "className"> & {
  className?: string;
};

/**
 * Text input on the Base UI Input primitive (auto-integrates with Field).
 * Neutral surface (border-input / bg-background); gray focus ring with an
 * offset gap — never a colored outline (DESIGN: focus = ring-2 ring-ring
 * ring-offset-2 ring-offset-background).
 */
function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input, type InputProps };
