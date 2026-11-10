import { getDDay, type Urgency } from "@/shared/lib/dday";
import type { AssetRule } from "../schemas/asset.schema";

/** Approximate cycle length in days (month = 30, year = 365). */
export function cycleDays(rule: Pick<AssetRule, "recurring_type" | "interval_n"> | null | undefined): number {
  if (!rule) return 30;
  const n = Math.max(1, rule.interval_n);
  switch (rule.recurring_type) {
    case "DAILY":
      return n;
    case "WEEKLY":
      return 7 * n;
    case "YEARLY":
      return 365 * n;
    default:
      return 30 * n;
  }
}

export type Gauge = { pct: number; days: number; urgency: Urgency; caption: string };

/** Remaining-time gauge: pct = remaining days / cycle days (0..100). Overdue renders full rose. */
export function getGauge(dueDate: string, today: string, rule: AssetRule | null | undefined): Gauge {
  const { days, urgency } = getDDay(dueDate, today);
  const d = days ?? 0;
  if (urgency === "overdue") return { pct: 100, days: d, urgency, caption: `${-d}일 초과` };
  const pct = Math.max(0, Math.min(100, Math.round((d / cycleDays(rule)) * 100)));
  return { pct, days: d, urgency, caption: d === 0 ? "오늘까지" : `${d}일 남음 · ${pct}%` };
}
