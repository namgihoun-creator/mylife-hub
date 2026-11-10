export type Urgency = "overdue" | "soon" | "ok" | "none";

export type DDay = { days: number | null; label: string; urgency: Urgency };

/** Whole days from `today` to `dueDate` (both 'YYYY-MM-DD', Asia/Seoul calendar dates). */
export function diffDays(dueDate: string, today: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(dueDate) - toUtc(today)) / 86_400_000);
}

/** D-Day semantics from docs/DESIGN_SYSTEM.md: overdue < 0, soon 0..7, ok >= 8. */
export function getDDay(dueDate: string | null | undefined, today: string): DDay {
  if (!dueDate) return { days: null, label: "예정 없음", urgency: "none" };
  const days = diffDays(dueDate, today);
  if (days < 0) return { days, label: `D+${-days}`, urgency: "overdue" };
  if (days === 0) return { days, label: "D-Day", urgency: "soon" };
  return { days, label: `D-${days}`, urgency: days <= 7 ? "soon" : "ok" };
}

/** Gauge fill color per urgency (complete strings for Tailwind JIT). */
export const URGENCY_BAR_CLASS: Record<Urgency, string> = {
  overdue: "bg-rose-500",
  soon: "bg-amber-500",
  ok: "bg-emerald-500",
  none: "bg-sky-400",
};

/** Badge classes per urgency (complete strings for Tailwind JIT). */
export const URGENCY_BADGE_CLASS: Record<Urgency, string> = {
  overdue:
    "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900",
  soon: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  ok: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
  none: "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-900",
};
