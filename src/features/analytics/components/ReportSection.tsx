import { cn } from "@/shared/lib/utils";

/** Flat 1px section card used by every report block (docs/DESIGN_SYSTEM.md §K). */
export function ReportSection({
  title,
  description,
  testId,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  testId: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn("min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5", className)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          {description && <p className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One-line neutral note for sections with nothing to show (zero states). */
export function ReportEmpty({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-xs font-normal text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
    >
      {children}
    </p>
  );
}
