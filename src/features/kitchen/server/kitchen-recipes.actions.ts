"use server";

import { revalidatePath } from "next/cache";
import { rateLimit } from "@/shared/lib/rate-limit";
import { dday, URGENT_DAYS } from "../rules/expiry";
import { fallbackRecipes, hasIngredient, itemsUsedBy, petFallbackRecipes, type Recipe } from "../rules/fallback-recipes";
import { isPetSafe } from "../rules/pet-safety";
import { SAVED_WON_PER_RESCUE } from "../rules/storage-move";
import { consumeIdsSchema, type KitchenActionResult, type PetType } from "../schemas/kitchen.schema";
import { generateAiRecipes } from "./gemini-recipes";
import { adjustProfileCounters, kitchenContext, seoulToday } from "./kitchen-context";

// AI chef. The AI only SUGGESTS: nothing is written until the user presses "소진 처리", which uses up exactly the kitchen items
// the recipe names. Runs under the caller's JWT (RLS = household boundary). Without a Gemini key, or when the call fails, the
// offline recipes (rules/fallback-recipes.ts) are returned instead and the result says so.

const MAX_INGREDIENTS = 12;
const tooMany = (s: number): { ok: false; error: string } => ({ ok: false, error: `잠깐 너무 많이 눌렀어요. ${s}초 뒤에 다시 해 보세요.` });

export type RecipeCard = Recipe & {
  source: "gemini" | "fallback";
  /** fridge ingredients the recipe uses / the ones it still needs */
  matched: string[];
  missing: string[];
  /** the kitchen items "소진 처리" would use up */
  items: { id: string; name: string }[];
};
export type ChefIngredient = { id: string; name: string; days: number; urgent: boolean };
export type ChefResult = { source: "gemini" | "fallback"; note: string; recipes: RecipeCard[]; ingredients: ChefIngredient[]; excludedExpired: number };

type Row = { id: string; name: string; expire_date: string; is_pet: boolean };

/** Cookable ingredients, soonest expiry first. Already-expired items are never suggested (counted instead). */
function pick(rows: Row[], today: string, filter: (r: Row) => boolean): { ingredients: ChefIngredient[]; excludedExpired: number } {
  let excludedExpired = 0;
  const out: ChefIngredient[] = [];
  for (const r of rows) {
    if (!filter(r)) continue;
    const d = dday(r.expire_date, today);
    if (d === null) continue;
    if (d < 0) { excludedExpired++; continue; }
    out.push({ id: r.id, name: r.name, days: d, urgent: d <= URGENT_DAYS });
  }
  out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "ko"));
  return { ingredients: out.slice(0, MAX_INGREDIENTS), excludedExpired };
}

function toCards(recipes: Recipe[], ingredients: ChefIngredient[], source: "gemini" | "fallback"): RecipeCard[] {
  const names = ingredients.map((i) => i.name);
  return recipes.map((r) => ({
    ...r,
    source,
    matched: r.mainIngredients.filter((m) => hasIngredient(names, m)),
    missing: r.mainIngredients.filter((m) => !hasIngredient(names, m)),
    items: itemsUsedBy(r, ingredients).map((i) => ({ id: i.id, name: i.name })),
  }));
}

async function load() {
  const c = await kitchenContext();
  if (!c.ok) return c;
  const { data, error } = await c.ctx.supabase.from("kitchen_items").select("id, name, expire_date, is_pet").order("expire_date", { ascending: true }).limit(300);
  if (error) return { ok: false as const, error: "냉장고 재료를 불러오지 못했어요." };
  return { ok: true as const, c, rows: (data ?? []) as Row[] };
}

