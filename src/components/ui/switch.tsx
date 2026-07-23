import { Switch as BaseSwitch } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

type SwitchProps = Omit<BaseSwitch.Root.Props, "className"> & {
  className?: string;
};

/**
 * Toggle switch. Checked track uses --primary (grayscale), never decorative color.
 * Built on Base UI Switch.
 */
function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-checked:translate-x-4 data-checked:bg-primary-foreground data-unchecked:translate-x-0",
        )}
      />
    </BaseSwitch.Root>
  );
}

export { Switch, type SwitchProps };
