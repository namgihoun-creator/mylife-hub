"use server";

import { revalidatePath } from "next/cache";
import { rateLimit } from "@/shared/lib/rate-limit";
import { defaultExpireDate, type StorageType } from "../rules/shelf-life";
import { SAVED_WON_PER_RESCUE, moveStorage } from "../rules/storage-move";
import { MAX_MEMO } from "../rules/kitchen-budget";
import { describePlanRow, reduceQuantity, type CheckoutPlanRow, type InventoryRef } from "../rules/smart-checkout-rules";
import {
  analyzeImageSchema,
  batchCreateSchema,
  executeCheckoutSchema,
  smartCheckoutTextSchema,
  type KitchenActionResult,
} from "../schemas/kitchen.schema";
import { analyzeImage, checkImage, parseCheckoutCommand, type ImageAnalysis, type ImageMime } from "./gemini-kitchen";
import { adjustProfileCounters, kitchenContext, seoulToday } from "./kitchen-context";
import { EST_WASTE_WON, logKitchenActivity } from "./kitchen-activity";

// Zero-typing pipelines: (1) photo -> items -> one-shot intake, (2) a spoken/typed sentence -> actions -> one-shot apply.
// Every query runs under the caller's JWT (RLS = household boundary). The AI never writes anything: it only PROPOSES
// rows; the browser shows them for confirmation and the batch actions below re-validate everything server-side.

const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");
const revalidate = () => revalidatePath("/kitchen");

const tooMany = (retryAfterSec: number): { ok: false; error: string } => ({ ok: false, error: `잠깐 너무 많이 눌렀어요. ${retryAfterSec}초 뒤에 다시 해 보세요.` });

// ---------------------------------------------------------------------------------------------- 1. photo
/** Compressed photo (base64) -> proposed items + receipt total. Without a Gemini key the result says so (source 'unavailable'). */
export async function analyzeKitchenImageAction(input: unknown): Promise<KitchenActionResult<{ analysis: ImageAnalysis }>> {
  const parsed = analyzeImageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const c = await kitchenContext();
  if (!c.ok) return c;

  const rl = rateLimit(`kitchen-vision:${c.ctx.userId}`, 10, 60_000); // free-tier quota guard
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  const problem = checkImage(parsed.data.imageBase64, parsed.data.mimeType); // real file header + size, not just the declared type
  if (problem) return { ok: false, error: problem };

  const analysis = await analyzeImage(parsed.data.imageBase64, parsed.data.mimeType as ImageMime, seoulToday());
  return { ok: true, analysis };
}

/**
 * Register the (user-confirmed) photo items in one insert. Each item gets its default expiry from the 50-ingredient
 * dictionary unless a date is given. With `recordTotal`, the receipt total is also written to the expense ledger.
 */
export async function batchCreateKitchenItems(input: unknown): Promise<KitchenActionResult<{ created: number; expenseRecorded: boolean; warning?: string }>> {
  const parsed = batchCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const v = parsed.data;
  const c = await kitchenContext();
  if (!c.ok) return c;
  const { supabase, householdId } = c.ctx;
  const today = seoulToday();

  // Every column is explicit: a bulk insert sends NULL for keys that only some rows carry.
  const rows = v.items.map((it) => {
    const d = defaultExpireDate(it.name, today, it.storageType);
    return {
      household_id: householdId,
      name: it.name,
      amount: it.amount,
      storage_type: it.storageType ?? d.storage,
      spot: null,
      expire_date: it.expireDate ?? d.expireDate,
      added_at: today,
      is_pet: it.isPet,
      memo: null,
    };
  });
  const { data, error } = await supabase.from("kitchen_items").insert(rows).select("id"); // one statement: all items or none
  if (error) return { ok: false, error: "재료를 입고하지 못했어요." };

  let expenseRecorded = false;
  let warning: string | undefined;
  if (v.recordTotal && v.receiptTotal && v.receiptTotal > 0) {
    const category = v.items.every((it) => it.isPet) ? "pet_care" : "human_groceries";
    const exp = await supabase.from("kitchen_expenses").insert({ household_id: householdId, expense_date: today, category, amount: v.receiptTotal, memo: `영수증 입고 ${rows.length}개`.slice(0, MAX_MEMO) });
    if (exp.error) warning = "재료는 입고했지만 결제 금액은 지출에 기록하지 못했어요.";
    else expenseRecorded = true;
  }
  revalidate();
  return { ok: true, created: data?.length ?? rows.length, expenseRecorded, ...(warning ? { warning } : {}) };
}

