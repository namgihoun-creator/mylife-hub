// Pure calculation for the "환승 & 비용 비교" tab. No imports on purpose: it must stay trivially testable.
// Every number that is not read from the asset is an ASSUMPTION the user can change in the UI.

export const HORIZON_MONTHS = 36; // all three options are compared over the same 3 years
const DAYS_PER_MONTH = 30.4375;

export type CompareAssumptions = {
  newRentalFee: number; // monthly fee of a comparable new rental (원)
  transferIncentive: number; // one-time 환승 지원금 / cash-back (원)
  penalty: number; // early-termination penalty when leaving before the obligation ends (원)
  purchasePrice: number; // price of buying the appliance outright (원)
  yearlyCare: number; // self-service consumables per year, e.g. filters (원)
};

/** Rough defaults per appliance. They are starting points only; the UI says so and lets the user override each one. */
const PURCHASE_DEFAULTS: Record<string, { purchasePrice: number; yearlyCare: number }> = {
  water_purifier: { purchasePrice: 450_000, yearlyCare: 90_000 },
  air_purifier: { purchasePrice: 400_000, yearlyCare: 80_000 },
  bidet: { purchasePrice: 150_000, yearlyCare: 30_000 },
  aircon: { purchasePrice: 900_000, yearlyCare: 60_000 },
  washer: { purchasePrice: 800_000, yearlyCare: 20_000 },
  dryer: { purchasePrice: 900_000, yearlyCare: 20_000 },
  styler: { purchasePrice: 1_100_000, yearlyCare: 30_000 },
  dishwasher: { purchasePrice: 700_000, yearlyCare: 40_000 },
  refrigerator: { purchasePrice: 1_200_000, yearlyCare: 0 },
  kimchi_refrigerator: { purchasePrice: 800_000, yearlyCare: 0 },
  robot_vacuum: { purchasePrice: 600_000, yearlyCare: 60_000 },
  humidifier: { purchasePrice: 120_000, yearlyCare: 40_000 },
  dehumidifier: { purchasePrice: 250_000, yearlyCare: 20_000 },
  coffee_machine: { purchasePrice: 300_000, yearlyCare: 50_000 },
};

export function defaultAssumptions(presetKey: string | null | undefined): CompareAssumptions {
  const d = (presetKey && PURCHASE_DEFAULTS[presetKey]) || { purchasePrice: 500_000, yearlyCare: 60_000 };
  return { newRentalFee: 25_000, transferIncentive: 250_000, penalty: 0, ...d };
}

function dayNumber(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
}

/** Remaining monthly payments until `date` (partial month counts as one; 0 when the date is today or past; null when unknown). */
export function monthsUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const days = dayNumber(date) - dayNumber(today);
  return days <= 0 ? 0 : Math.ceil(days / DAYS_PER_MONTH);
}

export type OptionKey = "keep" | "switch" | "buy";

export type Comparison = {
  keep: {
    available: boolean; // needs a monthly fee
    total: number; // fee x paying months within the horizon
    payingMonths: number; // months still paid within the horizon (stops at ownership transfer)
    obligationMonths: number | null; // remaining obligation months
    obligationTotal: number | null; // fee x obligationMonths
    transferMonths: number | null; // months until ownership transfer
    transferTotal: number | null; // fee x transferMonths
  };
  switch: { total: number; rentalTotal: number; incentive: number; penalty: number };
  buy: { total: number; purchase: number; care: number; penalty: number };
  totals: Record<OptionKey, number | null>;
  cheapest: OptionKey;
  /** Gap between the two best options is within 5% of the best total. */
  closeCall: boolean;
  /** cheapest total minus each option's total (negative = the option costs more than the cheapest). */
  savingsVsKeep: { switch: number | null; buy: number | null };
};

export function computeComparison(args: {
  monthlyFee: number | null;
  obligationEndDate: string | null;
  ownershipTransferDate: string | null;
  today: string;
  assumptions: CompareAssumptions;
}): Comparison {
  const { monthlyFee, obligationEndDate, ownershipTransferDate, today, assumptions: a } = args;

  const obligationMonths = monthsUntil(obligationEndDate, today);
  const transferMonths = monthsUntil(ownershipTransferDate, today);
  const fee = monthlyFee ?? 0;
  const available = monthlyFee !== null;

  // After the ownership transfer the device is yours and the fee stops: only the months before it are paid.
  const payingMonths = transferMonths !== null ? Math.min(HORIZON_MONTHS, transferMonths) : HORIZON_MONTHS;
  const keepTotal = fee * payingMonths;

  const rentalTotal = a.newRentalFee * HORIZON_MONTHS;
  const switchTotal = Math.max(0, rentalTotal - a.transferIncentive) + a.penalty;

  const care = a.yearlyCare * (HORIZON_MONTHS / 12);
  const buyTotal = a.purchasePrice + care + a.penalty;

  const totals: Record<OptionKey, number | null> = { keep: available ? keepTotal : null, switch: switchTotal, buy: buyTotal };
  const ranked = (Object.entries(totals) as [OptionKey, number | null][])
    .filter((e): e is [OptionKey, number] => e[1] !== null)
    .sort((x, y) => x[1] - y[1] || (x[0] === "keep" ? -1 : 1)); // ties favour keeping what you have

  const best = ranked[0];
  const second = ranked[1];

  return {
    keep: {
      available,
      total: keepTotal,
      payingMonths,
      obligationMonths,
      obligationTotal: available && obligationMonths !== null ? fee * obligationMonths : null,
      transferMonths,
      transferTotal: available && transferMonths !== null ? fee * transferMonths : null,
    },
    switch: { total: switchTotal, rentalTotal, incentive: a.transferIncentive, penalty: a.penalty },
    buy: { total: buyTotal, purchase: a.purchasePrice, care, penalty: a.penalty },
    totals,
    cheapest: best[0],
    closeCall: !!second && second[1] - best[1] <= best[1] * 0.05,
    savingsVsKeep: {
      switch: available ? keepTotal - switchTotal : null,
      buy: available ? keepTotal - buyTotal : null,
    },
  };
}