/** Recipes for the fridge: expiring (D-3) ingredients first. Gemini, or the offline recipes ranked by matching ingredients. */
export async function generateFridgeRecipes(): Promise<KitchenActionResult<{ result: ChefResult }>> {
  const l = await load();
  if (!l.ok) return l;
  const rl = rateLimit(`kitchen-chef:${l.c.ctx.userId}`, 6, 60_000);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  const { ingredients, excludedExpired } = pick(l.rows, seoulToday(), (r) => !r.is_pet); // pet treats are not ingredients
  if (ingredients.length === 0) return { ok: false, error: excludedExpired > 0 ? "기한이 지나지 않은 재료가 없어요. 재료를 새로 채워 보세요." : "냉장고에 재료가 없어요. 먼저 재료를 추가해 주세요." };

  const names = ingredients.map((i) => i.name);
  const ai = await generateAiRecipes(names, "human");
  if (ai.ok) return { ok: true, result: { source: "gemini", note: "", recipes: toCards(ai.recipes, ingredients, "gemini"), ingredients, excludedExpired } };

  const fb = fallbackRecipes(names, 3);
  return { ok: true, result: { source: "fallback", note: ai.note, recipes: toCards(fb, ingredients, "fallback"), ingredients, excludedExpired } };
}

/** Pet specials: only for households with a pet, only PET_SAFE ingredients, 0% salt, boiled/steamed, served cooled. */
export async function generatePetRecipes(): Promise<KitchenActionResult<{ result: ChefResult }>> {
  const l = await load();
  if (!l.ok) return l;
  const { supabase } = l.c.ctx;

  const prof = await supabase.from("kitchen_profiles").select("pet_type").maybeSingle();
  const petType = ((prof.data?.pet_type as PetType | undefined) ?? "none");
  if (petType === "none") return { ok: false, error: "반려동물을 먼저 설정해 주세요. (키친 화면의 ‘반려동물’)" };

  const rl = rateLimit(`kitchen-chef-pet:${l.c.ctx.userId}`, 6, 60_000);
  if (!rl.allowed) return tooMany(rl.retryAfterSec);

  const { ingredients, excludedExpired } = pick(l.rows, seoulToday(), (r) => !r.is_pet && isPetSafe(r.name)); // toxic / unknown foods never reach the prompt
  const names = ingredients.map((i) => i.name);

  if (ingredients.length > 0) {
    const ai = await generateAiRecipes(names, "pet");
    if (ai.ok) return { ok: true, result: { source: "gemini", note: "", recipes: toCards(ai.recipes, ingredients, "gemini"), ingredients, excludedExpired } };
    return { ok: true, result: { source: "fallback", note: ai.note, recipes: toCards(petFallbackRecipes(names, 3), ingredients, "fallback"), ingredients, excludedExpired } };
  }
  return { ok: true, result: { source: "fallback", note: "냉장고에 급여할 수 있는 재료가 없어 기본 특식을 보여 드려요. (닭가슴살·단호박·당근·고구마 등)", recipes: toCards(petFallbackRecipes([], 3), [], "fallback"), ingredients, excludedExpired } };
}

/** "😋 이 재료들 소진 처리": the recipe's kitchen items are used up — rescued_count + N, saved_money + 3,000원 × N. */
export async function consumeRecipeIngredients(input: unknown): Promise<KitchenActionResult<{ consumed: number; savedWon: number }>> {
  const parsed = consumeIdsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const c = await kitchenContext();
  if (!c.ok) return c;

  const ids = [...new Set(parsed.data.ids)];
  // one statement; RLS limits it to this household's rows, and `.select()` tells us how many were REALLY removed
  const { data, error } = await c.ctx.supabase.from("kitchen_items").delete().in("id", ids).select("id");
  if (error) return { ok: false, error: "재료를 소진 처리하지 못했어요." };
  const n = data?.length ?? 0;
  if (n === 0) return { ok: false, error: "처리할 재료를 찾지 못했어요. 이미 정리됐을 수 있어요." };

  const credited = await adjustProfileCounters(c.ctx.supabase, c.ctx.householdId, { rescued: n, savedWon: n * SAVED_WON_PER_RESCUE });
  if (!credited) console.error("kitchen: recipe ingredients consumed but the savings credit could not be written");
  revalidatePath("/kitchen");
  revalidatePath("/analytics");
  return { ok: true, consumed: n, savedWon: credited ? n * SAVED_WON_PER_RESCUE : 0 };
}
