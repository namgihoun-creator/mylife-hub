"use client";

import { useState } from "react";
import { PiggyBank, Plus, TriangleAlert, Wallet } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatDotDate, formatWon } from "@/features/assets/utils/rental";
import { usedPercent, type BudgetPart } from "../rules/kitchen-budget";
import type { KitchenBudgetData } from "../server/kitchen-budget.actions";
import { CategoryChip, ExpenseDialog } from "./ExpenseDialog";

const FILL = {
  ok: "bg-emerald-500 dark:bg-emerald-400",
  warn: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-rose-500 dark:bg-rose-400",
} as const;
const PCT_TEXT = {
  ok: "text-zinc-500 dark:text-zinc-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
} as const;

/** Spent / budget gauge: green under 80%, orange from 80%, red from 100% (over-budget amount spelled out). */
function Gauge({ id, label, part }: { id: string; label: string; part: BudgetPart }) {
  const pct = usedPercent(part.spent, part.monthly);
  const over = part.spent - part.monthly;
  return (
    <div data-testid="budget-gauge" data-gauge={id} data-level={part.level} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className={cn("text-xs font-semibold tabular-nums", PCT_TEXT[part.level])} data-testid="gauge-pct">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} 소진율`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${formatWon(part.spent)} / ${part.monthly > 0 ? formatWon(part.monthly) : "예산 미설정"} (${pct}%)`}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
      >
        <div data-testid="gauge-fill" className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", FILL[part.level])} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
        <span data-testid="gauge-amounts">{formatWon(part.spent)} / {part.monthly > 0 ? formatWon(part.monthly) : "예산 미설정"}</span>
        {part.monthly > 0 && (over > 0 ? <span data-testid="gauge-note" className="font-medium text-rose-600 dark:text-rose-400">{formatWon(over)} 초과</span> : <span data-testid="gauge-note">{formatWon(-over)} 남음</span>)}
      </p>
    </div>
  );
}

/** Dual money log: today's recommended food spend, human + pet budget gauges, defended savings and the latest 3 expenses. */
export function KitchenBudgetCard({ data, onNotice }: { data: KitchenBudgetData; onNotice: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const { summary, recent, savedMoney, rescuedCount } = data;
  const overspent = summary.human.level === "danger"; // food budget used up (100%+), or spending against a 0-won budget

  return (
    <section aria-label="머니로그" data-testid="budget-card" data-overspent={overspent} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          data-testid="today-budget"
          data-state={overspent ? "over" : "ok"}
          className={cn(
            "inline-flex min-w-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
            overspent ? "border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" : "bg-black text-white dark:bg-white dark:text-black",
          )}
        >
          {overspent ? <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> : <Wallet className="h-4 w-4 shrink-0" aria-hidden />}
          <span className="truncate">
            {overspent ? "예산 초과 · 오늘 권장 식비 " : "오늘의 권장 식비 "}
            <span data-testid="today-budget-value" className="tabular-nums">{formatWon(summary.todayBudget)}</span>
          </span>
        </div>
        <button
          type="button"
          data-testid="expense-open"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> 지출 등록 · 전체 보기
        </button>
      </div>
      <p data-testid="today-budget-hint" className="-mt-2 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
        {overspent ? `이번 달 식비 예산을 ${summary.human.left < 0 ? `${formatWon(-summary.human.left)} 넘겼어요.` : "다 썼어요."}` : `남은 식비 ${formatWon(summary.human.left)}을 이번 달 ${summary.daysLeft}일(오늘 포함)로 나눈 금액이에요.`}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Gauge id="human" label="사람 식비" part={summary.human} />
        <Gauge id="pet" label="댕냥이 케어비" part={summary.pet} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <span data-testid="saved-badge" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <PiggyBank className="h-3.5 w-3.5" aria-hidden /> 냉파 누적 방어액 <span className="tabular-nums" data-testid="saved-value">{formatWon(savedMoney)}</span>
        </span>
        {rescuedCount > 0 && <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">구출 {rescuedCount}번</span>}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">최근 지출</p>
        {recent.length === 0 ? (
          <p data-testid="recent-empty" className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">이번 달 지출이 아직 없어요.</p>
        ) : (
          <ul data-testid="recent-list" className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recent.map((e) => (
              <li key={e.id} data-testid="recent-row" className="flex items-center gap-2 py-2">
                <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{formatDotDate(e.expense_date).slice(5)}</span>
                <CategoryChip category={e.category} />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{e.memo ?? ""}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatWon(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ExpenseDialog open={open} onClose={() => setOpen(false)} data={data} onNotice={onNotice} />
    </section>
  );
}
