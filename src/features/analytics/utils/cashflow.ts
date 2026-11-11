// Household cash-flow summary for the /analytics report: fixed rental payments + this month's variable kitchen spending,
// next to the money the kitchen has defended so far (food used up instead of thrown away). Pure; no alias imports.

export type CashflowInput = {
  /** monthly rental total (won) */
  rentalMonthly: number;
  /** this month's human food spending (groceries + delivery) */
  humanSpent: number;
  /** this month's pet-care spending */
  petSpent: number;
  /** cumulative savings from using food up (kitchen_profiles.saved_money) — NOT limited to this month */
  savedMoney: number;
};

export type Cashflow = {
  fixed: number; // rentals
  variable: number; // food + pet
  total: number; // fixed + variable
  humanSpent: number;
  petSpent: number;
  /** shares of the total (0..100, rounded) for the stacked bar; all 0 when nothing is spent */
  share: { fixed: number; human: number; pet: number };
  defended: number; // cumulative kitchen savings
  /** defended / (defended + variable): how much of the food-side money was kept; null when both are 0 */
  defendedPct: number | null;
};

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export function buildHouseholdCashflow(input: CashflowInput): Cashflow {
  const fixed = nn(input.rentalMonthly), human = nn(input.humanSpent), pet = nn(input.petSpent), defended = nn(input.savedMoney);
  const variable = human + pet;
  const total = fixed + variable;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const keep = defended + variable;
  return {
    fixed,
    variable,
    total,
    humanSpent: human,
    petSpent: pet,
    share: { fixed: pct(fixed), human: pct(human), pet: pct(pet) },
    defended,
    defendedPct: keep === 0 ? null : Math.round((defended / keep) * 100),
  };
}
