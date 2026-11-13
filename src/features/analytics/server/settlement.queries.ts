import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import { toSeoulDate } from "@/shared/lib/recurrence";
import { DEFAULT_KITCHEN_PROFILE } from "@/features/kitchen/schemas/kitchen.schema";
import { buildSettlement, type Settlement } from "../utils/settlement";
import { monthRange } from "../utils/month";

/**
 * Month-end settlement for the signed-in household. Every source is read under the caller's JWT (RLS = household boundary) and every
 * one of them is optional: a failing / missing table (kitchen_activity before migration 19, for example) just leaves that part out and
 * `buildSettlement` says so — the card itself always renders.
 */
export async function getSettlement(month: string): Promise<Settlement | null> {
  const range = monthRange(month);
  if (!range) return null;
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) return null;
  const supabase = await createClient();
  const today = toSeoulDate(new Date().toISOString());

  const [prof, exp, act, stock, events] = await Promise.all([
    supabase.from("kitchen_profiles").select("human_monthly_budget").maybeSingle(),
    supabase.from("kitchen_expenses").select("category, amount").gte("expense_date", range.start).lte("expense_date", range.end).in("category", ["human_groceries", "human_delivery"]).limit(2000),
    supabase.from("kitchen_activity").select("kind, est_amount, created_by").gte("created_at", range.startIso).lt("created_at", range.endIso).limit(5000),
    supabase.from("kitchen_items").select("id", { count: "exact", head: true }).gte("expire_date", range.start).lte("expire_date", range.end).lt("expire_date", today),
    supabase.from("event_logs").select("actor_identifier").in("event_type", ["TASK_COMPLETED", "MAGIC_LINK_COMPLETED"]).gte("created_at", range.startIso).lt("created_at", range.endIso).limit(5000),
  ]);

  return buildSettlement({
    month,
    today,
    humanBudget: prof.error ? DEFAULT_KITCHEN_PROFILE.human_monthly_budget : (prof.data?.human_monthly_budget ?? DEFAULT_KITCHEN_PROFILE.human_monthly_budget),
    expenses: exp.error ? [] : ((exp.data ?? []) as { category: string; amount: number }[]),
    activity: act.error ? null : ((act.data ?? []) as { kind: string; est_amount: number | null; created_by: string | null }[]),
    expiredInStock: stock.error ? 0 : (stock.count ?? 0),
    taskEvents: events.error ? [] : ((events.data ?? []) as { actor_identifier: string | null }[]),
  });
}
