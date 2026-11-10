"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { toSeoulDate } from "@/shared/lib/recurrence";
import { getSessionProfile } from "@/features/auth/server/session";
import {
  addPresetInputSchema,
  presetTaskSchema,
  updateAssetInputSchema,
  type ActionResult,
  type UpdateAssetResult,
} from "../schemas/asset.schema";

/**
 * Registers an asset from a preset together with its recommended task_rules and the
 * first task instance (iteration 1) of each rule. Runs under the caller's JWT, so RLS
 * applies (ADMIN-only writes). The preset is re-read from the DB: nothing the client
 * sends except the key/visibility is trusted.
 */
export async function addAssetFromPreset(input: unknown): Promise<ActionResult> {
  const parsed = addPresetInputSchema.safeParse(input);
  if (!parsed.success) {
    // Validation messages are written for end users (e.g. "렌탈사명을 입력해 주세요."); show the first one.
    const first = parsed.error.issues[0]?.message;
    const friendly = first && /[가-힣]/.test(first) ? first : "잘못된 요청입니다.";
    return { ok: false, error: friendly };
  }
  const { presetKey, visibility, ownershipType, rental } = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  if (profile.role !== "ADMIN") return { ok: false, error: "자산 등록은 관리자만 할 수 있습니다." };

  const supabase = await createClient();

  const { data: preset, error: presetError } = await supabase
    .from("appliance_presets")
    .select("preset_key, name_ko, category, default_space, default_tasks")
    .eq("preset_key", presetKey)
    .maybeSingle();
  if (presetError || !preset) return { ok: false, error: "프리셋을 찾을 수 없습니다." };

  const tasks = z.array(presetTaskSchema).safeParse(preset.default_tasks);
  if (!tasks.success) return { ok: false, error: "프리셋 데이터가 올바르지 않습니다." };

  // First due date of each rule: now + interval, via the DB function (end-of-month clamping, Asia/Seoul).
  const nowIso = new Date().toISOString();
  const dues = await Promise.all(
    tasks.data.map(async (t) => {
      const { data, error } = await supabase.rpc("calculate_next_due_date", {
        p_current_due: nowIso,
        p_recurring_type: t.recurring_type,
        p_interval: t.interval_n,
      });
      if (error || typeof data !== "string") throw new Error(error?.message ?? "due date calculation failed");
      return toSeoulDate(data);
    }),
  ).catch(() => null);
  if (!dues) return { ok: false, error: "다음 예정일 계산에 실패했습니다." };

  const base = { household_id: profile.householdId, owner_id: user.id, visibility };

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .insert({
      ...base,
      name: preset.name_ko,
      space: preset.default_space,
      category: preset.category,
      preset_key: preset.preset_key,
      // Ownership (migration 0009). OWNED leaves every rental column at its default / NULL.
      ownership_type: ownershipType,
      ...(ownershipType === "RENTAL" && rental
        ? {
            rental_provider: rental.provider,
            monthly_fee: rental.monthlyFee ?? null,
            billing_day: rental.billingDay ?? null,
            contract_start_date: rental.contractStartDate ?? null,
            obligation_end_date: rental.obligationEndDate ?? null,
            ownership_transfer_date: rental.ownershipTransferDate ?? null,
            care_type: rental.careType,
            payment_card_note: rental.paymentCardNote?.trim() ? rental.paymentCardNote.trim() : null,
          }
        : {}),
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, error: `자산 등록 실패: ${assetError?.message}` };

  // Compensating cleanup (no multi-table transaction through PostgREST).
  const rollback = async () => {
    await supabase.from("tasks").delete().eq("asset_id", asset.id);
    await supabase.from("assets").delete().eq("id", asset.id); // task_rules cascade
  };

  if (tasks.data.length > 0) {
    const { data: rules, error: ruleError } = await supabase
      .from("task_rules")
      .insert(
        tasks.data.map((t) => ({
          ...base,
          asset_id: asset.id,
          title: t.title,
          recurring_type: t.recurring_type,
          interval_n: t.interval_n,
          anchor: t.anchor,
          next_iteration_no: 2,
        })),
      )
      .select("id, title");
    if (ruleError || !rules || rules.length !== tasks.data.length) {
      await rollback();
      return { ok: false, error: `관리 규칙 등록 실패: ${ruleError?.message ?? "unknown"}` };
    }

    // Match by title (rule titles are unique within a preset) rather than relying on row order.
    const dueByTitle = new Map(tasks.data.map((t, i) => [t.title, dues[i]]));
    const { error: taskError } = await supabase.from("tasks").insert(
      rules.map((r) => ({
        ...base,
        asset_id: asset.id,
        rule_id: r.id,
        iteration_no: 1,
        title: r.title,
        due_date: dueByTitle.get(r.title as string),
      })),
    );
    if (taskError) {
      await rollback();
      return { ok: false, error: `첫 과업 생성 실패: ${taskError.message}` };
    }
  }

  revalidatePath("/assets");
  return { ok: true, assetId: asset.id, ruleCount: tasks.data.length };
}

/**
 * Edits an existing asset (name, place, category, memo, ownership type and rental details).
 * Runs under the caller's JWT, so RLS decides who may write (ADMIN; own PRIVATE assets only). The session role is
 * checked first for a clear message, and an UPDATE that matches no row (not allowed / not found) is reported
 * instead of silently succeeding. Switching to OWNED clears every rental column.
 */
export async function updateAsset(input: unknown): Promise<UpdateAssetResult> {
  const parsed = updateAssetInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return { ok: false, error: first && /[가-힣]/.test(first) ? first : "잘못된 요청입니다." };
  }
  const { assetId, name, space, category, note, modelName, ownershipType, rental } = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  if (profile.role !== "ADMIN") return { ok: false, error: "자산 수정은 관리자만 할 수 있어요." };

  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const rentalColumns =
    ownershipType === "RENTAL" && rental
      ? {
          rental_provider: rental.provider,
          monthly_fee: rental.monthlyFee ?? null,
          billing_day: rental.billingDay ?? null,
          contract_start_date: rental.contractStartDate ?? null,
          obligation_end_date: rental.obligationEndDate ?? null,
          ownership_transfer_date: rental.ownershipTransferDate ?? null,
          care_type: rental.careType,
          payment_card_note: clean(rental.paymentCardNote),
        }
      : {
          rental_provider: null,
          monthly_fee: null,
          billing_day: null,
          contract_start_date: null,
          obligation_end_date: null,
          ownership_transfer_date: null,
          care_type: "NONE",
          payment_card_note: null,
        };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .update({
      name,
      space: clean(space),
      category: clean(category),
      note: clean(note),
      model_name: clean(modelName),
      ownership_type: ownershipType,
      ...rentalColumns,
    })
    .eq("id", assetId)
    .eq("household_id", profile.householdId)
    .select("id");
  if (error) return { ok: false, error: "자산을 수정하지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "수정할 수 없는 자산이에요 (권한이 없거나 이미 삭제됐어요)." };

  revalidatePath("/assets");
  revalidatePath("/timeline"); // task cards show the asset name / place
  return { ok: true };
}
