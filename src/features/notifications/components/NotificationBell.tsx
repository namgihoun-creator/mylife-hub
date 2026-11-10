"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { formatRelativeTime } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { useNotificationPolling } from "../hooks/useNotificationPolling";
import type { AppNotification, NotificationType } from "../schemas/notification.schema";
import { getRecentNotifications, markAllAsRead, markAsRead } from "../server/notification.actions";

// Complete class strings (Tailwind JIT) — tones per docs/DESIGN_SYSTEM.md §I.
const VISUAL: Record<NotificationType, { icon: LucideIcon; tone: string; href: string }> = {
  MAGIC_COMPLETED: {
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-500 ring-1 ring-inset ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900/50",
    href: "/timeline",
  },
  INVITE_ACCEPTED: {
    icon: UserPlus,
    tone: "bg-sky-50 text-sky-500 ring-1 ring-inset ring-sky-100 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-900/50",
    href: "/assets",
  },
  DUE_SOON: {
    icon: CalendarClock,
    tone: "bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50",
    href: "/timeline",
  },
  DUE_TODAY: {
    icon: CalendarCheck,
    tone: "bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50",
    href: "/timeline",
  },
  OVERDUE: {
    icon: AlertTriangle,
    tone: "bg-rose-50 text-rose-500 ring-1 ring-inset ring-rose-100 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-900/50",
    href: "/timeline",
  },
};

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const { count, setCount, refresh } = useNotificationPolling(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);

  const loadList = useCallback(async () => {
    try {
      setItems(await getRecentNotifications(20));
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);

  // Load when the popover opens, and again if the polled count changes while it is open.
  useEffect(() => {
    if (open) void loadList();
  }, [open, count, loadList]);

  async function onItemClick(n: AppNotification) {
    setOpen(false);
    if (!n.read_at) {
      // Optimistic: dim the item and drop the badge now; reconcile with the server afterwards.
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? prev);
      setCount((c) => Math.max(0, c - 1));
      void markAsRead(n.id).then((r) => {
        if (!r.ok) void refresh();
      });
    }
    router.push(VISUAL[n.type].href);
  }

  async function onMarkAll() {
    setItems((prev) => prev?.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })) ?? prev);
    setCount(0);
    const r = await markAllAsRead();
    if (!r.ok) void refresh();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `알림 ${count}건` : "알림"}
          title="알림"
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center" data-testid="notification-badge">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400/60 motion-reduce:animate-none" aria-hidden />
              <span className="relative inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                {count > 9 ? "9+" : count}
              </span>
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent aria-label="알림 목록">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-50">알림</h2>
          <button
            type="button"
            onClick={onMarkAll}
            disabled={count === 0}
            className="text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            모두 읽음
          </button>
        </div>

        {items === null ? (
          <div className="space-y-2 p-4" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-zinc-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
              <Bell className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-zinc-300">새로운 알림이 없습니다</p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-zinc-800">
            {items.map((n) => {
              const { icon: Icon, tone } = VISUAL[n.type];
              const unread = !n.read_at;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    data-unread={unread}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800/60",
                      unread && "bg-sky-50/50 dark:bg-sky-950/20",
                    )}
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-slate-900 dark:text-zinc-50", unread ? "font-semibold" : "font-medium")}>
                        {n.title}
                      </span>
                      <span className="line-clamp-2 block break-keep text-xs font-normal text-slate-500 dark:text-zinc-400">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-slate-400 dark:text-zinc-500">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </span>
                    {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="안 읽음" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
