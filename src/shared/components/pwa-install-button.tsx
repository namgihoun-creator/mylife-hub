"use client";

import { Download, Share } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { usePwaInstall } from "@/shared/hooks/use-pwa-install";
import { cn } from "@/shared/lib/utils";

const BUTTON =
  "group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-zinc-600 transition-colors hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100";

/** "앱 설치하기" label shown under the button on hover / keyboard focus (pure CSS, no tooltip dependency). */
function Tip() {
  return (
    <span
      role="tooltip"
      data-testid="pwa-install-tip"
      className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-900 opacity-0 shadow-lg transition-opacity [@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      앱 설치하기
    </span>
  );
}

/**
 * Header install button. Renders NOTHING in the installed app (standalone), after `appinstalled`, and in browsers that
 * offer no install path. Android / desktop Chrome & Edge → the native install dialog (text is browser-controlled).
 * iOS → no native prompt exists, so a small popover explains the manual "Add to Home Screen" flow.
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const { visible, isIOS, canPrompt, promptInstall } = usePwaInstall();
  if (!visible) return null;

  if (canPrompt) {
    return (
      <button
        type="button"
        data-testid="pwa-install"
        data-mode="native"
        aria-label="앱 설치하기"
        onClick={() => void promptInstall()}
        className={cn(BUTTON, className)}
      >
        <Download className="h-4 w-4" aria-hidden />
        <Tip />
      </button>
    );
  }

  // iOS (no beforeinstallprompt): manual instructions.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="pwa-install" data-mode={isIOS ? "ios" : "manual"} aria-label="앱 설치하기" className={cn(BUTTON, className)}>
          <Download className="h-4 w-4" aria-hidden />
          <Tip />
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid="pwa-install-ios-guide" className="w-72 rounded-xl p-4 shadow-lg">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">홈 화면에 앱 추가하기</p>
        <ol className="mt-2 space-y-2 text-xs font-normal text-zinc-600 dark:text-zinc-400">
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-[11px] font-medium tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">1</span>
            <span>
              Safari 하단의 공유 버튼 <Share className="mx-0.5 inline h-3.5 w-3.5 align-text-bottom text-zinc-900 dark:text-zinc-100" aria-label="공유" /> (⎋)을 누르세요.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-[11px] font-medium tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">2</span>
            <span>
              메뉴에서 <strong className="font-semibold text-zinc-900 dark:text-zinc-100">&lsquo;홈 화면에 추가&rsquo;</strong>를 선택해 주세요.
            </span>
          </li>
        </ol>
      </PopoverContent>
    </Popover>
  );
}
