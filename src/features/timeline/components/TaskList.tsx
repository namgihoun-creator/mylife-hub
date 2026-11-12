"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { CelebrationArt } from "@/shared/components/ui/celebration-art";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import type { TimelineTask } from "../schemas/timeline.schema";
import { applyFilter, groupTasks, type TimelineFilter } from "../utils/timeline-group";
import { TaskCard, type TaskCardProps, type TaskEmphasis } from "./TaskCard";

const PILL_BASE = "min-h-11 shrink-0 rounded-full px-5 text-sm font-bold shadow-sm transition-all active:scale-95 motion-reduce:transform-none";
const PILL_ACTIVE = "bg-sky-600 text-white shadow-sky-200 dark:bg-sky-500 dark:text-white dark:shadow-none";
const PILL_INACTIVE =
  "bg-white text-slate-600 hover:bg-slate-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

const CTA =
  "inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-sky-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400";

type SectionKey = "overdue" | "today" | "upcoming" | "recent";

type SectionStyle = {
  title: string;
  icon: LucideIcon;
  iconTone: string;
  /** Wrapper that gives the section its character (docs "타임라인 섹션 성격"). */
  shell: string;
  badge?: { text: string; className: string };
  emphasis: TaskEmphasis;
};

const SECTIONS: Record<SectionKey, SectionStyle> = {
  overdue: {
    title: "기한 초과",
    icon: AlertTriangle,
    iconTone: "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400",
    shell: "rounded-3xl bg-rose-50/70 p-3 shadow-sm dark:bg-rose-950/20 sm:p-4",
    badge: { text: "긴급", className: "bg-rose-600 text-white" },
    emphasis: "overdue",
  },
  today: {
    title: "오늘 할 일",
    icon: CalendarCheck,
    iconTone: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    shell:
      "rounded-3xl bg-amber-50/70 p-3 shadow-sm dark:bg-amber-950/15 sm:p-4",
    badge: { text: "TODAY", className: "bg-amber-600 text-white dark:bg-amber-500 dark:text-black" },
    emphasis: "today",
  },
  upcoming: {
    title: "다가오는 과업",
    icon: CalendarClock,
    iconTone: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    shell: "",
    emphasis: "upcoming",
  },
  recent: {
    title: "최근 완료",
    icon: CheckCircle2,
    iconTone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    shell: "",
    emphasis: "none",
  },
};

const ORDER: SectionKey[] = ["overdue", "today", "upcoming", "recent"];

const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "today", label: "오늘" },
  { key: "soon", label: "임박" },
];

type Handlers = Pick<TaskCardProps, "onComplete" | "onSnooze" | "onSkip" | "onShare">;

export function TaskList({
  items,
  recent,
  today,
  busyIds,
  ...handlers
}: {
  items: TimelineTask[]; // open tasks incl. optimistic markers
  recent: TimelineTask[];
  today: string;
  busyIds: ReadonlySet<string>;
} & Handlers) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    overdue: false,
    today: false,
    upcoming: false,
    recent: true,
  });

  const unfiltered = useMemo(() => groupTasks(items, today), [items, today]);
  const groups = useMemo(() => applyFilter(unfiltered, filter, today), [unfiltered, filter, today]);
  const openCount = items.filter((t) => !t.pending).length;

  const counts: Record<TimelineFilter, number> = {
    all: items.length,
    today: unfiltered.today.length,
    soon: Object.values(applyFilter(unfiltered, "soon", today)).reduce((n, l) => n + l.length, 0),
  };

  const sectionItems: Record<SectionKey, TimelineTask[]> = {
    overdue: groups.overdue,
    today: groups.today,
    upcoming: groups.upcoming,
    recent: filter === "all" ? recent : [],
  };

  const allDone = openCount === 0;

  return (
    <div className="space-y-6">
      {allDone &&
        (items.length > 0 || recent.length > 0 ? (
          <EmptyState
            art={<CelebrationArt />}
            title="모든 가전 관리가 완료되었습니다!"
            description="다음 관리 일정이 다가오면 이곳에 나타나요. 오늘도 수고하셨어요."
            action={
              <Link href="/assets" className={CTA}>
                자산 관리 보기
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="아직 등록된 과업이 없어요"
            description="가전을 등록하면 소모품 교체·청소 일정이 자동으로 만들어져요."
            action={
              <Link href="/assets" className={CTA}>
                가전 추가하러 가기
              </Link>
            }
          />
        ))}

      {!allDone && (
        <div
          className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="과업 필터"
        >
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(PILL_BASE, filter === key ? PILL_ACTIVE : PILL_INACTIVE)}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>
      )}

      {!allDone && filter !== "all" && Object.values(groups).every((l) => l.length === 0) && (
        <p className="py-6 text-center text-xs text-slate-500 dark:text-zinc-400">해당하는 과업이 없어요.</p>
      )}

      {ORDER.map((key) => {
        const list = sectionItems[key];
        if (list.length === 0) return null;
        const s = SECTIONS[key];
        const Icon = s.icon;
        const isCollapsed = collapsed[key];
        return (
          <section key={key} className={cn("space-y-3", s.shell)}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
              className="flex w-full items-center gap-2.5 text-left"
            >
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl", s.iconTone)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-base font-extrabold text-slate-800 dark:text-zinc-100">{s.title}</span>
              {s.badge && (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide", s.badge.className)}>
                  {s.badge.text}
                </span>
              )}
              <span className="text-xs font-normal text-slate-500 dark:text-zinc-400">{list.length}</span>
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 text-slate-400 transition-transform dark:text-zinc-500",
                  !isCollapsed && "rotate-180",
                )}
              />
            </button>
            {!isCollapsed && (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    today={today}
                    emphasis={s.emphasis}
                    variant={key === "recent" ? "done" : "open"}
                    busy={busyIds.has(t.id)}
                    {...handlers}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
