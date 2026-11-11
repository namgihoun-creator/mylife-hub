import Link from "next/link";
import pkg from "../../../../package.json";

const LINK = "text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";
const DOT = (
  <span aria-hidden>
    ·
  </span>
);

/**
 * Slim app footer (CookSaver heritage): a tinted band that clearly separates it from the page, one compact row on desktop
 * (brand left, credits/links/copyright right) and two tidy lines on phones. Bottom padding clears the fixed 4-tab bar plus
 * the iOS home-indicator safe area. The pet-safety caption lives under the AI chef; the data-isolation note in 가구 설정.
 */
export function Footer() {
  return (
    <footer
      data-testid="app-footer"
      className="mt-6 border-t border-slate-200 bg-slate-100/80 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900/50 md:pb-6"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span data-testid="footer-brand" className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100">
            MyLife Hub × CookSaver
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">우리 집 스마트 키친 &amp; 가전 자산 케어 OS</span>
        </p>

        <p data-testid="footer-meta" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Created by NamGiHoun</span>
          {DOT}
          <Link href="/privacy" data-testid="footer-privacy" className={LINK}>
            개인정보 처리방침
          </Link>
          {DOT}
          <Link href="/terms" data-testid="footer-terms" className={LINK}>
            이용약관
          </Link>
          {DOT}
          <span>© 2026 MyLife Hub · v{pkg.version}</span>
        </p>
      </div>
    </footer>
  );
}
