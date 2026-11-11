// "말로 정리" rule parser — port of CookSaver `bulk.parse_checkout_rules` / `gemini._finish_checkout`:
// "대파 1대 쓰고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달" -> [consume, move, expense] actions.
// Works offline and without an AI key. Pure: no I/O, `today` is passed in.
import { MAX_MEMO, MAX_WON, EXPENSE_CATEGORIES, guessExpenseCategory, parseWon, type ExpenseCategory } from "./kitchen-budget.ts";
import { SAVED_WON_PER_RESCUE, moveStorage } from "./storage-move.ts";
import type { StorageType } from "./shelf-life.ts";

export const CHECKOUT_ACTIONS = ["consume", "move", "discard", "expense"] as const;
export type CheckoutActionType = (typeof CHECKOUT_ACTIONS)[number];
export const MAX_CHECKOUT_TEXT = 500;
export const MAX_CHECKOUT_ROWS = 30;

/** Korean storage word -> storage type (and back for display). */
export const STORAGE_FROM_KO: Readonly<Record<string, StorageType>> = { 냉장: "FRIDGE", 냉동: "FREEZER", 실온: "ROOM_TEMP" };
export const STORAGE_TO_KO: Readonly<Record<StorageType, string>> = { FRIDGE: "냉장", FREEZER: "냉동", ROOM_TEMP: "실온" };

/** What the parsers (rules or AI) produce, before it is attached to real kitchen items. */
export type RawCheckoutRow = {
  name: string;
  action: CheckoutActionType;
  /** consume: quantity used ('1대', '' = all) · expense: won */
  amount: string | number;
  /** move only: '냉동' | '냉장' | '실온' */
  target_location: string;
  /** expense only */
  category?: string;
};

/** The slice of a kitchen item the parser needs. */
export type InventoryRef = { id: string; name: string; storage_type: StorageType; amount: string; expire_date: string };

// ---------------------------------------------------------------------------------------------- regex rules
const DISCARD = /버렸|버림|버리|폐기|상했|상해|쓰레기|곰팡이/;
const MOVE = /(냉동|냉장|실온)\s*(?:실|고|칸)?\s*(?:으로|로|에)?\s*(?:보냈|옮겼|옮김|넣었|넣어|이동|두었|뒀|보관|했)/;
const CONSUME = /썼|쓴|먹었|먹음|먹어|소진|사용|다\s*썼|해\s*먹|써서|드셨|출고|차감|쓰고|먹고/; // '쓰고 / 먹고' added with the clause split above
const AMOUNT = /(\d+(?:\.\d+)?)\s*(개|대|단|모|kg|g|ml|L|l|봉지|봉|팩|장|통|마리|쪽|줄|캔|컵|알|구)/;
// NOTE (deliberate improvement over CookSaver): the original only split after past-tense '…썼고/먹었고'. Everyday speech also says
// '쓰고 / 먹고 / 버리고 / 넣고 / 옮기고 / 보내고 / 두고' ('대파 1대 쓰고 삼겹살은 냉동실로 보냈어'), which would otherwise be read as ONE clause
// and lose the first action. `고` inside a noun (소고기) is never followed by whitespace right after these stems, so nouns stay intact.
const CLAUSE = /[,，;.\n·]|(?<=(?:[썼었았였했]|쓰|먹|버리|넣|옮기|보내|두)고)\s+|(?<=[썼었았였했]는데)\s+|\s+그리고\s+/;
const JOSA = /(에서|은|는|이|가|을|를|도|만|랑|하고|과|와)$/;
const AMOUNT_WON = /\d[\d,]*\s*(?:만\s*(?:\d+\s*천)?|천)?\s*원/g;
const EXPENSE_STOP = new Set(["배달", "구매", "샀어", "샀다", "썼어", "결제", "시켰어", "주문", "외식", "지출", "원", "어치"]);
const FILLER = new Set(["남은", "나머지", "오늘", "방금", "어제", "아까", "그리고", "다", "좀"]);

const words = (s: string) => s.match(/[가-힣A-Za-z]+/g) ?? [];

