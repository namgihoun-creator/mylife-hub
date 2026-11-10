import { diffDays, getDDay, type DDay } from "@/shared/lib/dday";
import type { Asset } from "../schemas/asset.schema";

/** 32900 -> "32,900원" */
export const formatWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 'YYYY-MM-DD' -> '2027.01.01' */
export const formatDotDate = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;

export type ObligationInfo = {
  dday: DDay;
  /** "약정 만료까지 D-45" / "약정 만료일이에요" / "약정이 12일 전에 만료됐어요" / "약정 정보가 없어요" */
  text: string;
  expired: boolean;
};

/** Remaining obligation period, from the Seoul calendar date (same D-Day rules as the task badges). */
export function obligationInfo(endDate: string | null | undefined, today: string): ObligationInfo {
  const dday = getDDay(endDate, today);
  if (!endDate) return { dday, text: "약정 정보가 없어요", expired: false };
  if (dday.days === 0) return { dday, text: "오늘이 약정 만료일이에요", expired: false };
  if (dday.days !== null && dday.days < 0) return { dday, text: `약정이 ${-dday.days}일 전에 만료됐어요`, expired: true };
  return { dday, text: `약정 만료까지 ${dday.label}`, expired: false };
}

/** Elapsed share of the contract (0..100) when both dates are known and ordered, else null. */
export function contractProgress(start: string | null, end: string | null, today: string): number | null {
  if (!start || !end) return null;
  const total = diffDays(end, start);
  if (total <= 0) return null;
  const elapsed = diffDays(today, start);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export const isRentalAsset = (a: Pick<Asset, "ownership_type">) => a.ownership_type === "RENTAL";

export type RentalSummary = { count: number; monthlyTotal: number; missingFee: number };

/** Monthly rental spend over the assets the user can see; rentals without a fee are counted but not summed. */
export function summarizeRentals(assets: Pick<Asset, "ownership_type" | "monthly_fee">[]): RentalSummary {
  let count = 0;
  let monthlyTotal = 0;
  let missingFee = 0;
  for (const a of assets) {
    if (a.ownership_type !== "RENTAL") continue;
    count++;
    if (a.monthly_fee === null || a.monthly_fee === undefined) missingFee++;
    else monthlyTotal += a.monthly_fee;
  }
  return { count, monthlyTotal, missingFee };
}
