import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const ICON_TONE = {
  sky: "bg-sky-50 text-sky-500 ring-sky-100 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-900/50",
  violet: "bg-violet-50 text-violet-500 ring-violet-100 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-900/50",
  amber: "bg-amber-50 text-amber-500 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50",
  rose: "bg-rose-100 text-rose-600 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:ring-rose-900/60",
  emerald: "bg-emerald-50 text-emerald-500 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900/50",
} as const;

export type SummaryTone = keyof typeof ICON_TONE;

/** Row of flat metric tiles (docs/DESIGN_SYSTEM.md v3 metric cards). */
export function SummaryBanner({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-3 gap-3 sm:gap-4"
    >
      {children}
    </section>
  );
}

/** One metric tile. `danger` = rose tint + pulsing alert dot (e.g. overdue tasks exist). */
export function SummaryStat({
  icon: Icon,
  tone,
  value,
  label,
  hint,
  danger = false,
}: {
  icon: LucideIcon;
  tone: SummaryTone;
  value: number;
  label: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-3xl p-3 shadow-sm sm:flex-row sm:items-center sm:gap-3 sm:p-4",
        danger
          ? "bg-rose-50 dark:bg-rose-950/30"
          : "bg-white dark:bg-zinc-900",
      )}
    >
      {danger && (
        <span className="absolute right-2.5 top-2.5 flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
      )}
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl", ICON_TONE[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl",
            danger ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-zinc-50",
          )}
        >
          {value}
        </p>
        <p className="text-xs font-normal leading-tight text-slate-500 dark:text-zinc-400 sm:truncate">{label}</p>
        {hint && <p className="text-[11px] font-medium leading-tight text-rose-600 dark:text-rose-400 sm:truncate">{hint}</p>}
      </div>
    </div>
  );
}