/** The kitchen item that best matches what was said: a whole name inside the sentence first (longest), else a spoken word inside a name. */
export function findInventory(text: string, inventory: readonly InventoryRef[]): InventoryRef | null {
  let whole: InventoryRef | null = null;
  for (const it of inventory) if (it.name && text.includes(it.name) && (!whole || it.name.length > whole.name.length)) whole = it;
  if (whole) return whole;
  let best: { len: number; item: InventoryRef } | null = null;
  for (let word of text.match(/[가-힣A-Za-z]{2,}/g) ?? []) {
    word = word.replace(JOSA, "");
    if (word.length < 2 || FILLER.has(word)) continue;
    for (const item of inventory) if (item.name.includes(word) && (!best || word.length > best.len)) best = { len: word.length, item };
  }
  return best ? best.item : null;
}

/** '대파 1대 썼고 계란 2개 먹었어, 남은 소고기는 냉동실로 보냈어' -> rows (ingredient names are matched to the kitchen's). */
export function parseCheckoutRules(input: string, inventory: readonly InventoryRef[]): RawCheckoutRow[] {
  const text = input.replace(/(?<=\d),(?=\d{3})/g, ""); // the comma in 35,000원 is not a clause break
  const out: RawCheckoutRow[] = [];
  for (const clause of text.split(CLAUSE).map((c) => c.trim())) {
    if (!clause) continue;
    const move = MOVE.exec(clause);
    const won = parseWon(clause);
    let action: CheckoutActionType;
    let target = "";
    if (DISCARD.test(clause)) action = "discard";
    else if (move) {
      action = "move";
      target = move[1];
    } else if (won) {
      // '치킨 22000원 배달' / '사료 35000원 구매' -> a ledger entry (amount + category + memo)
      const rest = words(clause.replace(AMOUNT_WON, " ")).filter((w) => !FILLER.has(w) && !EXPENSE_STOP.has(w));
      out.push({ name: rest.length ? rest[0].replace(JOSA, "").slice(0, MAX_MEMO) : "지출", action: "expense", amount: won, target_location: "", category: guessExpenseCategory(clause) });
      continue;
    } else if (CONSUME.test(clause)) action = "consume";
    else continue;

    const item = findInventory(clause, inventory);
    let name: string;
    if (item) name = item.name;
    else {
      const ws = words(clause).filter((w) => !FILLER.has(w)); // not in the kitchen: show the first word, particle stripped
      name = ws.length ? ws[0].replace(JOSA, "") : "";
      if (!name) continue;
    }
    const found = AMOUNT.exec(clause);
    out.push({ name, action, amount: found && action === "consume" ? `${found[1]}${found[2]}` : "", target_location: target });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- quantities
export type QuantityResult = { left: string | null; note: string };

/** Subtract a used amount from a stock text ('3대' - '1대' = '2대'). No amount, no number or different units => all gone. */
export function reduceQuantity(have: string, used: string): QuantityResult {
  const h = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(String(have).trim());
  const u = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(String(used ?? "").trim());
  if (!used || !String(used).trim()) return { left: null, note: "전부 소진" };
  if (!h || !u) return { left: null, note: "수량을 알 수 없어 전부 소진" };
  if (h[2].trim() !== u[2].trim()) return { left: null, note: `단위가 달라(${h[2].trim() || "개"}↔${u[2].trim()}) 전부 소진` };
  const rest = Math.round((Number(h[1]) - Number(u[1])) * 100) / 100;
  return rest > 0
    ? { left: `${rest}${h[2]}`, note: `${u[1]}${u[2]} 차감 → ${rest}${h[2]} 남음` }
    : { left: null, note: `${u[1]}${u[2]} 차감 → 모두 소진` };
}

// ---------------------------------------------------------------------------------------------- plan rows (rows attached to real items)
export type CheckoutPlanRow = {
  action: CheckoutActionType;
  /** consume/move/discard: the kitchen item's name · expense: the memo */
  name: string;
  /** the kitchen item; null = not found (never for expense) */
  itemId: string | null;
  /** consume: what was used ('1대'; '' = everything) */
  amount: string;
  target: StorageType | null;
  won: number | null;
  category: ExpenseCategory | null;
  /** move: the item's new expiry date */
  newExpireDate: string | null;
  /** consume: stock left after the deduction; null = the item is used up (credits the saving) */
  quantityLeft: string | null;
  note: string;
};

const clean = (s: unknown, max: number) => String(s ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);

function wonOf(raw: unknown): number | null {
  let won: number | null = null;
  if (typeof raw === "number" && Number.isFinite(raw)) won = Math.trunc(raw);
  else {
    const t = String(raw ?? "").trim();
    won = /^\d[\d,]*$/.test(t) ? Number(t.replace(/,/g, "")) : parseWon(t);
  }
  return won !== null && won > 0 && won <= MAX_WON ? won : null;
}

/**
 * Validate rows from ANY source (rules or the AI) and attach them to kitchen items; computes the quantity left after a
 * consume and the new expiry after a move. Unknown actions, blank names, impossible moves and bad amounts are dropped.
 */
export function finishCheckout(rows: unknown, inventory: readonly InventoryRef[], today: string): CheckoutPlanRow[] {
  if (!Array.isArray(rows)) return [];
  const out: CheckoutPlanRow[] = [];
  for (const row of rows.slice(0, MAX_CHECKOUT_ROWS)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (!(CHECKOUT_ACTIONS as readonly unknown[]).includes(r.action) || typeof r.name !== "string") continue;
    const name = clean(r.name, 100);
    if (!name) continue;
    const action = r.action as CheckoutActionType;

    if (action === "expense") {
      const won = wonOf(r.amount);
      if (won === null) continue;
      const category = (EXPENSE_CATEGORIES as readonly unknown[]).includes(r.category) ? (r.category as ExpenseCategory) : guessExpenseCategory(name);
      out.push({ action, name: name.slice(0, MAX_MEMO), itemId: null, amount: "", target: null, won, category, newExpireDate: null, quantityLeft: null, note: "" });
      continue;
    }

    const item = inventory.find((it) => it.name === name) ?? findInventory(name, inventory);
    const target = action === "move" ? (STORAGE_FROM_KO[String(r.target_location)] ?? null) : null;
    if (action === "move" && !target) continue;

    const base: CheckoutPlanRow = {
      action,
      name: item ? item.name : name,
      itemId: item ? item.id : null,
      amount: action === "consume" ? clean(r.amount, 30) : "",
      target,
      won: null,
      category: null,
      newExpireDate: null,
      quantityLeft: null,
      note: "",
    };
    if (item && action === "move" && target) {
      const moved = moveStorage(item, target, today);
      base.newExpireDate = moved ? moved.expire_date : null;
      base.note = moved ? "" : "이미 그 보관 장소에 있어요";
    }
    if (item && action === "consume") {
      const q = reduceQuantity(item.amount, base.amount);
      base.quantityLeft = q.left;
      base.note = q.note;
    }
    out.push(base);
  }
  return out;
}

/** The one-line preview text for a plan row (and whether it can be applied). */
export function describePlanRow(row: CheckoutPlanRow): { text: string; ok: boolean } {
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
  if (row.action === "expense") return { ok: true, text: `${row.name} ${won(row.won ?? 0)} 지출` };
  if (!row.itemId) return { ok: false, text: `${row.name} — 냉장고에서 찾지 못했어요` };
  if (row.action === "discard") return { ok: true, text: `${row.name} 폐기` };
  if (row.action === "move") {
    if (row.note === "이미 그 보관 장소에 있어요") return { ok: false, text: `${row.name} — 이미 ${STORAGE_TO_KO[row.target as StorageType]}에 있어요` };
    return { ok: true, text: `${row.name} ${STORAGE_TO_KO[row.target as StorageType]} 이동` };
  }
  return row.quantityLeft === null
    ? { ok: true, text: `${row.name} 소진 +${won(SAVED_WON_PER_RESCUE)}` }
    : { ok: true, text: `${row.name} ${row.amount} 차감 (${row.quantityLeft} 남음)` };
}
