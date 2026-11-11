// Calendar-date helpers for the kitchen rules. Dates are 'YYYY-MM-DD' strings (the Asia/Seoul calendar day);
// all arithmetic happens in UTC on whole days, so there is no timezone / DST drift and leap years come out right.
// The rules in this folder are PURE (no I/O, no clock): callers pass `today`.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a REAL calendar date ('2027-02-29' is rejected, '2028-02-29' is accepted). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 'YYYY-MM-DD' or an ISO timestamp ('2026-11-09T03:00:00Z') -> its date part; anything else / impossible dates -> null. */
export function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const head = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(value) ? value.slice(0, 10) : value;
  return isValidDate(head) ? head : null;
}

const utc = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(to: string, from: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** `date` + n days (n may be negative). */
export function addDays(date: string, n: number): string {
  const t = new Date(utc(date) + n * 86_400_000);
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
