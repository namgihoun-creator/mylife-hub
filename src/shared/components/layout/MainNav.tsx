"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Package } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const ITEMS = [
  { href: "/assets", label: "자산 관리", icon: Package },
  { href: "/timeline", label: "생활 타임라인", icon: CalendarClock },
];

/** variant "top": desktop tabs in the header · "bottom": mobile fixed tab bar. */
export function MainNav({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t border-slate-200/80 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-zinc-800/80 dark:bg-black/80 md:hidden"
      >
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
              isActive(href) ? "text-slate-900 dark:text-zinc-50" : "text-slate-500 dark:text-zinc-400",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav
      aria-label="주요 메뉴"
      className="hidden items-center gap-1 md:flex"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            isActive(href)
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
              : "text-zinc-500 hover:bg-zinc-100/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-50",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
