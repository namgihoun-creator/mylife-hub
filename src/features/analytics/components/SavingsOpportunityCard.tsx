import { ArrowRight, Sparkles } from "lucide-react";
import { formatDotDate, formatWon } from "@/features/assets/utils/rental";
import type { SavingsForecast } from "../utils/analytics-calculator";

const dday = (n: number) => (n === 0 ? "D-Day" : `D-${n}`);

/** Intelligence banner: when ownership transfers lower the monthly bill, and which obligations end penalty-free. */
export function SavingsOpportunityCard({ forecast, hasRentals }: { forecast: SavingsForecast; hasRentals: boolean }) {
  const { transfers, obligations, passedTransfers, totalMonthlyReduction, yearlyReduction, currentMonthly, finalMonthly } = forecast;
  const active = transfers.length > 0 || obligations.length > 0;

  return (
    <section
      data-testid="savings-card"
      data-state={active ? "active" : "empty"}
      aria-label="절약 기회"
      className="relative overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:p-5"
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/10" />
      <div className="relative space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">절약 기회</h2>
            {!hasRentals ? (
              <p data-testid="savings-summary" className="text-xs font-normal text-zinc-600 dark:text-zinc-400">렌탈·구독 자산이 없어요.</p>
            ) : transfers.length > 0 ? (
              <p data-testid="savings-summary" className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                소유권 이전이 끝나면 월 렌탈 지출이{" "}
                <strong className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatWon(currentMonthly)} → {formatWon(finalMonthly)}</strong>
                으로 줄어요. (연 {formatWon(yearlyReduction)} 절약 · 월 {formatWon(totalMonthlyReduction)})
              </p>
            ) : (
              <p data-testid="savings-summary" className="text-xs font-normal text-zinc-600 dark:text-zinc-400">예정된 소유권 이전·약정 만료가 없어요.</p>
            )}
          </div>
        </div>

        {transfers.length > 0 && (
          <ol className="space-y-1.5" aria-label="소유권 이전 일정">
            {transfers.map((t) => (
              <li key={t.assetId} data-testid="transfer-row" className="flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-white/70 px-3 py-2 text-xs dark:border-emerald-900/50 dark:bg-black/30">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{dday(t.daysUntil)}</span>
                <span className="min-w-0 flex-1 font-medium text-zinc-900 dark:text-zinc-50">
                  <span className="block truncate">{t.name}</span>
                  <span className="block truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{formatDotDate(t.date)} 소유권 이전</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 tabular-nums text-zinc-600 dark:text-zinc-400">
                  <ArrowRight className="h-3 w-3" aria-hidden />
                  <span data-testid="transfer-after">월 {formatWon(t.monthlyAfter)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {obligations.length > 0 && (
          <ul className="space-y-1.5" aria-label="약정 만료 일정">
            {obligations.map((o) => (
              <li key={o.assetId} data-testid="obligation-row" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-amber-700 dark:text-amber-400">{dday(o.daysUntil)}</span>
                <span className="min-w-0 flex-1 font-medium text-zinc-900 dark:text-zinc-50">
                  <span className="block truncate">{o.name}</span>
                  <span className="block truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">약정 만료 {formatDotDate(o.date)}</span>
                </span>
                <span className="hidden shrink-0 text-zinc-600 dark:text-zinc-400 sm:inline">위약금 없이 환승 가능</span>
              </li>
            ))}
          </ul>
        )}

        {passedTransfers.length > 0 && (
          <p data-testid="passed-transfers" className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            소유권 이전일이 지난 렌탈 {passedTransfers.length}개({passedTransfers.map((p) => p.name).join(", ")})는 자산 정보를 직접 구매로 바꾸면 월 지출에서 빠져요.
          </p>
        )}

        {hasRentals && !active && passedTransfers.length === 0 && (
          <p data-testid="savings-empty" className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
            자산 수정에서 소유권 이전일·약정 만료일을 입력하면 절약 시점을 알려드려요.
          </p>
        )}
      </div>
    </section>
  );
}
