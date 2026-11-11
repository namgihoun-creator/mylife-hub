// Moving an item between FRIDGE / FREEZER / ROOM_TEMP: which expiry date and "storage start" date it gets afterwards.
// Pure; `today` is passed in. Conservative by design — moving never makes an unsafe item look safe.
import { addDays } from "./date-utils.ts";
import { DEFAULT_DAYS, dictionaryDays, type StorageType } from "./shelf-life.ts";

/** Money counted as "saved" when an item is used up instead of thrown away (CookSaver's fixed estimate). */
export const SAVED_WON_PER_RESCUE = 3000;

export type MoveResult = {
  storage_type: StorageType;
  expire_date: string;
  /** Start of the CURRENT storage period (restarts the freezer-fossil clock when an item goes into the freezer). */
  added_at: string;
};

/**
 * New dates for `item` after moving it to `to`; null when it is already there.
 *  - into the FREEZER: expiry = today + frozen days (dictionary, else 30) — freezing extends the life,
 *    EXCEPT an already-expired item keeps its old date (freezing does not rescue spoiled food);
 *  - anywhere else (thawing, fridge <-> pantry): expiry = the EARLIER of the old date and today + that place's days,
 *    so a move never extends the life.
 */
export function moveStorage(item: { name: string; storage_type: StorageType; expire_date: string }, to: StorageType, today: string): MoveResult | null {
  if (item.storage_type === to) return null;
  const target = addDays(today, dictionaryDays(item.name, to) ?? DEFAULT_DAYS[to]);
  const alreadyExpired = item.expire_date < today;
  let expire = item.expire_date;
  if (to === "FREEZER") {
    if (!alreadyExpired) expire = target;
  } else if (target < expire) {
    expire = target;
  }
  return { storage_type: to, expire_date: expire, added_at: today };
}
