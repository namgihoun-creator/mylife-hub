"use server";

import { revalidatePath } from "next/cache";
import { dday, isFossil, URGENT_DAYS } from "../rules/expiry";
import { toxicMatch } from "../rules/pet-safety";
import { defaultExpireDate, STORAGE_LABEL, type StorageType } from "../rules/shelf-life";
import { moveStorage, SAVED_WON_PER_RESCUE } from "../rules/storage-move";
import { adjustProfileCounters, kitchenContext as context, seoulToday } from "./kitchen-context";
import {
  DEFAULT_KITCHEN_PROFILE,
  createKitchenItemSchema,
  kitchenIdSchema,
  moveKitchenItemSchema,
  petTypeSchema,
  updateKitchenItemSchema,
  type KitchenActionResult,
  type KitchenDashboardData,
  type KitchenItem,
  type KitchenProfile,
} from "../schemas/kitchen.schema";

// Every action runs under the caller's JWT: RLS (current_household_id()) is the real household boundary. Kitchen data is
// shared by all household members, so no role check is needed — only a signed-in member of a household.

const ITEM_COLUMNS = "id, name, amount, storage_type, spot, expire_date, added_at, is_pet, memo, created_at";
const PROFILE_COLUMNS = "pet_type, human_monthly_budget, pet_monthly_budget, rescued_count, discarded_count, saved_money";
const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");
const revalidate = () => revalidatePath("/kitchen");

// ---------------------------------------------------------------------------------------------- read
/** Items (soonest expiry first), kitchen profile (defaults if none yet) and the headline numbers for the dashboard. */
export async function getKitchenDashboardData(): Promise<KitchenActionResult<{ data: KitchenDashboardData }>> {
  const c = await context();
  if (!c.ok) return c;
  const { supabase } = c.ctx;

  const [itemsRes, profileRes] = await Promise.all([
    supabase.from("kitchen_items").select(ITEM_COLUMNS).order("expire_date", { ascending: true }).order("name", { ascending: true }),
    supabase.from("kitchen_profiles").select(PROFILE_COLUMNS).maybeSingle(),
  ]);
  if (itemsRes.error) return { ok: false, error: "재료 목록을 불러오지 못했어요." };
  if (profileRes.error) return { ok: false, error: "키친 정보를 불러오지 못했어요." };

  const today = seoulToday();
  const items = (itemsRes.data ?? []) as KitchenItem[];
  const raw = profileRes.data as (Omit<KitchenProfile, "saved_money"> & { saved_money: number | string }) | null;
  const profile: KitchenProfile = raw ? { ...raw, saved_money: Number(raw.saved_money) } : { ...DEFAULT_KITCHEN_PROFILE };

  let urgent = 0, expired = 0, fossil = 0;
  for (const it of items) {
    const d = dday(it.expire_date, today);
    if (d !== null) {
      if (d <= URGENT_DAYS) urgent++;
      if (d < 0) expired++;
    }
    if (isFossil(it, today)) fossil++;
  }
  const toxicItems =
    profile.pet_type === "none"
      ? []
      : items.flatMap((it) => {
          const match = toxicMatch(it.name);
          return match ? [{ id: it.id, name: it.name, match }] : [];
        });

  return { ok: true, data: { today, profile, items, stats: { total: items.length, urgent, expired, fossil }, toxicItems } };
}

// ---------------------------------------------------------------------------------------------- create
/**
 * New ingredient. When `expireDate` is omitted the default comes from the 50-ingredient shelf-life dictionary
 * (storage place inferred from the name unless `storageType` is given). The result says where the date came from.
 */
export async function createKitchenItem(input: unknown): Promise<KitchenActionResult<{ item: KitchenItem; suggestion: { days: number; source: "dictionary" | "default" | "manual" } }>> {
  const parsed = createKitchenItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;
  const c = await context();
  if (!c.ok) return c;

  const today = seoulToday();
  const fallback = defaultExpireDate(v.name, today, v.storageType);
  const storage: StorageType = v.storageType ?? fallback.storage;
  const expire = v.expireDate ?? fallback.expireDate;

  const { data, error } = await c.ctx.supabase
    .from("kitchen_items")
    .insert({ household_id: c.ctx.householdId, name: v.name, amount: v.amount, storage_type: storage, spot: v.spot, expire_date: expire, added_at: today, is_pet: v.isPet, memo: v.memo })
    .select(ITEM_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "재료를 등록하지 못했어요." };
  revalidate();
  return { ok: true, item: data as KitchenItem, suggestion: { days: fallback.days, source: v.expireDate ? "manual" : fallback.source } };
}

