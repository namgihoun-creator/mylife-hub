// Monthly food / pet budget maths (CookSaver `budget.summary`). Whole won, integer arithmetic only.
// "Today's recommended spend" = remaining human budget ÷ days left in the month INCLUDING today; overspent -> 0 won.
import { daysInMonth, isValidDate } from "./date-utils.ts";

export const EXPENSE_CATEGORIES = ["human_groceries", "human_delivery", "pet_care"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const HUMAN_CATEGORIES: readonly ExpenseCategory[] = ["human_groceries", "human_delivery"];
export const MAX_WON = 100_000_000;
export const DEFAULT_HUMAN_BUDGET = 350_000;
export const DEFAULT_PET_BUDGET = 100_000;

/** Burn-rate stages: ok < 80% <= warn < 100% <= danger. */
export type BudgetLevel = "ok" | "warn" | "danger";
export const WARN_PERCENT = 80;
export const DANGER_PERCENT = 100;

/**
 * Stage from spent vs. monthly budget. Compared as integers (spent*100 >= monthly*80) so 80.0% / 100.0% are exact.
 * A budget of 0 won: any spending is "danger", no spending is "ok".
 */
export function budgetLevel(spent: number, monthly: number): BudgetLevel {
  if (monthly <= 0) return spent > 0 ? "danger" : "ok";
  if (spent * 100 >= monthly * DANGER_PERCENT) return "danger";
  if (spent * 100 >= monthly * WARN_PERCENT) return "warn";
  return "ok";
}

/** spent / monthly, rounded to 4 decimals (0.8 = 80%). monthly 0 -> 1 when anything was spent, else 0. */
export function burnRatio(spent: number, monthly: number): number {
  if (monthly <= 0) return spent > 0 ? 1 : 0;
  return Math.round((spent / monthly) * 10_000) / 10_000;
}

/** Days left in the month counting today ('2028-02-10' -> 20 in a leap February, '2027-02-10' -> 19). null for an invalid date. */
export function daysLeftInMonth(today: string): number | null {
  if (!isValidDate(today)) return null;
  const [y, m, d] = today.split("-").map(Number);
  return daysInMonth(y, m) - d + 1;
}

/** Today's recommended spend in won: floor(max(0, left) / daysLeft). Overspent -> 0. */
export function recommendedDaily(left: number, daysLeft: number): number {
  if (!Number.isFinite(left) || daysLeft <= 0) return 0;
  return Math.floor(Math.max(0, left) / daysLeft);
}

export type BudgetPart = { monthly: number; spent: number; left: number; ratio: number; level: BudgetLevel };
export const budgetPart = (spent: number, monthly: number): BudgetPart => ({
  monthly,
  spent,
  left: monthly - spent, // negative when overspent (shown as "초과")
  ratio: burnRatio(spent, monthly),
  level: budgetLevel(spent, monthly),
});

export type Expense = { expense_date: string; category: ExpenseCategory; amount: number };
export type BudgetSettings = { human_monthly_budget: number; pet_monthly_budget: number };

export type BudgetSummary = {
  month: string; // 'YYYY-MM'
  totals: Record<ExpenseCategory, number>;
  human: BudgetPart;
  pet: BudgetPart;
  daysLeft: number;
  todayBudget: number; // recommended human food spend for today
};

/** Only expenses dated in `today`'s month count; earlier months are history. */
export function summarizeBudget(settings: BudgetSettings, expenses: readonly Expense[], today: string): BudgetSummary | null {
  const daysLeft = daysLeftInMonth(today);
  if (daysLeft === null) return null;
  const month = today.slice(0, 7);
  const totals: Record<ExpenseCategory, number> = { human_groceries: 0, human_delivery: 0, pet_care: 0 };
  for (const e of expenses) if (e.expense_date.slice(0, 7) === month) totals[e.category] += e.amount;
  const human = budgetPart(totals.human_groceries + totals.human_delivery, settings.human_monthly_budget);
  const pet = budgetPart(totals.pet_care, settings.pet_monthly_budget);
  return { month, totals, human, pet, daysLeft, todayBudget: recommendedDaily(human.left, daysLeft) };
}
