"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import { billIdSchema, billInputSchema, type BillActionResult, type UtilityBill } from "../schemas/bill.schema";
import { isMonth, prevMonth } from "../utils/month";

// Utility bills (utility_bills, migration 19). Runs under the caller's JWT, so RLS (current_household_id()) is the household boundary.
// Before the migration is applied the table does not exist: every call answers `notReady` instead of failing, and /analytics shows a
// short "준비 중" banner in place of the card.

const COLUMNS = "id, bill_type, billing_month, amount, due_date, provider_name, memo, created_by, created_at";
const NOT_READY = "공과금 기록 기능을 준비하고 있어요. 데이터베이스 업데이트가 끝나면 열려요.";
const revalidate = () => revalidatePath("/analytics");

/** This month's and the previous month's bills (for the month total and the change against last month), newest first. */
export async function getBillsForMonth(month: string): Promise<BillActionResult<{ bills: UtilityBill[] }>> {
  if (!isMonth(month)) return { ok: false, error: "월 형식이 올바르지 않아요." };
  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("utility_bills")
    .select(COLUMNS)
    .in("billing_month", [month, prevMonth(month)])
    .order("billing_month", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: NOT_READY, notReady: true };
  return { ok: true, bills: (data ?? []) as UtilityBill[] };
}

export async function createBill(input: unknown): Promise<BillActionResult<{ bill: UtilityBill }>> {
  const parsed = billInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요." };
  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("utility_bills")
    .insert({ household_id: profile.householdId, created_by: user.id, bill_type: v.billType, billing_month: v.billingMonth, amount: v.amount, due_date: v.dueDate ?? null, provider_name: v.providerName ?? null, memo: v.memo ?? null })
    .select(COLUMNS)
    .single();
  if (error || !data) return error && /utility_bills|relation|schema cache/i.test(error.message) ? { ok: false, error: NOT_READY, notReady: true } : { ok: false, error: "고지서를 저장하지 못했어요." };
  revalidate();
  return { ok: true, bill: data as UtilityBill };
}

export async function deleteBill(input: unknown): Promise<BillActionResult> {
  const parsed = billIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) return { ok: false, error: "로그인이 필요합니다." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("utility_bills").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: "지우지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "이미 지워진 고지서예요." };
  revalidate();
  return { ok: true };
}
