import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, nextMonth, prevMonth } from "../utils/month";
import { cn } from "@/shared/lib/utils";

const BTN = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm transition-all hover:bg-sky-50 hover:text-sky-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** [‹ 2026년 11월 ›]: the month the settlement and the utility bills below are about. The future is not selectable. */
export function MonthStepper({ month, currentMonth }: { month: string; currentMonth: string }) {
  const canNext = nextMonth(month) <= currentMonth;
  return (
    <nav aria-label="결산 월 선택" data-testid="month-stepper" className="flex items-center gap-2">
      <Link href={`/analytics?month=${prevMonth(month)}`} scroll={false} aria-label="이전 달" data-testid="month-prev" className={BTN}>
        <ChevronLeft size={18} aria-hidden />
      </Link>
      <p data-testid="month-label" className="min-w-[8.5rem] flex-1 text-center text-base font-extrabold tabular-nums text-slate-900 dark:text-zinc-50 sm:flex-none">
        {monthLabel(month)}
        {month === currentMonth && <span className="ml-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">이번 달</span>}
      </p>
      {canNext ? (
        <Link href={`/analytics?month=${nextMonth(month)}`} scroll={false} aria-label="다음 달" data-testid="month-next" className={BTN}>
          <ChevronRight size={18} aria-hidden />
        </Link>
      ) : (
        <span aria-hidden data-testid="month-next-disabled" className={cn(BTN, "pointer-events-none opacity-40")}>
          <ChevronRight size={18} />
        </span>
      )}
    </nav>
  );
}
