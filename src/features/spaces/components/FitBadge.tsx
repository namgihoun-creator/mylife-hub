import { AlertTriangle, CheckCircle2, HelpCircle, Ruler } from "lucide-react";
import type { FitResult, FitStatus } from "@/shared/utils/space-planner";
import { cn } from "@/shared/lib/utils";

type Fit = Pick<FitResult, "status" | "slackCm">;

const STYLE: Record<FitStatus, string> = {
  FIT: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  TIGHT: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  OVERFLOW: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  UNKNOWN: "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const cm = (n: number) => `${Math.round(Math.abs(n) * 10) / 10}cm`;

/** Placement verdict pill: FIT mint "여유 Ncm" · TIGHT amber "딱 맞음" · OVERFLOW rose "치수 초과" · UNKNOWN slate. Always text + icon, never colour alone. */
export function FitBadge({ fit, className }: { fit: Fit; className?: string }) {
  const Icon = fit.status === "FIT" ? CheckCircle2 : fit.status === "TIGHT" ? Ruler : fit.status === "OVERFLOW" ? AlertTriangle : HelpCircle;
  const text =
    fit.status === "FIT" ? `여유 ${cm(fit.slackCm ?? 0)}` : fit.status === "TIGHT" ? "딱 맞음" : fit.status === "OVERFLOW" ? "치수 초과" : "치수 미확인";
  const detail = fit.status === "OVERFLOW" && fit.slackCm !== null ? ` ${cm(fit.slackCm)}` : fit.status === "TIGHT" && fit.slackCm !== null ? ` (${cm(fit.slackCm)})` : "";
  return (
    <span
      data-testid="fit-badge"
      data-fit={fit.status}
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold", STYLE[fit.status], className)}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {text}
      {detail}
    </span>
  );
}
