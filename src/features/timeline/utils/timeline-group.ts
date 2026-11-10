import { getDDay } from "@/shared/lib/dday";
import type { TimelineTask } from "../schemas/timeline.schema";

export type TimelineGroups = {
  overdue: TimelineTask[];
  today: TimelineTask[];
  upcoming: TimelineTask[];
};

export type TimelineFilter = "all" | "today" | "soon";

const byDue = (a: TimelineTask, b: TimelineTask) =>
  a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title, "ko");

/** Overdue (< today) · Today (= today) · Upcoming (> today). Pure: safe on server and client. */
export function groupTasks(tasks: TimelineTask[], today: string): TimelineGroups {
  const groups: TimelineGroups = { overdue: [], today: [], upcoming: [] };
  for (const t of tasks) {
    if (t.due_date < today) groups.overdue.push(t);
    else if (t.due_date === today) groups.today.push(t);
    else groups.upcoming.push(t);
  }
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  return groups;
}

/** "soon" = overdue or due within 7 days (same threshold as the D-Day badge). */
export function isSoon(task: TimelineTask, today: string) {
  const { urgency } = getDDay(task.due_date, today);
  return urgency === "overdue" || urgency === "soon";
}

export function applyFilter(groups: TimelineGroups, filter: TimelineFilter, today: string): TimelineGroups {
  if (filter === "all") return groups;
  if (filter === "today") return { overdue: [], today: groups.today, upcoming: [] };
  const soon = (list: TimelineTask[]) => list.filter((t) => isSoon(t, today));
  return { overdue: soon(groups.overdue), today: soon(groups.today), upcoming: soon(groups.upcoming) };
}
