// Expiry maths: D-Day, urgency, the 3-colour traffic light and "freezer fossil" detection (CookSaver `index.html` +
// `bulk.is_fossil`). Pure: `today` is always passed in as a 'YYYY-MM-DD' Asia/Seoul calendar date.
import { daysBetween, isValidDate, toDateOnly } from "./date-utils.ts";
import type { StorageType } from "./shelf-life.ts";

/** D-3 or fewer days left (including already expired) counts as urgent. */
export const URGENT_DAYS = 3;
/** Frozen for this many days or more -> "fossil". */
export const FOSSIL_DAYS = 30;

/** Days from `today` to `expireDate`: 0 = today, positive = days left, NEGATIVE = already expired. null for an invalid date. */
export function dday(expireDate: string, today: string): number | null {
  if (!isValidDate(expireDate) || !isValidDate(today)) return null;
  return daysBetween(expireDate, today);
}

/** 0 -> "D-Day", 5 -> "D-5", -2 -> "D+2". */
export function ddayLabel(n: number): string {
  return n === 0 ? "D-Day" : n > 0 ? `D-${n}` : `D+${Math.abs(n)}`;
}

export const isUrgent = (n: number): boolean => n <= URGENT_DAYS;

export type TrafficLight = "red" | "yellow" | "green";

/** red <= 2 days (expired included) · yellow <= 7 · green otherwise. */
export function trafficLight(n: number): TrafficLight {
  return n <= 2 ? "red" : n <= 7 ? "yellow" : "green";
}

export type ExpiryInfo = { days: number; label: string; light: TrafficLight; urgent: boolean; expired: boolean };

/** Everything the UI needs for one item; null when `expireDate` is not a real date. */
export function expiryInfo(expireDate: string, today: string): ExpiryInfo | null {
  const days = dday(expireDate, today);
  if (days === null) return null;
  return { days, label: ddayLabel(days), light: trafficLight(days), urgent: isUrgent(days), expired: days < 0 };
}

/** Days since the item went into the freezer (`addedAt` may be a date or an ISO timestamp); null if unknown/invalid. */
export function frozenDays(addedAt: string | null | undefined, today: string): number | null {
  const start = toDateOnly(addedAt);
  if (!start || !isValidDate(today)) return null;
  return daysBetween(today, start);
}

/** A "freezer fossil": in the FREEZER for FOSSIL_DAYS or more. A future / missing / invalid added date is never a fossil. */
export function isFossil(item: { storage_type: StorageType; added_at?: string | null }, today: string): boolean {
  if (item.storage_type !== "FREEZER") return false;
  const days = frozenDays(item.added_at, today);
  return days !== null && days >= FOSSIL_DAYS;
}
