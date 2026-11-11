import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import { toSeoulDate } from "@/shared/lib/recurrence";

// Shared plumbing for the kitchen Server Actions. Not a "use server" module: these are internal helpers, never callable
// from the browser. Every query runs under the caller's JWT, so RLS (current_household_id()) is the household boundary.

export type KitchenCtx = { supabase: SupabaseClient; householdId: string; userId: string };

export async function kitchenContext(): Promise<{ ok: true; ctx: KitchenCtx } | { ok: false; error: string }> {
  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  return { ok: true, ctx: { supabase: await createClient(), householdId: profile.householdId, userId: user.id } };
}

export const seoulToday = () => toSeoulDate(new Date().toISOString());

export type CounterDelta = { rescued?: number; discarded?: number; savedWon?: number };

/**
 * Add to the household's rescued / discarded / saved counters. Optimistic compare-and-set on all three values, so
 * members acting at the same moment never lose an increment; the profile row is created on first use.
 */
export async function adjustProfileCounters(supabase: SupabaseClient, householdId: string, delta: CounterDelta): Promise<boolean> {
  const rescued = delta.rescued ?? 0, discarded = delta.discarded ?? 0, saved = delta.savedWon ?? 0;
  if (rescued === 0 && discarded === 0 && saved === 0) return true;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: p, error } = await supabase.from("kitchen_profiles").select("rescued_count, discarded_count, saved_money").maybeSingle();
    if (error) return false;
    if (!p) {
      const ins = await supabase.from("kitchen_profiles").insert({ household_id: householdId, rescued_count: rescued, discarded_count: discarded, saved_money: saved });
      if (!ins.error) return true;
      if (ins.error.code !== "23505") return false; // someone else just created it: loop and update instead
      continue;
    }
    const upd = await supabase
      .from("kitchen_profiles")
      .update({ rescued_count: p.rescued_count + rescued, discarded_count: p.discarded_count + discarded, saved_money: Number(p.saved_money) + saved })
      .eq("household_id", householdId)
      .eq("rescued_count", p.rescued_count)
      .eq("discarded_count", p.discarded_count)
      .eq("saved_money", p.saved_money)
      .select("household_id");
    if (upd.error) return false;
    if (upd.data && upd.data.length === 1) return true;
  }
  return false;
}
