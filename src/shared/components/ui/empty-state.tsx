import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Design-system empty state: soft round icon (or custom `art`) + title + guidance + primary CTA.
 * Pass `art` (e.g. <CelebrationArt />) to replace the icon circle.
 */
export function EmptyState({
  icon: Icon,
  art,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  art?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-3xl bg-white p-10 text-center shadow-sm dark:bg-zinc-900",
        className,
      )}
    >
      {art ??
        (Icon && (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-500 dark:bg-sky-950/40 dark:text-sky-300">
            <Icon className="h-6 w-6" />
          </div>
        ))}
      <h2 className="text-base font-semibold text-slate-800 dark:text-zinc-200">{title}</h2>
      <p className="max-w-xs text-xs font-normal text-slate-500 dark:text-zinc-400">{description}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
