import { dday, URGENT_DAYS } from "@/features/kitchen/rules/expiry";
import { kitchenContext, seoulToday } from "@/features/kitchen/server/kitchen-context";
import type { FridgeStock } from "../utils/fridge";

/** How many items the household's kitchen holds and how many are D-3 or already expired; null when it cannot be read. */
export async function getFridgeStock(): Promise<FridgeStock | null> {
  const c = await kitchenContext();
  if (!c.ok) return null;
  const { data, error } = await c.ctx.supabase.from("kitchen_items").select("expire_date").limit(1000);
  if (error || !data) return null; // e.g. the kitchen tables are not there yet: the chip simply does not show
  const today = seoulToday();
  let urgent = 0;
  for (const r of data) {
    const d = dday(r.expire_date as string, today);
    if (d !== null && d <= URGENT_DAYS) urgent++;
  }
  return { total: data.length, urgent };
}
