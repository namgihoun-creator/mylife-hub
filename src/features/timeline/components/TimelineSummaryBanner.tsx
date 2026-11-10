import { AlertTriangle, CalendarCheck, CalendarClock } from "lucide-react";
import { SummaryBanner, SummaryStat } from "@/shared/components/ui/summary-banner";

/** Briefing: today's tasks · overdue (pulses when > 0) · due within the next 7 days. */
export function TimelineSummaryBanner({
  todayCount,
  overdueCount,
  weekCount,
}: {
  todayCount: number;
  overdueCount: number;
  weekCount: number;
}) {
  return (
    <SummaryBanner label="오늘의 과업 요약">
      <SummaryStat icon={CalendarCheck} tone={todayCount > 0 ? "amber" : "emerald"} value={todayCount} label="오늘 할 일" />
      <SummaryStat
        icon={AlertTriangle}
        tone={overdueCount > 0 ? "rose" : "emerald"}
        value={overdueCount}
        label="기한 초과"
        danger={overdueCount > 0}
      />
      <SummaryStat icon={CalendarClock} tone="sky" value={weekCount} label="7일 내 예정" />
    </SummaryBanner>
  );
}
