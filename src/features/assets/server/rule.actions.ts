"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import {
  createRuleInputSchema,
  updateRuleConsumableInputSchema,
  type RuleActionResult,
} from "../schemas/rule.schema";

// Both actions run under the caller's JWT: RLS decides (ADMIN; own PRIVATE / FAMILY rows only).
const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** New recurring rule on an asset + its first task (iteration 1), both carrying the consumable info. */
export async function createTaskRule(input: unknown): Promise<RuleActionResult> {
  const parsed = createRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  if (profile.role !== "ADMIN") return { ok: false, error: "관리 규칙은 관리자만 만들 수 있어요." };

  const supabase = await createClient();
  const { data: asset } = await supabase.from("assets").select("id, visibility").eq("id", v.assetId).maybeSingle();
  if (!asset) return { ok: false, error: "자산을 찾을 수 없거나 권한이 없어요." };

  const consumable = {
    consumable_name: clean(v.consumableName),
    consumable_model: clean(v.consumableModel),
    custom_purchase_url: clean(v.customPurchaseUrl),
  };
  const base = { household_id: profile.householdId, owner_id: user.id, visibility: asset.visibility, asset_id: asset.id };

  const { data: rule, error: ruleError } = await supabase
    .from("task_rules")
    .insert({ ...base, title: v.title, recurring_type: v.recurringType, interval_n: v.intervalN, anchor: "DUE_DATE", next_iteration_no: 2, ...consumable })
    .select("id")
    .single();
  if (ruleError || !rule) return { ok: false, error: "규칙을 만들지 못했어요." };

  const { error: taskError } = await supabase
    .from("tasks")
    .insert({ ...base, rule_id: rule.id, iteration_no: 1, title: v.title, due_date: v.firstDueDate, ...consumable });
  if (taskError) {
    await supabase.from("task_rules").delete().eq("id", rule.id); // no half-created rule
    return { ok: false, error: "첫 과업을 만들지 못했어요." };
  }

  revalidatePath("/assets");
  revalidatePath("/timeline");
  return { ok: true };
}

/** Edit a rule's consumable info; open tasks of the rule are updated in the same transaction (RPC). */
export async function updateRuleConsumable(input: unknown): Promise<RuleActionResult> {
  const parsed = updateRuleConsumableInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  if (profile.role !== "ADMIN") return { ok: false, error: "관리 규칙은 관리자만 수정할 수 있어요." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_rule_consumable", {
    p_rule_id: v.ruleId,
    p_name: v.consumableName ?? "",
    p_model: v.consumableModel ?? "",
    p_url: v.customPurchaseUrl ?? "",
  });
  if (error) {
    return { ok: false, error: /RULE_NOT_FOUND_OR_FORBIDDEN/.test(error.message) ? "수정할 수 없는 규칙이에요 (권한이 없거나 삭제됐어요)." : "소모품 정보를 저장하지 못했어요." };
  }

  revalidatePath("/assets");
  revalidatePath("/timeline");
  return { ok: true, updatedTasks: typeof data === "number" ? data : undefined };
}
