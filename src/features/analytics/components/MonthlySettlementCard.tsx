import { HeartHandshake, PiggyBank, Trash2 } from "lucide-react";
import { formatWon } from "@/features/assets/utils/rental";
import { cn } from "@/shared/lib/utils";
import { foodHeadline, teamMessage, type Settlement } from "../utils/settlement";
import { monthLabel } from "../utils/month";
import { ReportSection } from "./ReportSection";

const BLOCK = "flex min-w-0 flex-col gap-2 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60";
const LABEL = "flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-zinc-400";

/** 월말 부부 살림 결산: food-budget defence, estimated expiry losses and the couple's teamwork for the chosen month. */
export function MonthlySettlementCard({ settlement: s }: { settlement: Settlement }) {
  const { food, waste, team } = s;
  const bar = Math.min(100, food.usedPct);
  const barTone = food.status === "OVER" ? "bg-rose-500 dark:bg-rose-400" : food.usedPct >= 80 ? "bg-amber-500 dark:bg-amber-400" : "bg-sky-500 dark:bg-sky-400";
  return (
    <ReportSection testId="settlement-card" title="월말 부부 살림 결산" description={`${monthLabel(s.month)} 한 달 동안 둘이 함께 해낸 일${s.isCurrentMonth ? " (이번 달은 진행 중이에요)" : ""}`}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div data-testid="settle-food" data-status={food.status} className={BLOCK}>
          <p className={LABEL}><PiggyBank className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden /> 식비 예산 방어율</p>
          <p data-testid="settle-food-headline" className={cn("break-keep text-lg font-extrabold tracking-tight", food.status === "OVER" ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-zinc-50")}>{foodHeadline(food)}</p>
          {food.status !== "NO_BUDGET" && (
            <>
              <div role="img" aria-label={`예산의 ${food.usedPct}% 사용`} className="h-2.5 w-full overflow-hidden rounded-full bg-white shadow-inner dark:bg-zinc-900">
                <div data-testid="settle-food-bar" className={cn("h-full rounded-full", barTone)} style={{ width: `${bar}%` }} />
              </div>
              <p data-testid="settle-food-detail" className="text-xs font-medium tabular-nums text-slate-600 dark:text-zinc-300">
                예산 {formatWon(food.budget)} 중 <strong>{formatWon(food.spent)}</strong> 사용 ({food.usedPct}%)
              </p>
              <p data-testid="settle-food-defense" className="text-[11px] font-bold text-sky-700 dark:text-sky-300">방어율 {food.defendedPct}% · 장보기 {formatWon(food.groceries)} + 배달·외식 {formatWon(food.delivery)}</p>
            </>
          )}
        </div>

        <div data-testid="settle-waste" className={BLOCK}>
          <p className={LABEL}><Trash2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden /> 기한 만료·폐기 손실 추산</p>
          <p data-testid="settle-waste-headline" className="break-keep text-lg font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-zinc-50">
            {waste.count === 0 ? "버린 재료가 없어요" : `${waste.count}건 · 약 ${formatWon(waste.estimatedWon)}`}
          </p>
          <p data-testid="settle-waste-detail" className="text-xs font-medium text-slate-600 dark:text-zinc-300">
            {waste.logReady ? `폐기 기록 ${waste.discardedCount}건` : "폐기 기록은 준비 중"} · 보관함에 남은 만료 재료 {waste.stockCount}건
          </p>
          <p className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">재료 가격은 따로 저장하지 않아 건당 {formatWon(waste.perItemWon)}으로 추정해요.</p>
        </div>

        <div data-testid="settle-team" className={BLOCK}>
          <p className={LABEL}><HeartHandshake className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden /> 부부 공동 살림 달성도</p>
          <p data-testid="settle-team-headline" className="text-lg font-extrabold tracking-tight tabular-nums text-teal-700 dark:text-teal-300">{team.total}건 달성</p>
          <ul className="flex flex-wrap gap-1.5 text-[11px] font-bold">
            <li data-testid="settle-team-tasks" className="rounded-full bg-white px-2.5 py-1 text-slate-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">가전 점검·청소 {team.tasks}</li>
            <li data-testid="settle-team-consumed" className="rounded-full bg-white px-2.5 py-1 text-slate-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">소진 완료 {team.consumed}</li>
            <li data-testid="settle-team-shopped" className="rounded-full bg-white px-2.5 py-1 text-slate-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">장보기 {team.shopped}</li>
          </ul>
          <p data-testid="settle-team-message" className="text-xs font-bold text-teal-700 dark:text-teal-300">{teamMessage(team)}</p>
          {!team.logReady && <p className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">소진·장보기 기록은 준비 중이라 가전 점검만 셌어요.</p>}
        </div>
      </div>
    </ReportSection>
  );
}
