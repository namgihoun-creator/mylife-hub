import type { Metadata } from "next";
import { getAssets } from "@/features/assets/server/asset.queries";
import { BillingScheduleStrip } from "@/features/analytics/components/BillingScheduleStrip";
import { ConsumableQuarterlyBar } from "@/features/analytics/components/ConsumableQuarterlyBar";
import { KitchenExpenseStrip } from "@/features/analytics/components/KitchenExpenseStrip";
import { MetricKpiGrid } from "@/features/analytics/components/MetricKpiGrid";
import { SavingsOpportunityCard } from "@/features/analytics/components/SavingsOpportunityCard";
import { SpaceInventoryMatrix } from "@/features/analytics/components/SpaceInventoryMatrix";
import { buildAnalyticsReport } from "@/features/analytics/utils/analytics-calculator";
import { buildHouseholdCashflow } from "@/features/analytics/utils/cashflow";
import { getKitchenBudgetData } from "@/features/kitchen/server/kitchen-budget.actions";
import { MonthStepper } from "@/features/analytics/components/MonthStepper";
import { MonthlySettlementCard } from "@/features/analytics/components/MonthlySettlementCard";
import { UtilityBillsCard } from "@/features/analytics/components/UtilityBillsCard";
import { getBillsForMonth } from "@/features/analytics/server/bills.actions";
import { getSettlement } from "@/features/analytics/server/settlement.queries";
import { pickMonth } from "@/features/analytics/utils/month";
import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { toSeoulDate } from "@/shared/lib/recurrence";

export const metadata: Metadata = { title: "리포트" };

// Auth is enforced by (dashboard)/layout.tsx (no session -> /login); RLS limits getAssets() to what this user may see.
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const today = toSeoulDate(new Date().toISOString());
  const month = pickMonth((await searchParams).month, today.slice(0, 7)); // ?month=YYYY-MM, never the future
  const [assets, kitchen, bills, settlement] = await Promise.all([getAssets(), getKitchenBudgetData(), getBillsForMonth(month), getSettlement(month)]);
  const report = buildAnalyticsReport(assets, today);

  // Kitchen money log (food + pet spending, defended savings) joins the rental cash-flow. A failed kitchen query only hides that block.
  const k = kitchen.ok ? kitchen.data : null;
  const cash = k
    ? buildHouseholdCashflow({ rentalMonthly: report.billing.monthlyTotal, humanSpent: k.summary.human.spent, petSpent: k.summary.pet.spent, savedMoney: k.savedMoney })
    : null;
  const hasKitchen = !!cash && (cash.variable > 0 || cash.defended > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">리포트</h1>
            <ContextHelpButton topic="analytics_report" />
          </div>
          <p className="text-xs font-normal text-zinc-500 dark:text-zinc-400">렌탈 지출, 식비·양육비, 공과금, 월말 살림 결산을 한눈에 확인해요.</p>
        </div>
        <MonthStepper month={month} currentMonth={today.slice(0, 7)} />
      </div>

      {settlement && <MonthlySettlementCard settlement={settlement} />}
      <UtilityBillsCard month={month} bills={bills.ok ? bills.bills : []} notReady={!bills.ok && !!bills.notReady} />

      {assets.length === 0 && !hasKitchen ? (
        <div data-testid="analytics-empty">
          <EmptyState title="아직 분석할 자산이 없어요" description="자산 관리에서 가전을 등록하면 지출과 교체 일정 리포트가 만들어져요." />
        </div>
      ) : (
        <>
          <MetricKpiGrid report={report} />
          {k && cash && <KitchenExpenseStrip cash={cash} month={k.month} />}
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <BillingScheduleStrip schedule={report.billing} />
            <div className="space-y-6">
              <SavingsOpportunityCard forecast={report.savings} hasRentals={report.billing.rentalCount > 0} />
              <ConsumableQuarterlyBar outlook={report.quarters} />
            </div>
          </div>
          <SpaceInventoryMatrix distribution={report.distribution} />
        </>
      )}
    </div>
  );
}
