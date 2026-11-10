import { getDDay } from "@/shared/lib/dday";
import type { Asset } from "../schemas/asset.schema";

/** Earliest open (PENDING/SNOOZED) task of an asset, or null. */
export function nextTaskOf(asset: Asset) {
  const open = asset.tasks.filter((t) => t.status === "PENDING" || t.status === "SNOOZED");
  return open.sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
}

export type AssetSummary = {
  totalAssets: number;
  dueThisMonth: number; // open tasks due up to the end of the current Seoul month (overdue included)
  imminent: number; // open tasks with D <= 7 (overdue included)
  overdue: number;
};

export function summarizeAssets(assets: Asset[], today: string): AssetSummary {
  const month = today.slice(0, 7);
  let dueThisMonth = 0;
  let imminent = 0;
  let overdue = 0;
  for (const asset of assets) {
    for (const t of asset.tasks) {
      if (t.status !== "PENDING" && t.status !== "SNOOZED") continue;
      if (t.due_date.slice(0, 7) <= month) dueThisMonth++;
      const { urgency } = getDDay(t.due_date, today);
      if (urgency === "overdue") overdue++;
      if (urgency === "overdue" || urgency === "soon") imminent++;
    }
  }
  return { totalAssets: assets.length, dueThisMonth, imminent, overdue };
}
