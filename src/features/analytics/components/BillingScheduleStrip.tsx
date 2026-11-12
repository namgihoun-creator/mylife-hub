import { formatWon } from "@/features/assets/utils/rental";
import type { BillingSchedule } from "../utils/analytics-calculator";
import { ReportEmpty, ReportSection } from "./ReportSection";

const AXIS_DESKTOP = new Set([1, 8, 15, 22, 29]);
const AXIS_MOBILE = new Set([1, 15, 29]);

/** Day-of-month cash-out timeline (1..31) + the charge list ordered by billing day. */
export function BillingScheduleStrip({ schedule }: { schedule: BillingSchedule }) {
  const { items, days, maxDayTotal, rentalCount, missingDay, monthlyTotal } = schedule;

  return (
    <ReportSection
      testId="billing-strip"
      title="월 결제 일정"
      description={rentalCount === 0 ? undefined : `매월 ${formatWon(monthlyTotal)}이 빠져나가요.`}
    >
      {rentalCount === 0 ? (
        <ReportEmpty testId="billing-empty">렌탈·구독 자산이 없어요. 렌탈 자산을 등록하면 결제일별 지출이 여기에 표시돼요.</ReportEmpty>
      ) : (
        <div className="space-y-4">
          <div>
            <div
              data-testid="billing-timeline"
              className="grid h-24 items-end gap-px sm:gap-0.5"
              style={{ gridTemplateColumns: "repeat(31, minmax(0, 1fr))" }}
            >
              {days.map((d) => {
                const has = d.items.length > 0;
                const pct = has && maxDayTotal > 0 ? Math.max(14, Math.round((d.total / maxDayTotal) * 100)) : 0;
                return has ? (
                  <div
                    key={d.day}
                    role="img"
                    data-testid="billing-bar"
                    data-day={d.day}
                    aria-label={`${d.day}일 ${d.items.map((i) => i.name).join(", ")} ${formatWon(d.total)}`}
                    title={`${d.day}일 · ${formatWon(d.total)}`}
                    className="rounded-sm bg-violet-500 dark:bg-violet-400"
                    style={{ height: `${pct}%` }}
                  />
                ) : (
                  <div key={d.day} aria-hidden className="h-px bg-zinc-200 dark:bg-zinc-800" />
                );
              })}
            </div>
            <div className="mt-1.5 grid text-[10px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400" style={{ gridTemplateColumns: "repeat(31, minmax(0, 1fr))" }} aria-hidden>
              {days.map((d) => (
                <span
                  key={d.day}
                  className={`${AXIS_MOBILE.has(d.day) ? "" : AXIS_DESKTOP.has(d.day) ? "max-sm:invisible" : "invisible"} -mx-2 text-center`}
                >
                  {d.day}
                </span>
              ))}
            </div>
          </div>

          <ul className="space-y-2" aria-label="결제일 순 목록">
            {items.map((it) => (
              <li key={it.assetId} data-testid="billing-row" className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 dark:bg-zinc-800/60">
                <span className="inline-flex h-8 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-xs font-bold tabular-nums text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                  {it.billingDay ? `${it.billingDay}일` : "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{it.name}</p>
                  <p className="truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    {[it.provider, it.cardNote].filter(Boolean).join(" · ") || "제휴카드 메모 없음"}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{it.fee === null ? "요금 미입력" : formatWon(it.fee)}</p>
              </li>
            ))}
          </ul>
          {missingDay > 0 && <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">결제일을 입력하지 않은 {missingDay}개는 타임라인에 표시되지 않아요.</p>}
        </div>
      )}
    </ReportSection>
  );
}
