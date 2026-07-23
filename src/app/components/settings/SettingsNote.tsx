import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "destructive" | "success" | "warning";

const toneClass: Record<Tone, string> = {
  default:
    "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
  destructive:
    "border-red-200 bg-red-50 text-red-600 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400",
  success:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
};

export function SettingsNote({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3 text-xs leading-relaxed", toneClass[tone], className)}>
      {children}
    </div>
  );
}
