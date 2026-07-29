import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Dropdown select on the Base UI Select primitive (render prop — no Radix,
 * no asChild). Trigger shares the Input surface + gray offset focus ring; the
 * popup sits on the overlay layer (z=50) so it renders above a Dialog/Drawer it
 * is opened within (dropdown=30 would be occluded by the modal backdrop); DOM
 * order stacks it over the owning modal. Border for hierarchy + soft shadow.
 *
 * Composition:
 *   Select > SelectTrigger (SelectValue + chevron)
 *          > SelectContent > SelectItem / SelectGroup+SelectGroupLabel / SelectSeparator
 *
 * SelectItem has one variant: pass `description` to get the two-line option
 * (title + supporting line). Omitting `description` (or passing an empty string)
 * falls back to the single-line option with no reserved space and no placeholder
 * text. To mirror the variant in the closed trigger, render SelectValueLines from
 * SelectValue's render function:
 *
 *   <SelectValue>
 *     {(value) => <SelectValueLines title={byId[value].name} description={byId[value].note} />}
 *   </SelectValue>
 *
 * The trigger is min-height (not fixed height), so it grows to two lines and
 * collapses back on its own. The popup is pinned to the anchor width: long
 * titles and descriptions ellipsize instead of widening the popup past the
 * control that opened it.
 */
const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;

function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("min-w-0 flex-1 truncate text-left data-[placeholder]:text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Two-line rendering for the *selected* value, mirroring SelectItem's
 * `description` variant inside the closed trigger. Use it from SelectValue's
 * render function; without a description it collapses to a single line.
 */
function SelectValueLines({
  title,
  description,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  const hasDescription = description !== undefined && description !== null && description !== "";
  return (
    <span
      data-slot="select-value-lines"
      data-variant={hasDescription ? "described" : undefined}
      className={cn("flex min-w-0 flex-col items-start gap-0.5 text-left", className)}
      {...props}
    >
      <span className="w-full truncate">{title}</span>
      {hasDescription ? (
        <span className="w-full truncate text-xs font-normal text-muted-foreground">{description}</span>
      ) : null}
    </span>
  );
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Positioner>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        data-slot="select-positioner"
        side="bottom"
        sideOffset={sideOffset}
        alignItemWithTrigger={false}
        className="z-50"
        {...props}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-72 w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[opacity,transform] duration-150 ease-out data-ending-style:opacity-0 data-ending-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:scale-[0.98]",
            className,
          )}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  description,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Supporting second line. Omit or pass "" for the plain single-line option. */
  description?: React.ReactNode;
}) {
  const hasDescription = description !== undefined && description !== null && description !== "";
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-variant={hasDescription ? "described" : undefined}
      className={cn(
        "relative flex w-full cursor-default rounded-md pr-8 pl-2 text-sm text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        hasDescription ? "flex-col items-start gap-0.5 py-2" : "items-center py-1.5",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        className={cn(
          "absolute right-2 flex size-3.5 items-center justify-center",
          // 双行时对齐首行而非整块居中，否则勾选态在长描述下会飘到中间
          hasDescription && "top-2.5",
        )}
      >
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="w-full truncate">{children}</SelectPrimitive.ItemText>
      {hasDescription ? (
        <span
          data-slot="select-item-description"
          className="w-full truncate text-xs text-muted-foreground"
        >
          {description}
        </span>
      ) : null}
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectValueLines,
  SelectTrigger,
  SelectContent,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
};
