import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { X, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Tabs on the Base UI Tabs primitive (no Radix / no asChild).
 *
 * Composition:
 *   Tabs > TabsList (variant) > TabsTrigger…  [+ optional TabsAddButton sibling]
 *        > TabsContent…
 *
 * Variants on TabsList:
 *   - segmented: pill track + selected chip (main page chat/doc switcher)
 *   - vertical:  column list with left rail / icon before label (settings nav)
 *   - line:      horizontal underline (closable provider tabs etc.)
 *
 * Closable: pass `closable` + `onClose` per trigger — the primitive never
 * special-cases index 0. TabsAddButton is not a tab (no role="tab").
 */

type TabsListVariant = "segmented" | "vertical" | "line";

const TabsListVariantContext = React.createContext<TabsListVariant>("line");

function Tabs({
  className,
  orientation,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn(
        "flex gap-2",
        orientation === "vertical" ? "flex-row" : "flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva("", {
  variants: {
    variant: {
      segmented:
        "inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground",
      vertical:
        "flex w-full flex-col gap-0.5 border-r border-border bg-muted/30 p-2",
      // flex + w-full + overflow-x-auto: strip fills parent; surplus tabs scroll
      // (scrollbar hidden — still wheel/trackpad/touch scrollable).
      // Pair with a fixed TabsAddButton sibling in a flex row (see demo / LLM page).
      line: "flex h-9 w-full min-w-0 items-center gap-1 overflow-x-auto border-b border-border text-muted-foreground [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
    },
  },
  defaultVariants: {
    variant: "line",
  },
});

function TabsList({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const resolved = variant ?? "line";
  return (
    <TabsListVariantContext.Provider value={resolved}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={resolved}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsListVariantContext.Provider>
  );
}

const tabsTriggerVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        segmented:
          "h-8 flex-1 rounded-md px-3 text-muted-foreground data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm",
        vertical:
          "h-9 w-full justify-start gap-2.5 rounded-md px-3 text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[active]:bg-accent data-[active]:text-accent-foreground data-[active]:shadow-[inset_2px_0_0_0_var(--color-primary)]",
        // shrink-0 + max-w-40: each tab keeps a cap; long labels truncate; list scrolls
        line: "relative h-9 max-w-40 shrink-0 rounded-none border-b-2 border-transparent px-3 pb-px text-muted-foreground hover:text-foreground data-[active]:border-primary data-[active]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Tab> & {
  closable?: boolean;
  onClose?: (value: string | number) => void;
  icon?: React.ReactNode;
};

function TabsTrigger({
  className,
  closable,
  onClose,
  icon,
  children,
  value,
  ...props
}: TabsTriggerProps) {
  const variant = React.useContext(TabsListVariantContext);

  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      value={value}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    >
      {icon ? <span className="shrink-0 [&_svg]:size-4">{icon}</span> : null}
      {/*
        Label area: min-w-0 + truncate for string labels; consumers may pass
        flex children (e.g. title + badge) — badge should use shrink-0.
      */}
      <span className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
        {typeof children === "string" || typeof children === "number" ? (
          <span className="truncate">{children}</span>
        ) : (
          children
        )}
      </span>
      {closable ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Close tab"
          className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose?.(value as string | number);
          }}
          onPointerDown={(e) => {
            // Prevent Base UI tab activation when pressing the close control.
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <X className="size-3" />
        </span>
      ) : null}
    </TabsPrimitive.Tab>
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

type TabsAddButtonProps = Omit<
  React.ComponentProps<"button">,
  "type" | "children"
> & {
  onAdd?: () => void;
  label?: string;
};

/**
 * Trailing "+" control for closable tab rows. Not a tab — place as a sibling
 * of TabsList (recommended) so it never enters role="tablist".
 *
 * Recommended row (keeps + aligned with the tab strip, content below):
 *   <Tabs>
 *     <div className="flex min-w-0 items-center gap-1">
 *       <TabsList variant="line" className="min-w-0 flex-1" />
 *       <TabsAddButton />
 *     </div>
 *     <TabsContent />
 *   </Tabs>
 */
function TabsAddButton({
  className,
  onAdd,
  label = "Add tab",
  onClick,
  ...props
}: TabsAddButtonProps) {
  return (
    <button
      type="button"
      data-slot="tabs-add-button"
      aria-label={label}
      className={cn(
        // h-9 matches TabsList line/segmented strip so flex items-center rows stay level
        "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onAdd?.();
      }}
      {...props}
    >
      <Plus className="size-4" />
    </button>
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsAddButton,
  tabsListVariants,
  tabsTriggerVariants,
  type TabsTriggerProps,
  type TabsAddButtonProps,
  type TabsListVariant,
};
