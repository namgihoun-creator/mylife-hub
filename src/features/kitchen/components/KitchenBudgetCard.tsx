"use client";

import { useState } from "react";
import { PartyPopper, PiggyBank, Plus, Sparkles, TriangleAlert, Wallet } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ProgressRing } from "@/shared/components/ui/progress-ring";
import { formatDotDate, formatWon } from "@/features/assets/utils/rental";
import { usedPercent, type BudgetPart } from "../rules/kitchen-budget";
import type { KitchenBudgetData } from "../server/kitchen-budget.actions";
import { CategoryChip, ExpenseDialog } from "./ExpenseDialog";

// Learning-app style progress bars: chunky, fully rounded, friendly colours (mint → sunny → coral).
const FILL = {
  ok: "bg-emerald-400 dark:bg-emerald-300",
  warn: "bg-amber-400 dark:bg-amber-300",
  danger: "bg-rose-400 dark:bg-rose-300",
} as const;
const PCT_TEXT = {
  ok: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  danger: "text-rose-500 dark:text-rose-300",
} as const;
const RING_TONE = { ok: "ok", warn: "warn", danger: "danger" } as const;

/** Spent / budget progress bar: mint under 80%, sunny from 80%, coral from 100% (the over-budget amount is spelled out). */
function Gauge({ id, label, part }: { id: string; label: string; part: BudgetPart }) {
  const pct = usedPercent(part.spent, part.monthly);
  const over = part.spent - part.monthly;
  return (
    <div data-testid="budget-gauge" data-gauge={id} data-level={part.level} className="space-y-2 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-extrabold text-slate-800 dark:text-zinc-100">{label}</span>
        <span className={cn("text-sm font-extrabold tabular-nums", PCT_TEXT[part.level])} data-testid="gauge-pct">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} 소진율`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${formatWon(part.spent)} / ${part.monthly > 0 ? formatWon(part.monthly) : "예산 미설정"} (${pct}%)`}
        className="h-4 w-full overflow-hidden rounded-full bg-white shadow-inner dark:bg-zinc-900"
      >
        <div data-testid="gauge-fill" className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", FILL[part.level])} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
        <span data-testid="gauge-amounts">{formatWon(part.spent)} / {part.monthly > 0 ? formatWon(part.monthly) : "예산 미설정"}</span>
        {part.monthly > 0 && (over > 0 ? <span data-testid="gauge-note" className="font-bold text-rose-500 dark:text-rose-300">{formatWon(over)} 초과</span> : <span data-testid="gauge-note">{formatWon(-over)} 남음</span>)}
      </p>
    </div>
  );
}

/** Dual money log: today's recommended food spend, human + pet budget bars, defended savings and the latest 3 expenses. */
export function KitchenBudgetCard({ data, onNotice }: { data: KitchenBudgetData; onNotice: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const { summary, recent, savedMoney, rescuedCount } = data;
  const overspent = summary.human.level === "danger"; // food budget used up (100%+), or spending against a 0-won budget
  const humanPct = usedPercent(summary.human.spent, summary.human.monthly);

  return (
    <section aria-label="머니로그" data-testid="budget-card" data-overspent={overspent} className="space-y-5 rounded-3xl bg-white p-5 shadow-sm dark:bg-zinc-900 sm:p-6">
      <div className="flex items-center gap-4">
        <ProgressRing testId="human-ring" percent={humanPct} tone={RING_TONE[summary.human.level]} label="사람 식비 소진율" size={76} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div
            data-testid="today-budget"
            data-state={overspent ? "over" : "ok"}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-base font-extrabold shadow-md",
              overspent ? "bg-rose-100 text-rose-600 shadow-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:shadow-none" : "bg-gradient-to-r from-sky-500 to-teal-400 text-white shadow-sky-200 dark:from-sky-500 dark:to-teal-500 dark:shadow-none",
            )}
          >
            {overspent ? <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden /> : <Wallet className="h-5 w-5 shrink-0" aria-hidden />}
            <span className="truncate">
              {overspent ? "예산 초과 · 오늘 권장 식비 " : "오늘의 권장 식비 "}
              <span data-testid="today-budget-value" className="tabular-nums">{formatWon(summary.todayBudget)}</span>
            </span>
          </div>
          <p data-testid="today-budget-hint" className="text-xs font-medium text-slate-500 dark:text-zinc-400">
            {overspent ? `이번 달 식비 예산을 ${summary.human.left < 0 ? `${formatWon(-summary.human.left)} 넘겼어요.` : "다 썼어요."}` : `남은 식비 ${formatWon(summary.human.left)}을 이번 달 ${summary.daysLeft}일(오늘 포함)로 나눈 금액이에요.`}
          </p>
        </div>
      </div>

      <button
        type="button"
        data-testid="expense-open"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-sky-50 px-4 text-sm font-bold text-sky-700 transition-all hover:bg-sky-100 active:scale-[0.99] dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70 sm:w-auto"
      >
        <Plus className="h-4 w-4" aria-hidden /> 지출 등록 · 전체 보기
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <Gauge id="human" label="사람 식비" part={summary.human} />
        <Gauge id="pet" label="댕냥이 케어비" part={summary.pet} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="saved-badge" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 px-4 py-2 text-sm font-extrabold text-emerald-700 dark:from-emerald-950/60 dark:to-teal-950/60 dark:text-emerald-300">
          <PiggyBank className="h-4 w-4" aria-hidden /> 냉파 누적 방어액 <span className="tabular-nums" data-testid="saved-value">{formatWon(savedMoney)}</span>
        </span>
        {rescuedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-extrabold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <PartyPopper className="h-3.5 w-3.5" aria-hidden /> 구출 {rescuedCount}번
          </span>
        )}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900 dark:text-zinc-50"><Sparkles className="h-4 w-4 text-sky-500" aria-hidden /> 최근 지출</p>
        {recent.length === 0 ? (
          <p data-testid="recent-empty" className="rounded-2xl bg-slate-50 px-3 py-5 text-center text-sm font-medium text-slate-500 dark:bg-zinc-800/60 dark:text-zinc-400">이번 달 지출이 아직 없어요.</p>
        ) : (
          <ul data-testid="recent-list" className="space-y-2">
            {recent.map((e) => (
              <li key={e.id} data-testid="recent-row" className="flex items-center gap-2.5 rounded-2xl bg-slate-50 px-3.5 py-3 dark:bg-zinc-800/60">
                <span className="w-11 shrink-0 text-xs font-bold tabular-nums text-slate-500 dark:text-zinc-400">{formatDotDate(e.expense_date).slice(5)}</span>
                <CategoryChip category={e.category} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-zinc-300">{e.memo ?? ""}</span>
                <span className="shrink-0 text-base font-extrabold tabular-nums text-slate-900 dark:text-zinc-50">{formatWon(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ExpenseDialog open={open} onClose={() => setOpen(false)} data={data} onNotice={onNotice} />
    </section>
  );
}
