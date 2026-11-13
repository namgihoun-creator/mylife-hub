"use server";

import { revalidatePath } from "next/cache";
import { defaultExpireDate } from "../rules/shelf-life";
import { kitchenContext as context, seoulToday } from "./kitchen-context";
import {
  addShoppingItemSchema,
  sameName,
  shoppingIdSchema,
  toggleShoppingSchema,
  type ShoppingItem,
  type ShoppingResult,
} from "../schemas/shopping.schema";
import { kitchenIdSchema } from "../schemas/kitchen.schema";

// The couple's shared shopping list (shopping_items, migration 18). Every query runs under the caller's JWT, so RLS
// (current_household_id()) is the household boundary. Before the migration is applied the table does not exist: reads and writes
// answer `notReady` instead of failing, and the 장보기 tab shows a short "준비 중" note.

const COLUMNS = "id, name, quantity, category, is_checked, source_type, created_by, created_at";
const NOT_READY = "장보기 리스트가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.";
const revalidate = () => revalidatePath("/kitchen");
const ordered = (rows: ShoppingItem[]) => [...rows].sort((a, b) => Number(a.is_checked) - Number(b.is_checked) || a.created_at.localeCompare(b.created_at));

export async function getShoppingItems(): Promise<ShoppingResult<{ items: ShoppingItem[] }>> {
  const c = await context();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("shopping_items").select(COLUMNS).order("created_at", { ascending: true }).limit(300);
  if (error) return { ok: false, error: NOT_READY, notReady: true };
  return { ok: true, items: ordered((data ?? []) as ShoppingItem[]) };
}

/** Add one item. An unchecked item with the same name is not duplicated (returns it with `duplicate: true`). */
export async function addShoppingItem(input: unknown): Promise<ShoppingResult<{ item: ShoppingItem; duplicate: boolean }>> {
  const parsed = addShoppingItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { supabase, householdId, userId } = c.ctx;
  const v = parsed.data;

  const open = await supabase.from("shopping_items").select(COLUMNS).eq("is_checked", false).limit(300);
  if (open.error) return { ok: false, error: NOT_READY, notReady: true };
  const dup = ((open.data ?? []) as ShoppingItem[]).find((r) => sameName(r.name, v.name));
  if (dup) return { ok: true, item: dup, duplicate: true };

  const { data, error } = await supabase
    .from("shopping_items")
    .insert({ household_id: householdId, created_by: userId, name: v.name, quantity: v.quantity, source_type: v.sourceType })
    .select(COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "장보기 리스트에 담지 못했어요." };
  revalidate();
  return { ok: true, item: data as ShoppingItem, duplicate: false };
}

/** Put an ingredient of the 보관함 on the list ([+ 장보기] pill): its name and amount are read from the stored item. */
export async function addKitchenItemToShopping(input: unknown): Promise<ShoppingResult<{ item: ShoppingItem; duplicate: boolean }>> {
  const parsed = kitchenIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { data: it } = await c.ctx.supabase.from("kitchen_items").select("name, amount").eq("id", parsed.data.id).maybeSingle();
  if (!it) return { ok: false, error: "재료를 찾을 수 없어요. 이미 정리됐을 수 있어요." };
  return addShoppingItem({ name: it.name, quantity: it.amount, sourceType: "KITCHEN_EXPIRING" });
}

export async function toggleShoppingItem(input: unknown): Promise<ShoppingResult<{ item: ShoppingItem }>> {
  const parsed = toggleShoppingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("shopping_items").update({ is_checked: parsed.data.checked }).eq("id", parsed.data.id).select(COLUMNS).maybeSingle();
  if (error) return { ok: false, error: "체크하지 못했어요." };
  if (!data) return { ok: false, error: "이미 지워진 품목이에요." };
  return { ok: true, item: data as ShoppingItem };
}

export async function deleteShoppingItem(input: unknown): Promise<ShoppingResult> {
  const parsed = shoppingIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await context();
  if (!c.ok) return c;
  const { error } = await c.ctx.supabase.from("shopping_items").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: "지우지 못했어요." };
  revalidate();
  return { ok: true };
}

/** [체크된 항목 비우기]: delete every checked item of the household. */
export async function clearCheckedShopping(): Promise<ShoppingResult<{ removed: number }>> {
  const c = await context();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("shopping_items").delete().eq("is_checked", true).select("id");
  if (error) return { ok: false, error: "비우지 못했어요." };
  revalidate();
  return { ok: true, removed: data?.length ?? 0 };
}

/**
 * [장본 품목 보관함으로 바로 입고]: every checked item becomes a kitchen_items row (storage place and expiry from the 50-ingredient
 * dictionary, amount = the listed quantity), then the checked rows leave the list. The insert is one statement: if it fails nothing is
 * removed from the list.
 */
export async function stockCheckedShopping(): Promise<ShoppingResult<{ stocked: number; summary: { FRIDGE: number; FREEZER: number; ROOM_TEMP: number } }>> {
  const c = await context();
  if (!c.ok) return c;
  const { supabase, householdId } = c.ctx;
  const { data: checked, error } = await supabase.from("shopping_items").select(COLUMNS).eq("is_checked", true).limit(100);
  if (error) return { ok: false, error: NOT_READY, notReady: true };
  const rows = (checked ?? []) as ShoppingItem[];
  if (rows.length === 0) return { ok: false, error: "체크한 품목이 없어요." };

  const today = seoulToday();
  const summary = { FRIDGE: 0, FREEZER: 0, ROOM_TEMP: 0 };
  const inserts = rows.map((r) => {
    const d = defaultExpireDate(r.name, today);
    summary[d.storage] += 1;
    return { household_id: householdId, name: r.name, amount: r.quantity || "1개", storage_type: d.storage, spot: null, expire_date: d.expireDate, added_at: today, is_pet: false, memo: null };
  });
  const ins = await supabase.from("kitchen_items").insert(inserts).select("id");
  if (ins.error) return { ok: false, error: "보관함에 입고하지 못했어요." };
  const del = await supabase.from("shopping_items").delete().in("id", rows.map((r) => r.id));
  revalidate();
  if (del.error) return { ok: true, stocked: rows.length, summary }; // stocked; the checked rows can be cleared by hand
  return { ok: true, stocked: rows.length, summary };
}
