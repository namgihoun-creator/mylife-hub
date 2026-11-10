import { createClient } from "@/shared/lib/supabase/server";
import type { Asset, AppliancePreset } from "../schemas/asset.schema";

/** Assets visible to the current user (RLS: FAMILY or own PRIVATE) with their rules. */
export async function getAssets(): Promise<Asset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, name, space, category, preset_key, visibility, created_at, task_rules(id, title, recurring_type, interval_n), tasks(id, title, due_date, status, rule_id)",
    )
    .in("tasks.status", ["PENDING", "SNOOZED"]) // embedded filter: only open tasks per asset
    .order("created_at", { ascending: true });
  if (error) throw new Error(`자산을 불러오지 못했습니다: ${error.message}`);
  return (data ?? []) as unknown as Asset[];
}

/** Returns presets, or null when the preset table/seed is not available yet. */
export async function getPresets(): Promise<AppliancePreset[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appliance_presets")
    .select("preset_key, name_ko, category, default_space, sort_order, default_tasks")
    .order("sort_order", { ascending: true });
  if (error || !data || data.length === 0) return null;
  return data as AppliancePreset[];
}
