import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import pkg from "../../../../package.json";

/**
 * App footer (CookSaver heritage). Quiet slate-500 text on the off-white page (slate-400 measured only 2.45:1 — below the 3:1 floor,
 * and the footer carries the pet-safety notice), a soft hairline on top instead of a hard rule,
 * and bottom padding that clears the fixed 4-tab bar on phones (+ the iOS home-indicator safe area).
 */
export function Footer() {
  return (
    <footer
      data-testid="app-footer"
      className="mt-6 border-t border-slate-100 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-8 dark:border-zinc-900 md:pb-8"
    >
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 sm:px-6">
        <div className="space-y-1">
          <p className="text-sm font-bold tracking-tight text-slate-500 dark:text-zinc-400">MyLife Hub × CookSaver</p>
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-500">우리 집 스마트 키친 &amp; 가전 자산 케어 OS</p>
        </div>

        <p data-testid="footer-pet-notice" className="flex max-w-2xl items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
          <span>
            <span aria-hidden>🐾 </span>반려동물 독성 및 레시피 정보는 참고용이며, 응급 상황 시 즉시 24시 동물병원을 방문하세요.
          </span>
        </p>

        <p className="flex max-w-2xl items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>우리 가구의 데이터는 가구 단위로 격리(RLS)되어, 다른 가구는 볼 수 없어요. 개인(PRIVATE) 항목은 본인에게만 보여요.</span>
        </p>

        <nav aria-label="서비스 안내" className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium">
          <Link href="/privacy" data-testid="footer-privacy" className="text-slate-500 transition-colors hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200">
            개인정보 처리방침
          </Link>
          <Link href="/terms" data-testid="footer-terms" className="text-slate-500 transition-colors hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200">
            이용약관
          </Link>
        </nav>

        <p className="text-[11px] font-normal text-slate-500 dark:text-zinc-500">
          © 2026 MyLife Hub. All rights reserved. · v{pkg.version}
        </p>
      </div>
    </footer>
  );
}
