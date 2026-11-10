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
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      {art ??
        (Icon && (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200/70 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700/60">
            <Icon className="h-6 w-6" />
          </div>
        ))}
      <h2 className="text-base font-semibold text-slate-800 dark:text-zinc-200">{title}</h2>
      <p className="max-w-xs text-xs font-normal text-slate-500 dark:text-zinc-400">{description}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
