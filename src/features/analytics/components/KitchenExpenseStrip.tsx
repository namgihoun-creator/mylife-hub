import Link from "next/link";
import { ArrowRight, PiggyBank, Utensils, PawPrint } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatWon } from "@/features/assets/utils/rental";
import type { Cashflow } from "../utils/cashflow";
import { ReportSection } from "./ReportSection";

function Tile({ id, icon: Icon, label, value, sub, tone }: { id: string; icon: LucideIcon; label: string; value: string; sub: string; tone?: "emerald" }) {
  return (
    <div data-testid="kitchen-tile" data-tile={id} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
      <div className="flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p data-testid="kitchen-tile-value" className={tone === "emerald" ? "truncate text-xl font-semibold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-2xl" : "truncate text-xl font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-2xl"}>{value}</p>
      <p className="truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{sub}</p>
    </div>
  );
}

/** This month's food + pet spending, what the kitchen has defended, and the combined (rental + variable) cash-flow summary. */
export function KitchenExpenseStrip({ cash, month }: { cash: Cashflow; month: string }) {
  const label = `${Number(month.slice(5, 7))}월`;
  return (
    <ReportSection testId="kitchen-strip" title="가계 지출 · 키친 머니로그" description={`${label} 식비·양육비와 냉파로 아낀 금액을 렌탈 고정 지출과 함께 봐요.`} action={<Link href="/kitchen" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">키친 <ArrowRight className="h-3 w-3" aria-hidden /></Link>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile id="human" icon={Utensils} label={`${label} 식비`} value={formatWon(cash.humanSpent)} sub="장보기 + 배달·외식" />
          <Tile id="pet" icon={PawPrint} label={`${label} 양육비`} value={formatWon(cash.petSpent)} sub="댕냥이 케어" />
          <Tile id="defended" icon={PiggyBank} label="냉파로 아낀 금액" value={formatWon(cash.defended)} sub="지금까지 누적 · 순 방어 이익" tone={cash.defended > 0 ? "emerald" : undefined} />
        </div>

        <div data-testid="cashflow-summary" className="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">가계 종합 캐시플로우 요약</p>
          <dl className="grid grid-cols-3 gap-3 text-xs">
            <div className="min-w-0">
              <dt className="truncate font-normal text-zinc-500 dark:text-zinc-400">렌탈 고정</dt>
              <dd data-testid="cash-fixed" className="mt-0.5 truncate text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatWon(cash.fixed)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate font-normal text-zinc-500 dark:text-zinc-400">식비·양육비 변동</dt>
              <dd data-testid="cash-variable" className="mt-0.5 truncate text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatWon(cash.variable)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate font-normal text-zinc-500 dark:text-zinc-400">{label} 합계</dt>
              <dd data-testid="cash-total" className="mt-0.5 truncate text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{formatWon(cash.total)}</dd>
            </div>
          </dl>
          <div
            role="img"
            data-testid="cash-bar"
            aria-label={`렌탈 ${cash.share.fixed}%, 식비 ${cash.share.human}%, 양육비 ${cash.share.pet}%`}
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-white shadow-inner dark:bg-zinc-900"
          >
            {cash.fixed > 0 && <div data-seg="fixed" className="bg-violet-500 dark:bg-violet-400" style={{ width: `${(cash.fixed / cash.total) * 100}%` }} />}
            {cash.humanSpent > 0 && <div data-seg="human" className="bg-sky-500 dark:bg-sky-400" style={{ width: `${(cash.humanSpent / cash.total) * 100}%` }} />}
            {cash.petSpent > 0 && <div data-seg="pet" className="bg-cyan-500 dark:bg-cyan-400" style={{ width: `${(cash.petSpent / cash.total) * 100}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-violet-500 dark:bg-violet-400" aria-hidden />렌탈 {cash.share.fixed}%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sky-500 dark:bg-sky-400" aria-hidden />식비 {cash.share.human}%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-cyan-500 dark:bg-cyan-400" aria-hidden />양육비 {cash.share.pet}%</span>
          </div>
          <p data-testid="cash-defended" className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            {cash.defended > 0
              ? `냉파로 지금까지 ${formatWon(cash.defended)}을 지켰어요${cash.defendedPct !== null && cash.variable > 0 ? ` (이번 달 변동 지출 대비 방어액 비율 ${cash.defendedPct}%)` : ""}.`
              : "재료를 기한 안에 다 먹으면 방어액이 쌓여요."}
          </p>
        </div>
      </div>
    </ReportSection>
  );
}
