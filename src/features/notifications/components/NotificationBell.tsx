"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  Loader2,
  Refrigerator,
  Repeat,
  ShoppingBasket,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { formatRelativeTime } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { useNotificationPolling } from "../hooks/useNotificationPolling";
import type { AppNotification, NotificationType } from "../schemas/notification.schema";
import { completeFromNotification, getRecentNotifications, markAllAsRead, markAsRead } from "../server/notification.actions";
import { addShoppingItem } from "@/features/kitchen/server/shopping.actions";
import { IosPwaInstallBanner } from "@/shared/components/IosPwaInstallBanner";
import { notificationHref } from "../utils/notification-links";
import { PushToggle } from "./PushToggle";

// Complete class strings (Tailwind JIT) — tones per docs/DESIGN_SYSTEM.md §I.
const VISUAL: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  MAGIC_COMPLETED: {
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  INVITE_ACCEPTED: {
    icon: UserPlus,
    tone: "bg-sky-50 text-sky-500 dark:bg-sky-950/40 dark:text-sky-400",
  },
  RENTAL_EXPIRING: {
    icon: Repeat,
    tone: "bg-violet-50 text-violet-500 dark:bg-violet-950/40 dark:text-violet-400",
  },
  KITCHEN_EXPIRING: {
    icon: Refrigerator,
    tone: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300",
  },
  DUE_SOON: {
    icon: CalendarClock,
    tone: "bg-amber-50 text-amber-500 dark:bg-amber-950/40 dark:text-amber-400",
  },
  DUE_TODAY: {
    icon: CalendarCheck,
    tone: "bg-amber-50 text-amber-500 dark:bg-amber-950/40 dark:text-amber-400",
  },
  OVERDUE: {
    icon: AlertTriangle,
    tone: "bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400",
  },
};

type Toast = { name: string; qty: string; state: "ask" | "adding" | "done" | "dup" | "error"; text?: string };

