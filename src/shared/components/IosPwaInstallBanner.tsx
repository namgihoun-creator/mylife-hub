"use client";

import { useCallback, useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { isIosSafari } from "@/shared/utils/ios-safari";
import { detectStandalone } from "@/shared/hooks/use-pwa-install";
import { cn } from "@/shared/lib/utils";

const KEY = "mylife:ios-pwa-banner-dismissed";
const DISMISS_EVENT = "mylife:ios-pwa-banner-dismiss";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * iOS/iPadOS Safari in the browser (not the installed app): web push on iPhone only works once the site is on the home screen, so
 * this card explains the share-sheet route ("공유 → 홈 화면에 추가"). Renders nothing anywhere else. [닫기] is remembered in
 * localStorage, and every copy of the banner on the page closes together (bell panel + settings).
 */
export function IosPwaInstallBanner({ className }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const check = () => setShow(isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0) && !detectStandalone() && !readDismissed());
    check();
    window.addEventListener(DISMISS_EVENT, check);
    return () => window.removeEventListener(DISMISS_EVENT, check);
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: the card just closes for this page view */
    }
    setShow(false);
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, []);

  if (!show) return null;
  return (
    <div
      data-testid="ios-pwa-banner"
      role="note"
      className={cn("flex min-w-0 items-start gap-3 rounded-3xl bg-gradient-to-br from-sky-50 to-teal-50 p-3.5 shadow-sm dark:from-sky-950/40 dark:to-teal-950/30", className)}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm dark:bg-zinc-800 dark:text-sky-300">
        <Share className="h-4 w-4" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 break-keep text-xs font-bold leading-relaxed text-slate-700 dark:text-zinc-200">
        아이폰은 하단 공유(□↑) → &apos;홈 화면에 추가&apos;를 눌러 설치해야 아침 9시 알림을 받을 수 있어요
      </p>
      <button
        type="button"
        data-testid="ios-pwa-banner-close"
        onClick={dismiss}
        className="inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-100 active:scale-95 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        <X className="h-3 w-3" aria-hidden /> 닫기
      </button>
    </div>
  );
}
