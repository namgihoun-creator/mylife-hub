// Pure calculation engine for the 리포트 page. No I/O, no clock: callers pass `today` ('YYYY-MM-DD', Asia/Seoul).
// Deliberately free of "@/" imports so the test script can import this file directly with Node.
import type { Asset } from "../../assets/schemas/asset.schema";

export type AnalyticsRule = Pick<Asset["task_rules"][number], "id" | "title" | "recurring_type" | "interval_n" | "consumable_name" | "consumable_model">;
export type AnalyticsAsset = Pick<
  Asset,
  | "id"
  | "name"
  | "space"
  | "category"
  | "ownership_type"
  | "rental_provider"
  | "monthly_fee"
  | "billing_day"
  | "obligation_end_date"
  | "ownership_transfer_date"
  | "payment_card_note"
> & {
  task_rules: AnalyticsRule[];
  tasks: Pick<Asset["tasks"][number], "rule_id" | "due_date" | "status">[];
};

const isRental = (a: Pick<AnalyticsAsset, "ownership_type">) => a.ownership_type === "RENTAL";

// ---------------------------------------------------------------- date helpers (calendar dates, no timezones)
const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, d: day };
};
const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const utc = (d: string) => {
  const p = parse(d);
  return Date.UTC(p.y, p.m - 1, p.d);
};
export const daysBetween = (to: string, from: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

/** anchor + n months with end-of-month clamping, always measured from the ANCHOR day (no drift: 1/31 -> 2/28 -> 3/31). */
function addMonths(anchor: string, n: number): string {
  const p = parse(anchor);
  const idx = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return fmt(y, m, Math.min(p.d, daysInMonth(y, m)));
}
function addDays(anchor: string, n: number): string {
  const t = new Date(utc(anchor) + n * 86_400_000);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
const occurrence = (anchor: string, type: AnalyticsRule["recurring_type"], n: number, k: number): string | null => {
  switch (type) {
    case "DAILY":
      return addDays(anchor, n * k);
    case "WEEKLY":
      return addDays(anchor, 7 * n * k);
    case "MONTHLY":
      return addMonths(anchor, n * k);
    case "YEARLY":
      return addMonths(anchor, 12 * n * k);
    default:
      return null;
  }
};

// ---------------------------------------------------------------- ① monthly rental spend + billing schedule
export type BillingItem = {
  assetId: string;
  name: string;
  provider: string | null;
  fee: number | null;
  billingDay: number | null;
  cardNote: string | null;
};
export type BillingSchedule = {
  items: BillingItem[]; // sorted by billing day (unknown last), then name
  monthlyTotal: number;
  rentalCount: number;
  missingFee: number; // rentals without a fee (excluded from the total)
  missingDay: number; // rentals without a billing day (not placed on the 1..31 strip)
  days: { day: number; total: number; items: BillingItem[] }[]; // always 31 entries
  maxDayTotal: number;
};

export function buildBillingSchedule(assets: AnalyticsAsset[]): BillingSchedule {
  const items: BillingItem[] = assets.filter(isRental).map((a) => ({
    assetId: a.id,
    name: a.name,
    provider: a.rental_provider,
    fee: a.monthly_fee ?? null,
    billingDay: a.billing_day ?? null,
    cardNote: a.payment_card_note?.trim() ? a.payment_card_note.trim() : null,
  }));
  items.sort((a, b) => (a.billingDay ?? 99) - (b.billingDay ?? 99) || a.name.localeCompare(b.name, "ko"));

  const days = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, total: 0, items: [] as BillingItem[] }));
  let monthlyTotal = 0;
  let missingFee = 0;
  let missingDay = 0;
  for (const it of items) {
    if (it.fee === null) missingFee++;
    else monthlyTotal += it.fee;
    if (it.billingDay === null || it.billingDay < 1 || it.billingDay > 31) {
      missingDay++;
      continue;
    }
    const slot = days[it.billingDay - 1];
    slot.items.push(it);
    slot.total += it.fee ?? 0;
  }
  return { items, monthlyTotal, rentalCount: items.length, missingFee, missingDay, days, maxDayTotal: Math.max(0, ...days.map((d) => d.total)) };
}

