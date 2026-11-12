"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/shared/lib/utils";

/** Sun/Moon crossfade. Icon state is pure CSS (`dark:`), so SSR and hydration never disagree. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label="테마 전환 (라이트/다크)"
      title="테마 전환"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
        className,
      )}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 opacity-100 transition-all duration-300 motion-reduce:transition-none dark:-rotate-90 dark:scale-0 dark:opacity-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 opacity-0 transition-all duration-300 motion-reduce:transition-none dark:rotate-0 dark:scale-100 dark:opacity-100" />
    </button>
  );
}
