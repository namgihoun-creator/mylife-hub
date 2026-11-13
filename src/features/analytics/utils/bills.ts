// Monthly utility-bill maths (pure; node:test imports it).
import { BILL_TYPES, type BillType } from "../schemas/bill.schema.ts";
import { prevMonth } from "./month.ts";

export type BillLike = { bill_type: string; billing_month: string; amount: number };

export type BillSummary = {
  month: string;
  total: number;
  count: number;
  /** total of the previous calendar month (0 when it has no bills) */
  prevTotal: number;
  prevCount: number;
  /** total - prevTotal (null when the previous month has no bills: nothing to compare with) */
  diff: number | null;
  /** diff as a percentage of the previous total, one decimal (null when there is nothing to compare or prevTotal is 0) */
  diffPct: number | null;
  byType: { type: BillType; total: number; count: number }[];
};

const known = (t: string): BillType => ((BILL_TYPES as readonly string[]).includes(t) ? (t as BillType) : "ETC");

/** Totals of one month, the change against the month before, and the split by bill type (largest first). */
export function summarizeBills(bills: readonly BillLike[] | null | undefined, month: string): BillSummary {
  const prev = prevMonth(month);
  let total = 0, count = 0, prevTotal = 0, prevCount = 0;
  const per = new Map<BillType, { total: number; count: number }>();
  for (const b of bills ?? []) {
    const amount = Number.isFinite(b.amount) && b.amount > 0 ? Math.round(b.amount) : 0;
    if (b.billing_month === month) {
      total += amount;
      count += 1;
      const t = known(b.bill_type);
      const cur = per.get(t) ?? { total: 0, count: 0 };
      per.set(t, { total: cur.total + amount, count: cur.count + 1 });
    } else if (b.billing_month === prev) {
      prevTotal += amount;
      prevCount += 1;
    }
  }
  const comparable = prevCount > 0;
  return {
    month,
    total,
    count,
    prevTotal,
    prevCount,
    diff: comparable ? total - prevTotal : null,
    diffPct: comparable && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
    byType: [...per].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type)),
  };
}

/** "+12,300원 (▲ 8.4%)" / "-5,000원 (▼ 3.1%)" / "전월과 같아요"; null diff -> "전월 기록 없음". */
export function diffText(s: Pick<BillSummary, "diff" | "diffPct">): string {
  if (s.diff === null) return "전월 기록 없음";
  if (s.diff === 0) return "전월과 같아요";
  const sign = s.diff > 0 ? "+" : "-";
  const won = `${sign}${Math.abs(s.diff).toLocaleString("ko-KR")}원`;
  return s.diffPct === null ? won : `${won} (${s.diff > 0 ? "▲" : "▼"} ${Math.abs(s.diffPct)}%)`;
}
