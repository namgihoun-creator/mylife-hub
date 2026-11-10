import { cn } from "@/shared/lib/utils";

/** "[렌탈] 코웨이" pill (docs/DESIGN_SYSTEM.md §J): filled 렌탈 chip + provider name. */
export function RentalBadge({ provider, className }: { provider: string | null; className?: string }) {
  return (
    <span
      data-testid="rental-badge"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-0.5 pr-2.5 text-[11px] font-semibold text-violet-600 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400",
        className,
      )}
    >
      <span className="rounded-full bg-violet-600 px-1.5 py-px text-[10px] font-bold leading-4 text-white dark:bg-violet-500">렌탈</span>
      <span className="truncate">{provider?.trim() || "렌탈사 미입력"}</span>
    </span>
  );
}
