"use server";

import { revalidatePath } from "next/cache";
import { monthBounds, recentExpenses, summarizeBudget, type BudgetSummary } from "../rules/kitchen-budget";
import { DEFAULT_KITCHEN_PROFILE, addExpenseSchema, budgetSettingsSchema, kitchenIdSchema, type KitchenActionResult, type KitchenExpense } from "../schemas/kitchen.schema";
import { kitchenContext, seoulToday } from "./kitchen-context";

// Dual money log (human food budget + pet-care budget). Runs under the caller's JWT: RLS (current_household_id()) is the
// household boundary, and every household member may read and write the shared ledger.

const EXPENSE_COLUMNS = "id, expense_date, category, amount, memo, created_at";
const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");
const revalidate = () => {
  revalidatePath("/kitchen");
  revalidatePath("/analytics");
};

export type KitchenBudgetData = {
  today: string;
  month: string; // 'YYYY-MM'
  settings: { human_monthly_budget: number; pet_monthly_budget: number };
  /** this month's totals, burn-rate levels and today's recommended spend (rules/kitchen-budget.ts) */
  summary: BudgetSummary;
  /** every expense of this month, newest first */
  expenses: KitchenExpense[];
  /** the 3 newest */
  recent: KitchenExpense[];
  savedMoney: number;
  rescuedCount: number;
};

/** This month's budgets, ledger, burn rates and "오늘의 권장 식비" for the signed-in household. */
export async function getKitchenBudgetData(): Promise<KitchenActionResult<{ data: KitchenBudgetData }>> {
  const c = await kitchenContext();
  if (!c.ok) return c;
  const today = seoulToday();
  const bounds = monthBounds(today);
  if (!bounds) return { ok: false, error: "날짜를 확인하지 못했어요." };

  const [profileRes, expRes] = await Promise.all([
    c.ctx.supabase.from("kitchen_profiles").select("human_monthly_budget, pet_monthly_budget, rescued_count, saved_money").maybeSingle(),
    c.ctx.supabase
      .from("kitchen_expenses")
      .select(EXPENSE_COLUMNS)
      .gte("expense_date", bounds.start)
      .lte("expense_date", bounds.end)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (profileRes.error) return { ok: false, error: "예산 정보를 불러오지 못했어요." };
  if (expRes.error) return { ok: false, error: "지출 내역을 불러오지 못했어요." };

  const p = profileRes.data;
  const settings = { human_monthly_budget: p?.human_monthly_budget ?? DEFAULT_KITCHEN_PROFILE.human_monthly_budget, pet_monthly_budget: p?.pet_monthly_budget ?? DEFAULT_KITCHEN_PROFILE.pet_monthly_budget };
  const expenses = (expRes.data ?? []) as KitchenExpense[];
  const summary = summarizeBudget({ human_monthly_budget: settings.human_monthly_budget, pet_monthly_budget: settings.pet_monthly_budget }, expenses, today);
  if (!summary) return { ok: false, error: "날짜를 확인하지 못했어요." };

  return { ok: true, data: { today, month: bounds.start.slice(0, 7), settings, summary, expenses, recent: recentExpenses(expenses, 3), savedMoney: Number(p?.saved_money ?? 0), rescuedCount: p?.rescued_count ?? 0 } };
}

/** Manual entry: groceries / delivery & eating out / pet care. The date defaults to today and cannot be in the future. */
export async function addKitchenExpense(input: unknown): Promise<KitchenActionResult<{ expense: KitchenExpense }>> {
  const parsed = addExpenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;
  const c = await kitchenContext();
  if (!c.ok) return c;

  const today = seoulToday();
  const date = v.expenseDate ?? today;
  if (date > today) return { ok: false, error: "미래 날짜는 입력할 수 없어요." };

  const { data, error } = await c.ctx.supabase
    .from("kitchen_expenses")
    .insert({ household_id: c.ctx.householdId, expense_date: date, category: v.category, amount: v.amount, memo: v.memo })
    .select(EXPENSE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "지출을 등록하지 못했어요." };
  revalidate();
  return { ok: true, expense: data as KitchenExpense };
}

export async function deleteKitchenExpense(input: unknown): Promise<KitchenActionResult> {
  const parsed = kitchenIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await kitchenContext();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("kitchen_expenses").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: "지출을 삭제하지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "지출 내역을 찾을 수 없어요." };
  revalidate();
  return { ok: true };
}

/** Change the monthly budgets (human food and/or pet care). Only the fields sent are changed; creates the profile on first use. */
export async function updateKitchenBudgetSettings(input: unknown): Promise<KitchenActionResult<{ human_monthly_budget?: number; pet_monthly_budget?: number }>> {
  const parsed = budgetSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;
  const c = await kitchenContext();
  if (!c.ok) return c;

  const row: Record<string, unknown> = { household_id: c.ctx.householdId };
  if (v.humanMonthly !== undefined) row.human_monthly_budget = v.humanMonthly;
  if (v.petMonthly !== undefined) row.pet_monthly_budget = v.petMonthly;
  // upsert with only the supplied columns: the other budget and the stats counters are left untouched
  const { error } = await c.ctx.supabase.from("kitchen_profiles").upsert(row, { onConflict: "household_id" });
  if (error) return { ok: false, error: "예산을 저장하지 못했어요." };
  revalidate();
  return { ok: true, ...(v.humanMonthly !== undefined ? { human_monthly_budget: v.humanMonthly } : {}), ...(v.petMonthly !== undefined ? { pet_monthly_budget: v.petMonthly } : {}) };
}
