import type { QuarterOutlook } from "../utils/analytics-calculator";
import { ReportSection } from "./ReportSection";

/** Pure-CSS stacked bars: planned replacement / maintenance occurrences for the next 4 calendar quarters. */
export function ConsumableQuarterlyBar({ outlook }: { outlook: QuarterOutlook }) {
  const { quarters, maxTotal, unscheduledRules } = outlook;
  const empty = maxTotal === 0;

  return (
    <ReportSection testId="quarter-bar" title="분기별 교체·점검 예정" description="가격 정보가 없어 금액 대신 예정 횟수로 보여드려요.">
      <div className="space-y-3">
        <div className="grid grid-cols-4 items-end gap-2 sm:gap-4" style={{ height: "9rem" }}>
          {quarters.map((q) => {
            const pct = maxTotal === 0 ? 0 : (q.total / maxTotal) * 100;
            return (
              <div key={q.label} className="flex h-full min-w-0 flex-col justify-end gap-1.5">
                <span data-testid="quarter-total" className="text-center text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {q.total}
                </span>
                <div
                  role="img"
                  data-testid="quarter-col"
                  data-quarter={q.label}
                  data-total={q.total}
                  aria-label={`${q.label} 소모품 ${q.consumable}건, 기타 점검 ${q.other}건`}
                  className="flex w-full flex-col-reverse overflow-hidden rounded-xl bg-slate-100 dark:bg-zinc-800"
                  style={{ height: `${Math.max(q.total > 0 ? 6 : 2, pct * 0.78)}%` }}
                >
                  {q.consumable > 0 && <div className="bg-violet-500 dark:bg-violet-400" style={{ flexGrow: q.consumable }} />}
                  {q.other > 0 && <div className="bg-sky-300 dark:bg-sky-700" style={{ flexGrow: q.other }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:gap-4">
          {quarters.map((q) => (
            <span key={q.label} className="truncate text-center text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
              {q.label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-violet-500 dark:bg-violet-400" aria-hidden />
            소모품 등록 규칙
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-sky-300 dark:bg-sky-700" aria-hidden />
            그 외 점검
          </span>
          {empty && <span data-testid="quarter-empty">예정된 반복 과업이 없어요.</span>}
          {unscheduledRules > 0 && <span>예정일이 없는 규칙 {unscheduledRules}개는 제외</span>}
        </div>
      </div>
    </ReportSection>
  );
}
