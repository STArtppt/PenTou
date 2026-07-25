import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast host (shadcn Sonner pattern), themed to Startist tokens. Mount once near
 * the app root; fire toasts anywhere with `import { toast } from "sonner"`.
 *
 * Theme is auto-detected from the `dark` class on <html> (Startist's class-based
 * dark mode) via a MutationObserver — no next-themes / ThemeProvider needed, so
 * the copy-in component works in any Vite/React app out of the box. The normal
 * (neutral) toast surface maps to popover tokens; keeping toasts neutral by
 * default matches the palette rule. Pass `richColors` explicitly if a consumer
 * wants sonner's colored success/error toasts. Defaults to top-center; pass
 * `position` to override.
 */
function useDarkClass(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () =>
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function Toaster(props: ToasterProps) {
  const theme = useDarkClass();

  return (
    <Sonner
      theme={theme}
      position="top-center"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