// ---------------------------------------------------------------------------------------------- update
/** Edit amount, spot (보관 위치 메모) and/or expiry date. Moving between fridge/freezer/room is `moveStorageKitchenItem`. */
export async function updateKitchenItem(input: unknown): Promise<KitchenActionResult<{ item: KitchenItem }>> {
  const parsed = updateKitchenItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;
  const c = await context();
  if (!c.ok) return c;

  const patch: Record<string, unknown> = {};
  if (v.amount !== undefined) patch.amount = v.amount;
  if (v.spot !== undefined) patch.spot = v.spot;
  if (v.expireDate !== undefined) patch.expire_date = v.expireDate;
  if (v.memo !== undefined) patch.memo = v.memo;

  const { data, error } = await c.ctx.supabase.from("kitchen_items").update(patch).eq("id", v.id).select(ITEM_COLUMNS);
  if (error) return { ok: false, error: "재료를 수정하지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "재료를 찾을 수 없어요." };
  revalidate();
  return { ok: true, item: data[0] as KitchenItem };
}

// ---------------------------------------------------------------------------------------------- delete
/** Plain delete: no statistics change (use consume when the food was actually eaten). */
export async function deleteKitchenItem(input: unknown): Promise<KitchenActionResult> {
  const parsed = kitchenIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("kitchen_items").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: "재료를 삭제하지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "재료를 찾을 수 없어요." };
  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------- consume
/** "다 먹었어요": delete the item, then rescued_count + 1 and saved_money + 3,000 on the household profile. */
export async function consumeKitchenItem(input: unknown): Promise<KitchenActionResult<{ savedWon: number }>> {
  const parsed = kitchenIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;

  // Delete first and use its result as proof: a row that is gone / not ours can never be credited twice.
  const { data, error } = await c.ctx.supabase.from("kitchen_items").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: "재료를 처리하지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "재료를 찾을 수 없어요. 이미 처리됐을 수 있어요." };

  const credited = await adjustProfileCounters(c.ctx.supabase, c.ctx.householdId, { rescued: 1, savedWon: SAVED_WON_PER_RESCUE });
  if (!credited) console.error("kitchen: item consumed but the savings credit could not be written", parsed.data.id);
  revalidate();
  return { ok: true, savedWon: credited ? SAVED_WON_PER_RESCUE : 0 };
}

// ---------------------------------------------------------------------------------------------- move
/** Fridge <-> freezer <-> room: new storage place, new expiry (see rules/storage-move.ts) and a fresh storage-start date. */
export async function moveStorageKitchenItem(input: unknown): Promise<KitchenActionResult<{ item: KitchenItem; label: string }>> {
  const parsed = moveKitchenItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { supabase } = c.ctx;

  const { data: cur, error: curErr } = await supabase.from("kitchen_items").select("name, storage_type, expire_date").eq("id", parsed.data.id).maybeSingle();
  if (curErr) return { ok: false, error: "재료를 불러오지 못했어요." };
  if (!cur) return { ok: false, error: "재료를 찾을 수 없어요." };

  const next = moveStorage({ name: cur.name, storage_type: cur.storage_type as StorageType, expire_date: cur.expire_date }, parsed.data.storageType, seoulToday());
  if (!next) return { ok: false, error: `이미 ${STORAGE_LABEL[parsed.data.storageType]}에 있어요.` };

  // `.eq("storage_type", old)` makes a concurrent double-move a no-op instead of overwriting the other member's move.
  const { data, error } = await supabase.from("kitchen_items").update(next).eq("id", parsed.data.id).eq("storage_type", cur.storage_type).select(ITEM_COLUMNS);
  if (error) return { ok: false, error: "보관 위치를 바꾸지 못했어요." };
  if (!data || data.length === 0) return { ok: false, error: "다른 곳에서 먼저 바뀌었어요. 새로고침해 주세요." };
  revalidate();
  return { ok: true, item: data[0] as KitchenItem, label: STORAGE_LABEL[parsed.data.storageType] };
}

// ---------------------------------------------------------------------------------------------- pet profile
/** Household pet setting (drives the toxic-food banner). Creates the kitchen profile on first use. */
export async function setKitchenPetType(input: unknown): Promise<KitchenActionResult> {
  const parsed = petTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { error } = await c.ctx.supabase.from("kitchen_profiles").upsert({ household_id: c.ctx.householdId, pet_type: parsed.data.petType }, { onConflict: "household_id" });
  if (error) return { ok: false, error: "반려동물 설정을 저장하지 못했어요." };
  revalidate();
  return { ok: true };
}