// ---------------------------------------------------------------------------------------------- 2. "말로 정리"
const ITEM_REF_COLUMNS = "id, name, storage_type, amount, expire_date";

/** Sentence -> proposed actions (consume / move / discard / expense), attached to this household's items. Applies nothing. */
export async function parseSmartCheckoutAction(input: unknown): Promise<KitchenActionResult<{ source: "gemini" | "rules"; note: string; rows: CheckoutPlanRow[]; previews: { text: string; ok: boolean }[] }>> {
  const parsed = smartCheckoutTextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const c = await kitchenContext();
  if (!c.ok) return c;

  const rl = rateLimit(`kitchen-checkout:${c.ctx.userId}`, 40, 60_000);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  const { data, error } = await c.ctx.supabase.from("kitchen_items").select(ITEM_REF_COLUMNS).order("expire_date", { ascending: true }).limit(500);
  if (error) return { ok: false, error: "냉장고 재료를 불러오지 못했어요." };

  const res = await parseCheckoutCommand(parsed.data.text, (data ?? []) as InventoryRef[], seoulToday());
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, source: res.source, note: res.note, rows: res.rows, previews: res.rows.map(describePlanRow) };
}

type ItemState = { id: string; name: string; amount: string; storage_type: StorageType; expire_date: string; deleted: boolean };

export type CheckoutSummary = { consumed: number; reduced: number; moved: number; discarded: number; expenses: number; failed: number; savedWon: number };

/**
 * Apply the confirmed rows to the household in one pass. Effects are RE-COMPUTED here from the stored items (nothing the
 * browser sends about quantities or dates is trusted): consume = deduct, or use up (+3,000원 saved) · move = new place +
 * expiry · discard = delete (+1 discarded) · expense = ledger row. Item deletions are a single statement, the ledger rows
 * a single insert, and the household counters one compare-and-set update. Each row reports its own result.
 */
