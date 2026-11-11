// Shelf-life dictionary (소비기한 사전) ported from CookSaver `bulk.py`: 50 staple Korean household ingredients with
// recommended days per storage place, name matching (aliases, processed-food guard, prepared-cut rule) and the
// default-expiry helper used when the user doesn't type a date. Pure functions, no I/O.
import { addDays } from "./date-utils.ts";

export const STORAGE_TYPES = ["FRIDGE", "FREEZER", "ROOM_TEMP"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];
export const STORAGE_LABEL: Record<StorageType, string> = { FRIDGE: "냉장", FREEZER: "냉동", ROOM_TEMP: "실온" };

/** Fallback days when an ingredient is not in the dictionary (CookSaver: 냉장 5 · 냉동 30 · 실온 90). */
export const DEFAULT_DAYS: Record<StorageType, number> = { FRIDGE: 5, FREEZER: 30, ROOM_TEMP: 90 };

type ShelfTable = Partial<Record<StorageType, number>>;
const F = "FRIDGE", Z = "FREEZER", R = "ROOM_TEMP";
const t = (o: Record<string, number>): ShelfTable => {
  const out: ShelfTable = {};
  for (const [k, v] of Object.entries(o)) out[k === "냉장" ? F : k === "냉동" ? Z : R] = v;
  return out; // insertion order is kept: the FIRST key is the ingredient's usual storage place
};

/**
 * 50 ingredients -> recommended days from purchase (unopened / fresh). The first key of each entry is the usual
 * storage place. A date printed on the package always wins; these are the defaults for "no date typed".
 */
export const SHELF_LIFE: Readonly<Record<string, ShelfTable>> = {
  // eggs · dairy · tofu · bean sprouts
  계란: t({ 냉장: 21 }), 우유: t({ 냉장: 10 }), 두부: t({ 냉장: 7 }), 콩나물: t({ 냉장: 3 }),
  요거트: t({ 냉장: 14 }), 치즈: t({ 냉장: 30 }), 버터: t({ 냉장: 60, 냉동: 180 }), 생크림: t({ 냉장: 7 }),
  // meat (raw meat 2-3 days chilled) · processed meat
  삼겹살: t({ 냉장: 3, 냉동: 90 }), 목살: t({ 냉장: 3, 냉동: 90 }), 소고기: t({ 냉장: 3, 냉동: 180 }), 돼지고기: t({ 냉장: 3, 냉동: 90 }),
  닭고기: t({ 냉장: 2, 냉동: 90 }), 닭가슴살: t({ 냉장: 2, 냉동: 90 }), 다짐육: t({ 냉장: 2, 냉동: 60 }),
  햄: t({ 냉장: 14, 냉동: 60 }), 소시지: t({ 냉장: 14, 냉동: 60 }), 베이컨: t({ 냉장: 7, 냉동: 30 }),
  // seafood
  고등어: t({ 냉장: 2, 냉동: 60 }), 오징어: t({ 냉장: 2, 냉동: 60 }), 새우: t({ 냉장: 2, 냉동: 60 }), 연어: t({ 냉장: 2, 냉동: 60 }), 어묵: t({ 냉장: 7, 냉동: 30 }),
  // vegetables
  대파: t({ 냉장: 7, 냉동: 30 }), 양파: t({ 실온: 30 }), 마늘: t({ 실온: 30 }), 감자: t({ 실온: 30 }), 고구마: t({ 실온: 30 }),
  당근: t({ 냉장: 14 }), 양배추: t({ 냉장: 14 }), 배추: t({ 냉장: 7 }), 상추: t({ 냉장: 5 }), 깻잎: t({ 냉장: 5 }), 시금치: t({ 냉장: 3 }), 부추: t({ 냉장: 3 }),
  오이: t({ 냉장: 7 }), 애호박: t({ 냉장: 7 }), 고추: t({ 냉장: 7 }), 버섯: t({ 냉장: 5 }), 토마토: t({ 냉장: 7 }),
  // fruit
  사과: t({ 냉장: 21 }), 바나나: t({ 실온: 5 }), 딸기: t({ 냉장: 3 }), 귤: t({ 실온: 14 }), 포도: t({ 냉장: 5 }),
  // kimchi · bread · ready foods
  김치: t({ 냉장: 30 }), 식빵: t({ 실온: 5, 냉동: 30 }), 라면: t({ 실온: 180 }), 즉석밥: t({ 실온: 180 }), 참치캔: t({ 실온: 365 }),
};

/** Other names for the same ingredient -> dictionary key. */
export const ALIASES: Readonly<Record<string, string>> = {
  달걀: "계란", 쇠고기: "소고기", 한우: "소고기", 삼겹: "삼겹살", 돼지: "돼지고기", 닭: "닭고기", 닭다리: "닭고기", 닭가슴: "닭가슴살",
  요구르트: "요거트", 슬라이스치즈: "치즈", 모짜렐라: "치즈", 쪽파: "대파", 청양고추: "고추", 풋고추: "고추", 방울토마토: "토마토",
  표고: "버섯", 팽이: "버섯", 새송이: "버섯", 양송이: "버섯", 미니양배추: "양배추", 깐마늘: "마늘", 단감: "사과",
};

/** Words that mean "processed product, not the fresh ingredient" (감자칩, 토마토소스, 딸기잼 …): the dictionary is not used. */
export const PROCESSED_FOODS = ["과자", "주스", "잼", "칩", "스낵", "깡", "젓", "가루", "분말", "소스", "절임", "장아찌", "마늘빵", "튀김"] as const;
/** Shelf-stable products that stay in the dictionary even though their name contains a ROOM_TEMP word. */
export const SHELF_STABLE_KEYS = ["라면", "즉석밥", "참치캔"] as const;
/** Pre-cut / prepared produce (깐양파, 다진마늘 …) keeps for at most the default chilled period. */
export const PREPARED = /(?:깐|다진|손질|썬|채썬|슬라이스|씻은|세척)/;

