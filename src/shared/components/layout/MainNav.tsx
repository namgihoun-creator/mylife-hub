"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, ChefHat, Package } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const ITEMS = [
  { href: "/assets", label: "자산 관리", icon: Package },
  { href: "/timeline", label: "생활 타임라인", icon: CalendarClock },
  { href: "/kitchen", label: "키친", icon: ChefHat },
  { href: "/analytics", label: "리포트", icon: BarChart3 },
];

/** variant "top": desktop tabs in the header · "bottom": mobile fixed tab bar. */
export function MainNav({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 rounded-t-3xl bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur-md dark:bg-zinc-950/95 md:hidden"
      >
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-bold",
              isActive(href) ? "text-sky-600 dark:text-sky-400" : "text-slate-500 dark:text-zinc-400",
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
            "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-colors",
            isActive(href)
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
