import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // rounded-lg = var(--radius) = 0.625rem = 10px (controls use --radius, not radius-md)
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Elevated pill: fully rounded, filled surface (white in light / gray in
        // dark via --popover — lighter than --card so it lifts off dark app
        // backgrounds), shadow for lift, no border. For prominent standalone CTAs.
        surface:
          "rounded-full bg-popover text-popover-foreground shadow-md hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = Omit<BaseButton.Props, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
  };

/**
 * forwardRef is required for React 18 consumers: Base UI Tooltip/Dialog/etc.
 * attach anchor refs via the render prop. On React 19 `ref` is a normal prop
 * and would flow through `...props`, but React 18 strips it unless forwarded.
 */
const Button = React.forwardRef<HTMLElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <BaseButton
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants, type ButtonProps };
