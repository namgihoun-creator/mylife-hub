import { CalendarClock, PiggyBank, Repeat, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatWon } from "@/features/assets/utils/rental";
import type { AnalyticsReport } from "../utils/analytics-calculator";

function Kpi({ id, icon: Icon, label, value, sub, accent }: { id: string; icon: LucideIcon; label: string; value: string; sub: string; accent?: "emerald" }) {
  return (
    <div
      data-testid="kpi-card"
      data-kpi={id}
      className="flex min-w-0 flex-col gap-2 rounded-3xl bg-white p-4 dark:bg-zinc-900 shadow-sm"
    >
      <div className="flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p
        data-testid="kpi-value"
        className={
          accent === "emerald"
            ? "truncate text-xl font-semibold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-2xl"
            : "truncate text-xl font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-2xl"
        }
      >
        {value}
      </p>
      <p className="truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{sub}</p>
    </div>
  );
}

const md = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;

/** Four headline numbers: monthly rental spend · next charge · projected reduction · this quarter's work. */
export function MetricKpiGrid({ report }: { report: AnalyticsReport }) {
  const { billing, nextBilling, savings, quarters } = report;
  const q0 = quarters.quarters[0];

  return (
    <section aria-label="핵심 지표" data-testid="kpi-grid" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Kpi
        id="monthly"
        icon={Repeat}
        label="월 고정 렌탈 지출"
        value={billing.rentalCount === 0 ? "—" : formatWon(billing.monthlyTotal)}
        sub={
          billing.rentalCount === 0
            ? "렌탈·구독 자산 없음"
            : `렌탈 ${billing.rentalCount}개${billing.missingFee > 0 ? ` · 요금 미입력 ${billing.missingFee}개 제외` : ""}`
        }
      />
      <Kpi
        id="next-billing"
        icon={CalendarClock}
        label="다음 결제"
        value={nextBilling ? (nextBilling.daysUntil === 0 ? "오늘" : `D-${nextBilling.daysUntil}`) : "—"}
        sub={nextBilling ? `${md(nextBilling.date)} · ${formatWon(nextBilling.total)}` : "결제일 정보 없음"}
      />
      <Kpi
        id="reduction"
        icon={PiggyBank}
        label="이전 후 월 지출 감소"
        value={savings.totalMonthlyReduction > 0 ? `-${formatWon(savings.totalMonthlyReduction)}` : "—"}
        sub={savings.transfers.length > 0 ? `소유권 이전 예정 ${savings.transfers.length}건` : "예정된 소유권 이전 없음"}
        accent={savings.totalMonthlyReduction > 0 ? "emerald" : undefined}
      />
      <Kpi
        id="quarter"
        icon={Wrench}
        label={`${q0.label} 교체·점검`}
        value={`${q0.total}건`}
        sub={q0.total === 0 ? "예정된 과업 없음" : `소모품 ${q0.consumable} · 기타 점검 ${q0.other}`}
      />
    </section>
  );
}
