"use client";

import { BellRing, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { usePushSubscription } from "../hooks/usePushSubscription";

/** "푸시 알림" switch (docs/DESIGN_SYSTEM.md §I): permission + Service Worker + subscription behind one toggle. */
export function PushToggle() {
  const { status, busy, error, enable, disable } = usePushSubscription();
  const on = status === "on";
  const usable = status === "on" || status === "off";

  const hint =
    status === "unsupported"
      ? "이 브라우저는 푸시 알림을 지원하지 않아요."
      : status === "denied"
        ? "브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요."
        : null;

  return (
    <div className="m-2 rounded-2xl bg-slate-50 px-3 py-3 dark:bg-zinc-800/60">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm dark:bg-zinc-800 dark:text-sky-300">
          <BellRing className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="push-toggle-label" className="block text-sm font-medium text-slate-900 dark:text-zinc-50">
            푸시 알림
          </span>
          <span className="block text-[11px] font-normal text-slate-500 dark:text-zinc-400">
            {on ? "이 기기에서 알림을 받는 중이에요" : "앱을 닫아도 알림을 받아요"}
          </span>
        </span>

        {busy || status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="처리 중" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="push-toggle-label"
            disabled={!usable}
            onClick={() => (on ? disable() : enable())}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50",
              on ? "bg-emerald-500" : "bg-slate-200 dark:bg-zinc-700",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 rounded-full bg-white transition-transform",
                on ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        )}
      </div>
      {(error || hint) && (
        <p role="alert" className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
