"use client";

import { CalendarPlus, Check, Link2, MoreHorizontal, SkipForward } from "lucide-react";
import { DDayBadge } from "@/shared/components/ui/dday-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";
import { formatRecurrence, toSeoulDate } from "@/shared/lib/recurrence";
import { cn } from "@/shared/lib/utils";
import { ConsumableStrip, PurchaseButtons } from "@/features/tasks/components/ConsumableActions";
import type { TimelineTask } from "../schemas/timeline.schema";

const TAG =
  "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-300";

export type TaskEmphasis = "overdue" | "today" | "upcoming" | "none";

// Card chrome per section (complete strings for Tailwind JIT) — docs/DESIGN_SYSTEM.md "타임라인 섹션 성격".
const EMPHASIS_CLASS: Record<TaskEmphasis, string> = {
  overdue: "border-rose-200/80 dark:border-rose-900/60",
  today: "border-amber-200/80 border-l-4 border-l-amber-400 dark:border-amber-900/60 dark:border-l-amber-500",
  upcoming: "border-zinc-200 dark:border-zinc-800",
  none: "border-zinc-200 dark:border-zinc-800",
};

export type TaskCardProps = {
  task: TimelineTask;
  today: string;
  emphasis?: TaskEmphasis;
  /** "done" = read-only history row (recent completions). */
  variant?: "open" | "done";
  busy?: boolean;
  onComplete?: (task: TimelineTask) => void;
  onSnooze?: (task: TimelineTask, days: number) => void;
  onSkip?: (task: TimelineTask) => void;
  /** Creates a one-time family link and copies it to the clipboard. */
  onShare?: (task: TimelineTask) => void;
};

const shortDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

/** Item card (docs/DESIGN_SYSTEM.md §4.C, C-1, C-2, C-5): icon box · title/tags/cycle · D-Day + check · footer menu. */
export function TaskCard({
  task,
  today,
  emphasis = "none",
  variant = "open",
  busy,
  onComplete,
  onSnooze,
  onSkip,
  onShare,
}: TaskCardProps) {
  const { icon: Icon, tone } = getApplianceVisual(task.asset?.preset_key);
  const isHistory = variant === "done";
  const optimisticDone = task.pending === "done";
  const optimisticSkipped = task.pending === "skipped";
  const settled = optimisticDone || optimisticSkipped;
  const consumable = { consumable_name: task.consumable_name, consumable_model: task.consumable_model, custom_purchase_url: task.custom_purchase_url, assetModelName: task.asset?.model_name };
  const cycle = task.rule ? formatRecurrence(task.rule.recurring_type, task.rule.interval_n) : "1회성";

  return (
    <li
      className={cn(
        "rounded-xl border bg-white p-4 transition-all duration-200 dark:bg-zinc-950",
        EMPHASIS_CLASS[emphasis],
        !settled && !isHistory && " motion-reduce:transform-none",
        (settled || isHistory) && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <h3
            className={cn(
              "line-clamp-2 break-keep text-sm font-semibold leading-snug text-slate-900 transition-all dark:text-zinc-50",
              (optimisticDone || isHistory) && "line-through decoration-slate-400",
            )}
          >
            {task.title}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {task.asset && <span className={TAG}>{task.asset.name}</span>}
            {task.asset?.space && <span className={TAG}>{task.asset.space}</span>}
          </div>
          <p className="truncate text-xs font-normal text-slate-500 dark:text-zinc-400">
            {optimisticSkipped ? "이번 회차를 건너뛰었어요" : `${cycle}${task.status === "SNOOZED" ? " · 연기됨" : ""}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {isHistory ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              {task.completed_at ? `${shortDate(toSeoulDate(task.completed_at))} 완료` : "완료"}
            </span>
          ) : (
            <>
              <DDayBadge dueDate={task.due_date} today={today} size={emphasis === "upcoming" ? "lg" : "sm"} />
              <button
                type="button"
                aria-label={`${task.title} 완료`}
                aria-pressed={optimisticDone}
                disabled={busy || settled}
                onClick={() => onComplete?.(task)}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 active:scale-95 disabled:cursor-not-allowed",
                  optimisticDone
                    ? "scale-110 border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-200 text-slate-400 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400",
                )}
              >
                <Check className="h-4 w-4" strokeWidth={3} />
              </button>
            </>
          )}
        </div>
      </div>

      {!isHistory && (task.consumable_name || task.consumable_model) && <ConsumableStrip info={consumable} className="mt-3" />}

      {!isHistory && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-zinc-800">
          <span className="text-[11px] font-normal tabular-nums text-slate-500 dark:text-zinc-400">
            {shortDate(task.due_date)} 예정
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
          <PurchaseButtons info={consumable} />
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy || settled}
              aria-label={`${task.title} 더보기`}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800 bg-slate-100 dark:bg-zinc-800"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              더보기
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onShare?.(task)}>
                <Link2 className="h-4 w-4 text-slate-400" />
                가족에게 링크 공유
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSnooze?.(task, 3)}>
                <CalendarPlus className="h-4 w-4 text-slate-400" />3일 연기
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze?.(task, 7)}>
                <CalendarPlus className="h-4 w-4 text-slate-400" />1주일 연기
              </DropdownMenuItem>
              {task.rule_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onSkip?.(task)}>
                    <SkipForward className="h-4 w-4 text-slate-400" />
                    이번 회차 건너뛰기
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      )}
    </li>
  );
}