/** Name contains one of these -> stored at room temperature (pantry goods). */
export const ROOM_WORDS = [
  "라면", "통조림", "캔", "참치", "스팸", "즉석밥", "햇반", "스파게티", "파스타", "시리얼", "과자", "라볶이", "쌀", "당면", "소면", "컵밥", "식용유", "설탕", "소금", "미역",
  "간장", "고추장", "된장", "쌈장", "참기름", "들기름", "식초", "올리고당", "물엿", "밀가루", "부침가루", "후추", "케첩", "카레", "양념장", "칩", "스낵", "소스",
] as const;
/** Name contains one of these -> usually frozen. */
export const FROZEN_WORDS = [
  "삼겹", "목살", "소고기", "돼지", "닭", "고기", "갈비", "불고기", "차돌", "안심", "등심", "다짐육", "베이컨", "소시지",
  "만두", "새우", "오징어", "생선", "고등어", "연어", "아이스크림", "치킨", "너겟", "떡갈비",
] as const;
/** A storage place typed in the name wins over everything (first match in this order). */
const EXPLICIT: ReadonlyArray<readonly [string, StorageType]> = [["냉동", Z], ["실온", R], ["냉장", F]];

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Find the dictionary key inside a free-text name (aliases included). Korean puts the head noun LAST, so when several
 * keys match the one ending last wins ('치즈라면' -> 라면, '우유식빵' -> 식빵). Returns null for processed foods and for
 * pantry products (unless listed in `stable`).
 */
export function findKey(name: string, keys: readonly string[], stable: readonly string[] = SHELF_STABLE_KEYS): string | null {
  const compact = name.replace(/\s+/g, "");
  if (PROCESSED_FOODS.some((w) => compact.includes(w))) return null;

  let best: { end: number; len: number; key: string } | null = null;
  for (const surface of [...keys, ...Object.keys(ALIASES)]) {
    const canonical = has(ALIASES, surface) ? ALIASES[surface] : surface;
    if (!keys.includes(canonical)) continue;
    for (let at = compact.indexOf(surface); at !== -1; at = compact.indexOf(surface, at + 1)) {
      const cand = { end: at + surface.length, len: surface.length, key: canonical };
      if (!best || cand.end > best.end || (cand.end === best.end && (cand.len > best.len || (cand.len === best.len && cand.key > best.key)))) best = cand;
    }
  }
  if (!best) return null;
  if (!stable.includes(best.key) && ROOM_WORDS.some((w) => compact.includes(w))) return null;
  return best.key;
}

/** Dictionary entry for an ingredient name: [key, {storage: days}] or null. */
export function shelfEntry(name: string): [string, ShelfTable] | null {
  const key = findKey(name, Object.keys(SHELF_LIFE));
  return key ? [key, SHELF_LIFE[key]] : null;
}

/** Keyword-rule storage guess when the dictionary has no entry: typed place > pantry word > frozen word > fridge. */
export function inferStorage(name: string): StorageType {
  for (const [word, storage] of EXPLICIT) if (name.includes(word)) return storage;
  if (ROOM_WORDS.some((w) => name.includes(w))) return R;
  if (FROZEN_WORDS.some((w) => name.includes(w))) return Z;
  return F;
}

/** Recommended days for `name` when the storage place is already known (e.g. chosen in the form); null if unknown. */
export function dictionaryDays(name: string, storage: StorageType): number | null {
  const entry = shelfEntry(name);
  if (!entry) return null;
  if (storage === F && PREPARED.test(name)) return Math.min(entry[1].FRIDGE ?? DEFAULT_DAYS.FRIDGE, DEFAULT_DAYS.FRIDGE);
  return entry[1][storage] ?? null;
}

export type ShelfAssignment = { storage: StorageType; days: number; source: "dictionary" | "default" };

/**
 * Name -> (storage, days). Priority: place typed in the name > the dictionary's usual place > keyword rules.
 * Days come from the dictionary when listed, otherwise the per-place default.
 */
export function storageAndDays(name: string): ShelfAssignment {
  const entry = shelfEntry(name);
  const explicit = EXPLICIT.find(([word]) => name.includes(word))?.[1];
  if (!entry) {
    const storage = explicit ?? inferStorage(name);
    return { storage, days: DEFAULT_DAYS[storage], source: "default" };
  }
  const table = entry[1];
  if (explicit) return { storage: explicit, days: table[explicit] ?? DEFAULT_DAYS[explicit], source: table[explicit] !== undefined ? "dictionary" : "default" };
  if (PREPARED.test(name)) return { storage: F, days: Math.min(table.FRIDGE ?? DEFAULT_DAYS.FRIDGE, DEFAULT_DAYS.FRIDGE), source: "dictionary" };
  const storage = Object.keys(table)[0] as StorageType;
  return { storage, days: table[storage] as number, source: "dictionary" };
}

export type DefaultExpiry = ShelfAssignment & { expireDate: string };

/**
 * The default expiry date to pre-fill for a new item (`today` + recommended days). Pass `storage` when the user already
 * picked a storage place; otherwise it is inferred from the name.
 */
export function defaultExpireDate(name: string, today: string, storage?: StorageType): DefaultExpiry {
  const base = storage
    ? ((): ShelfAssignment => {
        const d = dictionaryDays(name, storage);
        return { storage, days: d ?? DEFAULT_DAYS[storage], source: d === null ? "default" : "dictionary" };
      })()
    : storageAndDays(name);
  return { ...base, expireDate: addDays(today, base.days) };
}
