import type { SupabaseClient } from "@supabase/supabase-js";

// Append-only activity log (kitchen_activity, migration 19) that feeds the month-end settlement on /analytics.
// Not a "use server" module: an internal helper. It NEVER throws and never blocks the action it is called from — before the migration is
// applied the insert simply fails and is ignored, so every kitchen / shopping action keeps working exactly as before.

export type KitchenActivityRow = { kind: "CONSUMED" | "DISCARDED" | "SHOPPED"; name: string; estAmount?: number };

/** One "wasted ingredient" is valued like one rescued one (SAVED_WON_PER_RESCUE) because prices are not stored per ingredient. */
export const EST_WASTE_WON = 3000;

export async function logKitchenActivity(supabase: SupabaseClient, householdId: string, userId: string, rows: readonly KitchenActivityRow[]): Promise<void> {
  const clean = rows.filter((r) => r.name && r.name.trim()).slice(0, 200);
  if (clean.length === 0) return;
  try {
    await supabase.from("kitchen_activity").insert(
      clean.map((r) => ({ household_id: householdId, created_by: userId, kind: r.kind, name: r.name.trim().slice(0, 100), est_amount: Math.max(0, Math.round(r.estAmount ?? 0)) })),
    );
  } catch {
    /* the log is best-effort by design */
  }
}