/** Next billing date on/after `today` for a billing day (clamped to the month's last day: day 31 in a 30-day month = the 30th). */
export function nextBillingDate(billingDay: number, today: string): string {
  const t = parse(today);
  const thisMonth = fmt(t.y, t.m, Math.min(billingDay, daysInMonth(t.y, t.m)));
  if (thisMonth >= today) return thisMonth;
  const ny = t.m === 12 ? t.y + 1 : t.y;
  const nm = t.m === 12 ? 1 : t.m + 1;
  return fmt(ny, nm, Math.min(billingDay, daysInMonth(ny, nm)));
}

export type NextBilling = { date: string; daysUntil: number; total: number; names: string[] };
/** The soonest upcoming charge date (all rentals billed that day are merged); null without any billing day. */
export function nextBilling(schedule: BillingSchedule, today: string): NextBilling | null {
  const dated = schedule.items.filter((i) => i.billingDay !== null && i.billingDay >= 1 && i.billingDay <= 31);
  if (dated.length === 0) return null;
  const withDate = dated.map((i) => ({ i, date: nextBillingDate(i.billingDay as number, today) }));
  const first = withDate.reduce((m, x) => (x.date < m ? x.date : m), withDate[0].date);
  const group = withDate.filter((x) => x.date === first).map((x) => x.i);
  return { date: first, daysUntil: daysBetween(first, today), total: group.reduce((s, i) => s + (i.fee ?? 0), 0), names: group.map((i) => i.name) };
}

// ---------------------------------------------------------------- ② ownership transfers & obligation ends
export type TransferEvent = {
  assetId: string;
  name: string;
  date: string;
  daysUntil: number;
  fee: number | null; // monthly fee that stops
  monthlyAfter: number; // projected monthly rental total once this (and every earlier) transfer happened
};
export type ObligationEvent = { assetId: string; name: string; date: string; daysUntil: number; fee: number | null };
export type SavingsForecast = {
  transfers: TransferEvent[]; // upcoming (date >= today), soonest first
  passedTransfers: { assetId: string; name: string; date: string; fee: number | null }[]; // date already passed but still registered as rental
  obligations: ObligationEvent[]; // upcoming obligation ends, soonest first
  totalMonthlyReduction: number; // sum of the fees that stop with the upcoming transfers
  yearlyReduction: number; // x12
  currentMonthly: number;
  finalMonthly: number; // after every upcoming transfer
};

