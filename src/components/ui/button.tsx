import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Brand accent (orange light / yellow dark) is defined ONLY here.
 * Call sites use variant="brand" — never scatter brand color classNames.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        brand:
          "bg-orange-500 text-white hover:bg-orange-600 dark:bg-yellow-400 dark:text-zinc-900 dark:hover:bg-yellow-500",
        destructive:
          "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-400/40 dark:text-red-400 dark:hover:bg-red-400/10",
        outline:
          "border border-zinc-300 bg-transparent text-zinc-700 hover:border-zinc-400 dark:border-white/20 dark:text-zinc-300 dark:hover:border-white/40",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100",
        link: "text-primary underline-offset-4 hover:underline",
        /** Segment / choice chip: inactive */
        segment:
          "border border-zinc-200 bg-transparent text-zinc-600 hover:border-zinc-400 dark:border-white/10 dark:text-zinc-400 dark:hover:border-white/30",
        /** Segment / choice chip: active — brand colors only here */
        "segment-active":
          "border border-orange-500 bg-orange-50 text-orange-500 dark:border-yellow-400 dark:bg-yellow-400/10 dark:text-yellow-400",
        /** Nav item active — brand colors only here */
        "nav-active":
          "bg-orange-50 text-orange-600 hover:bg-orange-50 dark:bg-yellow-400/10 dark:text-yellow-400 dark:hover:bg-yellow-400/10",
      },
      size: {
        default: "h-9 px-4 py-1.5",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-lg px-6",
        icon: "h-9 w-9",
        /** Settings left-nav row */
        nav: "h-9 w-full justify-start gap-2.5 rounded-md px-3 text-sm font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
