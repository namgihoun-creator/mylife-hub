import { Repeat } from "lucide-react";
import { formatWon, type RentalSummary } from "../utils/rental";

/** "우리 집 월 렌탈 지출: N개 품목, 월 XX,XXX원" — rendered by the list only when at least one rental exists (docs §J-4). */
export function RentalSummaryBanner({ summary }: { summary: RentalSummary }) {
  return (
    <section
      aria-label="월 렌탈 지출 요약"
      data-testid="rental-summary"
      className="flex items-center gap-3 rounded-2xl border border-violet-200/70 bg-violet-50/40 px-4 py-3 dark:border-violet-900/50 dark:bg-violet-950/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-500 shadow-sm ring-1 ring-inset ring-violet-100 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-900/50">
        <Repeat className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">우리 집 월 렌탈 지출</p>
        <p className="text-base font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-zinc-50">
          <span data-testid="rental-summary-text">
            {summary.count}개 품목, 월 {formatWon(summary.monthlyTotal)}
          </span>
          {summary.missingFee > 0 && (
            <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-zinc-400">(요금 미입력 {summary.missingFee}개 제외)</span>
          )}
        </p>
      </div>
    </section>
  );
}
