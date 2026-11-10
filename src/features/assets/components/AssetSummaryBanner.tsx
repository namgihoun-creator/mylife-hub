import { AlertTriangle, CalendarClock, Package } from "lucide-react";
import { SummaryBanner, SummaryStat } from "@/shared/components/ui/summary-banner";
import type { AssetSummary } from "../utils/asset-summary";

/** Household briefing: total appliances · due this month · imminent (D-7) warnings. */
export function AssetSummaryBanner({ summary }: { summary: AssetSummary }) {
  const imminentTone = summary.overdue > 0 ? "rose" : summary.imminent > 0 ? "amber" : "emerald";

  return (
    <SummaryBanner label="자산 현황 요약">
      <SummaryStat icon={Package} tone="sky" value={summary.totalAssets} label="등록 가전" />
      <SummaryStat icon={CalendarClock} tone="violet" value={summary.dueThisMonth} label="이번 달 도래 과업" />
      <SummaryStat
        icon={AlertTriangle}
        tone={imminentTone}
        value={summary.imminent}
        label="임박 (D-7 이내)"
        danger={summary.overdue > 0}
        hint={summary.overdue > 0 ? `기한 초과 ${summary.overdue}건` : undefined}
      />
    </SummaryBanner>
  );
}
