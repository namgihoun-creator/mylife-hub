import { createClient } from "@/shared/lib/supabase/server";
import type { TimelineTask } from "../schemas/timeline.schema";

const SELECT =
  "id, title, due_date, status, completed_at, rule_id, iteration_no, assets(name, preset_key, space, category), task_rules(recurring_type, interval_n)";

// PostgREST returns to-one embeds as an object (typed loosely as array/object here).
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function normalize(row: Record<string, unknown>): TimelineTask {
  return {
    id: row.id as string,
    title: row.title as string,
    due_date: row.due_date as string,
    status: row.status as TimelineTask["status"],
    completed_at: (row.completed_at as string | null) ?? null,
    rule_id: (row.rule_id as string | null) ?? null,
    iteration_no: (row.iteration_no as number | null) ?? null,
    asset: one(row.assets as TimelineTask["asset"] | TimelineTask["asset"][]),
    rule: one(row.task_rules as TimelineTask["rule"] | TimelineTask["rule"][]),
  };
}

/**
 * Open tasks (PENDING/SNOOZED) and the most recent completions of one household.
 * Grouping into Overdue/Today/Upcoming lives in timeline-group.ts (pure, shared with the client
 * so optimistic updates can regroup). RLS still applies: PRIVATE tasks of others are never returned.
 */
export async function getTimelineData(householdId: string) {
  const supabase = await createClient();

  const [openRes, recentRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(SELECT)
      .eq("household_id", householdId)
      .in("status", ["PENDING", "SNOOZED"])
      .order("due_date", { ascending: true })
      .limit(300),
    supabase
      .from("tasks")
      .select(SELECT)
      .eq("household_id", householdId)
      .eq("status", "COMPLETED")
      .order("completed_at", { ascending: false })
      .limit(10),
  ]);

  if (openRes.error) throw new Error(`과업을 불러오지 못했습니다: ${openRes.error.message}`);
  if (recentRes.error) throw new Error(`완료 내역을 불러오지 못했습니다: ${recentRes.error.message}`);

  return {
    open: (openRes.data ?? []).map((r) => normalize(r as Record<string, unknown>)),
    recent: (recentRes.data ?? []).map((r) => normalize(r as Record<string, unknown>)),
  };
}
