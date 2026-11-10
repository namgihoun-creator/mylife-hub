import { getDDay, URGENCY_BADGE_CLASS } from "@/shared/lib/dday";
import { cn } from "@/shared/lib/utils";

/** Urgency badge: D-3 / D-Day / D+2 / 예정 없음. `today` is a Seoul 'YYYY-MM-DD' string. */
export function DDayBadge({
  dueDate,
  today,
  size = "sm",
  className,
}: {
  dueDate: string | null | undefined;
  today: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const { label, urgency } = getDDay(dueDate, today);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold tabular-nums",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        URGENCY_BADGE_CLASS[urgency],
        className,
      )}
    >
      {label}
    </span>
  );
}
