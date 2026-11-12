"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, ChefHat, Package, Sofa } from "lucide-react";
import { cn } from "@/shared/lib/utils";

// `short` is the label of the 5-column mobile tab bar: every cell is only ~56px wide at 280px (Galaxy Fold), so it must stay 4 characters or fewer.
const ITEMS = [
  { href: "/assets", label: "자산 관리", short: "자산", icon: Package },
  { href: "/timeline", label: "생활 타임라인", short: "타임라인", icon: CalendarClock },
  { href: "/kitchen", label: "키친", short: "키친", icon: ChefHat },
  { href: "/spaces", label: "공간 플래너", short: "공간", icon: Sofa },
  { href: "/analytics", label: "리포트", short: "리포트", icon: BarChart3 },
];

/** variant "top": desktop tabs in the header · "bottom": mobile fixed tab bar. */
export function MainNav({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 rounded-t-3xl bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur-md dark:bg-zinc-950/95 md:hidden"
      >
        {ITEMS.map(({ href, label, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-2 text-[11px] font-bold leading-none",
              isActive(href) ? "text-sky-600 dark:text-sky-400" : "text-slate-500 dark:text-zinc-400",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap">{short}</span>
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
      {ITEMS.map(({ href, label, short, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-label={label}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-colors lg:px-4",
            isActive(href)
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {/* md (768-1023px) is too narrow for five full labels next to the header icons: show the short label there */}
          <span className="lg:hidden">{short}</span>
          <span className="hidden lg:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