export function buildSavingsForecast(assets: AnalyticsAsset[], today: string): SavingsForecast {
  const rentals = assets.filter(isRental);
  const currentMonthly = rentals.reduce((s, a) => s + (a.monthly_fee ?? 0), 0);

  const upcoming = rentals
    .filter((a) => a.ownership_transfer_date && a.ownership_transfer_date >= today)
    .sort((a, b) => (a.ownership_transfer_date as string).localeCompare(b.ownership_transfer_date as string) || a.name.localeCompare(b.name, "ko"));
  let running = currentMonthly;
  const transfers: TransferEvent[] = upcoming.map((a) => {
    running -= a.monthly_fee ?? 0;
    const date = a.ownership_transfer_date as string;
    return { assetId: a.id, name: a.name, date, daysUntil: daysBetween(date, today), fee: a.monthly_fee ?? null, monthlyAfter: running };
  });

  const passedTransfers = rentals
    .filter((a) => a.ownership_transfer_date && a.ownership_transfer_date < today)
    .map((a) => ({ assetId: a.id, name: a.name, date: a.ownership_transfer_date as string, fee: a.monthly_fee ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const obligations: ObligationEvent[] = rentals
    .filter((a) => a.obligation_end_date && a.obligation_end_date >= today)
    .map((a) => ({ assetId: a.id, name: a.name, date: a.obligation_end_date as string, daysUntil: daysBetween(a.obligation_end_date as string, today), fee: a.monthly_fee ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));

  const totalMonthlyReduction = currentMonthly - running;
  return { transfers, passedTransfers, obligations, totalMonthlyReduction, yearlyReduction: totalMonthlyReduction * 12, currentMonthly, finalMonthly: running };
}

// ---------------------------------------------------------------- ③ quarterly consumable / maintenance outlook
export type QuarterBucket = {
  label: string; // '2026 Q4'
  start: string;
  end: string;
  consumable: number; // occurrences of rules that have consumable info
  other: number; // occurrences of the remaining recurring rules
  total: number;
};
export type QuarterOutlook = { quarters: QuarterBucket[]; maxTotal: number; unscheduledRules: number };

const quarterOf = (y: number, m: number) => ({ y, q: Math.floor((m - 1) / 3) });
const quarterStart = (y: number, q: number) => fmt(y, q * 3 + 1, 1);
const quarterEnd = (y: number, q: number) => fmt(y, q * 3 + 3, daysInMonth(y, q * 3 + 3));

/**
 * Next 4 CALENDAR quarters starting with the one containing `today`. Each recurring rule is projected from its
 * earliest open task (the anchor): an overdue open task counts once in the current quarter, later occurrences are
 * anchor + k*interval (month math clamps to month end). Rules without an open task cannot be projected and are
 * reported in `unscheduledRules`. There is no price data in the app, so this counts occurrences — not money.
 */
export function buildQuarterOutlook(assets: AnalyticsAsset[], today: string): QuarterOutlook {
  const t = parse(today);
  const cur = quarterOf(t.y, t.m);
  const quarters: QuarterBucket[] = Array.from({ length: 4 }, (_, i) => {
    const idx = cur.y * 4 + cur.q + i;
    const y = Math.floor(idx / 4);
    const q = idx % 4;
    return { label: `${y} Q${q + 1}`, start: quarterStart(y, q), end: quarterEnd(y, q), consumable: 0, other: 0, total: 0 };
  });
  const horizonEnd = quarters[3].end;
  const bucketFor = (date: string) => quarters.find((b) => date >= b.start && date <= b.end);

  let unscheduledRules = 0;
  for (const a of assets) {
    for (const rule of a.task_rules) {
      if (rule.recurring_type === "NONE") continue;
      const dues = a.tasks.filter((x) => x.rule_id === rule.id).map((x) => x.due_date).sort();
      if (dues.length === 0) {
        unscheduledRules++;
        continue;
      }
      const hasConsumable = !!(rule.consumable_name?.trim() || rule.consumable_model?.trim());
      const add = (date: string) => {
        const b = bucketFor(date);
        if (!b) return;
        if (hasConsumable) b.consumable++;
        else b.other++;
        b.total++;
      };
      const n = Math.max(1, rule.interval_n);
      const anchor = dues[0];
      let k = 0;
      if (anchor < today) {
        add(today); // the overdue instance still has to be done: it lands in the current quarter
        while ((occurrence(anchor, rule.recurring_type, n, k) as string) < today) k++;
      }
      for (let guard = 0; guard < 2000; guard++, k++) {
        const d = occurrence(anchor, rule.recurring_type, n, k) as string;
        if (d > horizonEnd) break;
        add(d); // here d >= today always (skipped past occurrences above)
      }
    }
  }
  return { quarters, maxTotal: Math.max(0, ...quarters.map((b) => b.total)), unscheduledRules };
}

// ---------------------------------------------------------------- ④ distribution by space / category
export type DistributionRow = { key: string; total: number; owned: number; rental: number };
export type Distribution = {
  total: number;
  owned: number;
  rental: number;
  rentalPct: number; // 0..100, rounded
  bySpace: DistributionRow[];
  byCategory: DistributionRow[];
};

function group(assets: AnalyticsAsset[], pick: (a: AnalyticsAsset) => string | null, fallback: string): DistributionRow[] {
  const map = new Map<string, DistributionRow>();
  for (const a of assets) {
    const key = pick(a)?.trim() || fallback;
    const row = map.get(key) ?? { key, total: 0, owned: 0, rental: 0 };
    row.total++;
    if (isRental(a)) row.rental++;
    else row.owned++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, "ko"));
}

export function buildDistribution(assets: AnalyticsAsset[]): Distribution {
  const rental = assets.filter(isRental).length;
  const total = assets.length;
  return {
    total,
    owned: total - rental,
    rental,
    rentalPct: total === 0 ? 0 : Math.round((rental / total) * 100),
    bySpace: group(assets, (a) => a.space, "미지정"),
    byCategory: group(assets, (a) => a.category, "미분류"),
  };
}

// ---------------------------------------------------------------- everything the page needs
export type AnalyticsReport = {
  today: string;
  billing: BillingSchedule;
  nextBilling: NextBilling | null;
  savings: SavingsForecast;
  quarters: QuarterOutlook;
  distribution: Distribution;
};

export function buildAnalyticsReport(assets: AnalyticsAsset[], today: string): AnalyticsReport {
  const billing = buildBillingSchedule(assets);
  return {
    today,
    billing,
    nextBilling: nextBilling(billing, today),
    savings: buildSavingsForecast(assets, today),
    quarters: buildQuarterOutlook(assets, today),
    distribution: buildDistribution(assets),
  };
}
