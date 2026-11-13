// 'YYYY-MM' helpers (pure; Asia/Seoul calendar months). Imported by the bill and settlement code and by node:test.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (s: unknown): s is string => typeof s === "string" && MONTH.test(s);

const pad = (n: number) => String(n).padStart(2, "0");

export function shiftMonth(month: string, delta: number): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
export const prevMonth = (month: string) => shiftMonth(month, -1);
export const nextMonth = (month: string) => shiftMonth(month, 1);

/** The month of a 'YYYY-MM-DD' date. */
export const monthOf = (date: string) => date.slice(0, 7);

/**
 * First/last calendar day of the month and the half-open UTC instants [startIso, endIso) of that Seoul month (UTC+9, no DST),
 * for filtering timestamptz columns such as event_logs.created_at.
 */
export function monthRange(month: string): { start: string; end: string; startIso: string; endIso: string } | null {
  const m = MONTH.exec(month);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const next = nextMonth(month);
  return { start: `${month}-01`, end: `${month}-${pad(last)}`, startIso: `${month}-01T00:00:00+09:00`, endIso: `${next}-01T00:00:00+09:00` };
}

/** "2026년 11월" */
export const monthLabel = (month: string) => (isMonth(month) ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월` : month);

/** The month to show: the requested one when valid and not in the future, otherwise the current Seoul month. */
export function pickMonth(requested: unknown, currentMonth: string): string {
  return isMonth(requested) && requested <= currentMonth ? requested : currentMonth;
}