export async function executeSmartCheckoutBatch(input: unknown): Promise<KitchenActionResult<{ summary: CheckoutSummary; results: { ok: boolean; text: string }[] }>> {
  const parsed = executeCheckoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const c = await kitchenContext();
  if (!c.ok) return c;
  const { supabase, householdId } = c.ctx;
  const today = seoulToday();

  const ids = [...new Set(parsed.data.rows.map((r) => r.itemId).filter((x): x is string => !!x))];
  const state = new Map<string, ItemState>();
  if (ids.length) {
    const { data, error } = await supabase.from("kitchen_items").select(ITEM_REF_COLUMNS).in("id", ids);
    if (error) return { ok: false, error: "냉장고 재료를 불러오지 못했어요." };
    for (const it of data ?? []) state.set(it.id, { ...(it as Omit<ItemState, "deleted">), deleted: false });
  }

  const results: { ok: boolean; text: string }[] = [];
  const consumeIds: string[] = [];
  const discardIds: string[] = [];
  const amountUpdates: { id: string; amount: string }[] = [];
  const moves: { id: string; from: StorageType; patch: { storage_type: StorageType; expire_date: string; added_at: string } }[] = [];
  const expenseRows: { household_id: string; expense_date: string; category: string; amount: number; memo: string }[] = [];
  const fail = (text: string) => results.push({ ok: false, text });

  for (const row of parsed.data.rows) {
    if (row.action === "expense") {
      if (!row.won) { fail(`${row.name} — 금액이 올바르지 않아요`); continue; }
      expenseRows.push({ household_id: householdId, expense_date: today, category: row.category ?? "human_groceries", amount: row.won, memo: row.name.slice(0, MAX_MEMO) });
      results.push({ ok: true, text: `${row.name} ${row.won.toLocaleString("ko-KR")}원 지출 기록` });
      continue;
    }
    const it = row.itemId ? state.get(row.itemId) : undefined;
    if (!it) { fail(`${row.name} — 냉장고에서 찾지 못했어요`); continue; }
    if (it.deleted) { fail(`${it.name} — 이미 앞에서 처리됐어요`); continue; }

    if (row.action === "discard") {
      it.deleted = true;
      discardIds.push(it.id);
      results.push({ ok: true, text: `${it.name} 폐기` });
    } else if (row.action === "consume") {
      const q = reduceQuantity(it.amount, row.amount);
      if (q.left === null) {
        it.deleted = true;
        consumeIds.push(it.id);
        results.push({ ok: true, text: `${it.name} 소진` });
      } else {
        it.amount = q.left;
        amountUpdates.push({ id: it.id, amount: q.left });
        results.push({ ok: true, text: `${it.name} ${row.amount} 차감 (${q.left} 남음)` });
      }
    } else if (row.action === "move" && row.target) {
      const next = moveStorage(it, row.target, today);
      if (!next) { fail(`${it.name} — 이미 그 보관 장소에 있어요`); continue; }
      moves.push({ id: it.id, from: it.storage_type, patch: next });
      it.storage_type = next.storage_type;
      it.expire_date = next.expire_date;
      results.push({ ok: true, text: `${it.name} → ${next.storage_type === "FREEZER" ? "냉동" : next.storage_type === "FRIDGE" ? "냉장" : "실온"} 이동` });
    } else fail(`${row.name} — 처리할 수 없는 항목이에요`);
  }

  // ---- apply
  const sum: CheckoutSummary = { consumed: 0, reduced: 0, moved: 0, discarded: 0, expenses: 0, failed: results.filter((r) => !r.ok).length, savedWon: 0 };

  if (expenseRows.length) {
    const { error } = await supabase.from("kitchen_expenses").insert(expenseRows);
    if (error) { sum.failed += expenseRows.length; results.push({ ok: false, text: "지출을 기록하지 못했어요" }); } else sum.expenses = expenseRows.length;
  }
  const removed = new Set<string>();
  const removeIds = [...consumeIds, ...discardIds];
  if (removeIds.length) {
    const { data, error } = await supabase.from("kitchen_items").delete().in("id", removeIds).select("id");
    if (error) { sum.failed += removeIds.length; results.push({ ok: false, text: "재료를 삭제하지 못했어요" }); } else for (const d of data ?? []) removed.add(d.id);
    // month-end settlement log (best effort, never blocks the checkout)
    await logKitchenActivity(supabase, householdId, c.ctx.userId, [
      ...consumeIds.filter((id) => removed.has(id)).map((id) => ({ kind: "CONSUMED" as const, name: state.get(id)?.name ?? "" })),
      ...discardIds.filter((id) => removed.has(id)).map((id) => ({ kind: "DISCARDED" as const, name: state.get(id)?.name ?? "", estAmount: EST_WASTE_WON })),
    ]);
  }
  for (const u of amountUpdates) {
    const { data, error } = await supabase.from("kitchen_items").update({ amount: u.amount }).eq("id", u.id).select("id");
    if (error || !data?.length) sum.failed++; else sum.reduced++;
  }
  for (const m of moves) {
    // `.eq("storage_type", from)`: a concurrent move by another member is a no-op instead of an overwrite
    const { data, error } = await supabase.from("kitchen_items").update(m.patch).eq("id", m.id).eq("storage_type", m.from).select("id");
    if (error || !data?.length) sum.failed++; else sum.moved++;
  }
  sum.consumed = consumeIds.filter((id) => removed.has(id)).length;
  sum.discarded = discardIds.filter((id) => removed.has(id)).length;
  sum.savedWon = sum.consumed * SAVED_WON_PER_RESCUE;

  const credited = await adjustProfileCounters(supabase, householdId, { rescued: sum.consumed, discarded: sum.discarded, savedWon: sum.savedWon });
  if (!credited) { console.error("kitchen: checkout applied but the household counters could not be updated"); sum.savedWon = 0; }

  revalidate();
  return { ok: true, summary: sum, results };
}