/** Which one-tap action a notification offers (needs its target id: a deleted target leaves none). */
function quickKind(n: AppNotification): "task" | "kitchen" | null {
  if ((n.type === "DUE_SOON" || n.type === "DUE_TODAY" || n.type === "OVERDUE") && (n.task_id || n.asset_id)) return "task";
  if (n.type === "KITCHEN_EXPIRING" && n.kitchen_item_id) return "kitchen";
  return null;
}

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const { count, setCount, refresh } = useNotificationPolling(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [mounted, setMounted] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setMounted(true);
    return () => clearTimeout(toastTimer.current);
  }, []);
  const showToast = (t: Toast, autoHideMs = 9000) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    if (autoHideMs > 0) toastTimer.current = setTimeout(() => setToast(null), autoHideMs);
  };

  async function onQuick(n: AppNotification) {
    if (busyId) return;
    setBusyId(n.id);
    const res = await completeFromNotification(n.id);
    setBusyId(null);
    if (!res.ok) {
      setRowMsg((m) => ({ ...m, [n.id]: { text: res.error, ok: false } }));
      return;
    }
    // The server already marked it read: reflect that at once, then refresh the pages behind the panel.
    setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x)) ?? prev);
    if (!n.read_at) setCount((c) => Math.max(0, c - 1));
    setRowMsg((m) => ({ ...m, [n.id]: { text: res.message, ok: true } }));
    router.refresh();
    if (res.kind === "kitchen" && !res.alreadyGone && res.itemName) {
      setOpen(false);
      showToast({ name: res.itemName, qty: res.itemAmount ?? "1개", state: "ask" });
    }
  }

  async function addToShopping(t: Toast) {
    showToast({ ...t, state: "adding" }, 0);
    const r = await addShoppingItem({ name: t.name, quantity: t.qty, sourceType: "KITCHEN_CONSUMED" });
    if (!r.ok) return showToast({ ...t, state: "error", text: r.error }, 6000);
    router.refresh();
    showToast({ ...t, state: r.duplicate ? "dup" : "done" }, 6000);
  }

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
    router.push(notificationHref(n.type, n.asset_id, n.kitchen_item_id));
  }

  async function onMarkAll() {
    setItems((prev) => prev?.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })) ?? prev);
    setCount(0);
    const r = await markAllAsRead();
    if (!r.ok) void refresh();
  }

  return (
    <>
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
        <IosPwaInstallBanner className="mx-2 mt-2" />
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          <h2 className="text-base font-extrabold text-slate-900 dark:text-zinc-50">알림</h2>
          <button
            type="button"
            onClick={onMarkAll}
            disabled={count === 0}
            className="min-h-8 rounded-full bg-sky-50 px-3 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70"
          >
            모두 읽음
          </button>
        </div>

        {items === null ? (
          <div className="space-y-2 p-4" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none dark:bg-zinc-800" />
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
          <ul className="max-h-96 space-y-1 overflow-y-auto px-2 pb-1">
            {items.map((n) => {
              const { icon: Icon, tone } = VISUAL[n.type];
              const unread = !n.read_at;
              const kind = quickKind(n);
              const msg = rowMsg[n.id];
              return (
                <li key={n.id} data-testid="notification-row" data-type={n.type}>
                  <div className={cn("rounded-2xl transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800/60", unread && "bg-sky-50 dark:bg-sky-950/30")}>
                    <button
                      type="button"
                      onClick={() => onItemClick(n)}
                      data-unread={unread}
                      className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left"
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl", tone)}>
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
                    {(kind || msg) && (
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pl-[3.75rem]">
                        {msg ? (
                          <p data-testid="notification-result" data-ok={msg.ok} role="status" className={cn("min-w-0 break-keep text-xs font-bold", msg.ok ? "text-teal-700 dark:text-teal-300" : "text-rose-600 dark:text-rose-300")}>
                            {msg.text}
                          </p>
                        ) : (
                          <button
                            type="button"
                            data-testid={kind === "task" ? "notification-complete" : "notification-consume"}
                            disabled={busyId !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onQuick(n);
                            }}
                            className={cn(
                              "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-60 motion-reduce:transform-none",
                              kind === "task"
                                ? "bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-950/70"
                                : "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70",
                            )}
                          >
                            {busyId === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}
                            {kind === "task" ? "교체·점검 완료" : "소진 완료"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <PushToggle />
      </PopoverContent>
    </Popover>
    {mounted && toast &&
      createPortal(
        <div data-testid="bell-toast" role="status" className="fixed inset-x-4 bottom-20 z-[90] mx-auto flex max-w-sm items-center gap-3 rounded-3xl bg-white p-3 pl-4 shadow-xl dark:bg-zinc-900 sm:bottom-6">
          <ShoppingBasket className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" aria-hidden />
          <p className="min-w-0 flex-1 break-keep text-xs font-bold text-slate-800 dark:text-zinc-100">
            {toast.state === "ask" && "장보기 리스트에 바로 담을까요?"}
            {toast.state === "adding" && "담는 중…"}
            {toast.state === "done" && `${toast.name}을(를) 장보기 리스트에 담았어요.`}
            {toast.state === "dup" && `${toast.name}은(는) 이미 장보기 리스트에 있어요.`}
            {toast.state === "error" && (toast.text ?? "담지 못했어요.")}
            {toast.state === "ask" && <span className="block font-medium text-slate-500 dark:text-zinc-400">{toast.name} {toast.qty}</span>}
          </p>
          {toast.state === "ask" && (
            <button type="button" data-testid="bell-toast-add" onClick={() => void addToShopping(toast)} className="inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-teal-600 px-3.5 text-xs font-bold text-white shadow-sm active:scale-95 dark:bg-teal-500">
              담기
            </button>
          )}
          {toast.state === "done" && (
            <Link href="/kitchen?tab=shopping" data-testid="bell-toast-view" onClick={() => setToast(null)} className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-teal-50 px-3.5 text-xs font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
              보러 가기
            </Link>
          )}
          {toast.state === "adding" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />
          ) : (
            <button type="button" aria-label="닫기" onClick={() => setToast(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800">
              ×
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
