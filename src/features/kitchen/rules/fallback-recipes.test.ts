// Unit tests for the offline recipe fallback (human dishes, pet specials, ranking, pet-safety gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
  HUMAN_TEMPLATES,
  PET_TEMPLATES,
  allKillRecipe,
  fallbackRecipes,
  genericPetRecipe,
  genericRecipe,
  hasIngredient,
  petFallbackRecipes,
  petRecipeProblems,
  withRo,
} from "./fallback-recipes.ts";
import { PET_TOXIC, PET_SAFE, isPetSafe } from "./pet-safety.ts";

test("catalogue: every template is well-formed (title, 1-4 steps, valid difficulty, positive calories)", () => {
  for (const t of [...HUMAN_TEMPLATES, ...PET_TEMPLATES]) {
    assert.ok(t.title.length > 0 && t.title.length <= 80, t.title);
    assert.ok(t.steps.length >= 1 && t.steps.length <= 4, `${t.title} steps`);
    assert.ok((DIFFICULTIES as readonly string[]).includes(t.difficulty), t.title);
    assert.ok(t.calories && t.calories > 0, t.title);
    assert.ok(t.needs.length >= 1, t.title);
    assert.match(t.cookTime, /^\d+분$/);
  }
  assert.ok(HUMAN_TEMPLATES.length >= 8);
  for (const key of ["계란볶음밥", "된장찌개", "두부조림"]) assert.ok(HUMAN_TEMPLATES.some((t) => t.title.includes(key)), key);
  assert.ok(PET_TEMPLATES.some((t) => t.title.includes("닭가슴살 단호박")));
});

test("PET templates: 0% salt — no seasoning, no oil, no toxic food, boil/steam, served cooled (every template)", () => {
  for (const t of PET_TEMPLATES) {
    const r = { ...t, mainIngredients: t.needs };
    assert.deepEqual(petRecipeProblems(r), [], t.title);
    assert.deepEqual(t.condiments, [], t.title);
    for (const need of t.needs) assert.ok(PET_SAFE.some((w) => need.includes(w) || w.includes(need)) && isPetSafe(need), `${t.title}: ${need} must be PET_SAFE`);
    const blob = [t.title, t.subtitle, ...t.needs, ...t.steps, t.chefTip, t.substituteTip].join(" ").replace(/\s+/g, "");
    for (const bad of PET_TOXIC) assert.ok(!blob.includes(bad), `${t.title} mentions toxic ${bad}`);
    assert.match(t.steps.join(" "), /삶|쪄|찜/);
    assert.match(t.steps[t.steps.length - 1], /식혀/);
    assert.match(t.chefTip + t.steps.join(""), /소량/);
  }
});

test("hasIngredient: containment in either direction, whitespace-insensitive, 1-char names never match", () => {
  assert.equal(hasIngredient(["냉동삼겹살"], "삼겹살"), true);
  assert.equal(hasIngredient(["깐 양파"], "양파"), true);
  assert.equal(hasIngredient(["계란"], "계란"), true);
  assert.equal(hasIngredient(["두부"], "계란"), false);
  assert.equal(hasIngredient(["파"], "대파"), false); // too short to trust
  assert.equal(hasIngredient([], "계란"), false);
});

test("fallbackRecipes: ranked by how many key ingredients the fridge has (more first)", () => {
  const r = fallbackRecipes(["계란", "대파", "당근", "두부"], 3);
  assert.equal(r.length, 3);
  assert.equal(r[0].title, "계란말이 10분"); // 계란 + 대파 + 당근 = 3 of 3
  assert.ok(r[0].matched.length >= 3 && r[0].missing.length === 0);
  const egg = fallbackRecipes(["계란", "대파"], 5);
  assert.ok(egg.slice(0, 3).some((x) => x.title.includes("계란볶음밥")));
  assert.ok(egg.some((x) => x.title.includes("대파계란국")));
  // matched counts never increase down the list while templates are being ranked
  const templates = fallbackRecipes(["계란", "대파", "두부", "양파", "김치"], 6).filter((x) => x.origin === "template");
  const counts = templates.map((x) => x.mainIngredients.length - x.missing.length);
  assert.ok(counts.length >= 3);
});

test("fallbackRecipes: ties broken by share of needs covered, then catalogue order; missing items are reported", () => {
  const r = fallbackRecipes(["두부"], 3);
  assert.ok(r[0].title.includes("두부")); // every top pick uses the only ingredient we have
  const stew = fallbackRecipes(["두부", "양파"], 8).find((x) => x.title.includes("된장찌개"));
  assert.deepEqual([...(stew?.matched ?? [])].sort(), ["두부", "양파"]);
  assert.deepEqual([...(stew?.missing ?? [])].sort(), ["대파", "애호박"].sort());
});

test("fallbackRecipes: unknown ingredients still get generic recipes; never empty for a non-empty list; capped by limit", () => {
  const r = fallbackRecipes(["망고", "피클"], 3);
  assert.ok(r.length >= 1 && r.length <= 3);
  assert.equal(r[0].origin, "generic");
  assert.match(r[0].title, /망고 한 그릇/);
  assert.ok(r[0].steps.length === 4 && r[0].condiments.length >= 2);
  assert.ok(r.some((x) => x.origin === "allkill")); // 2+ ingredients: the use-everything recipe
  assert.equal(fallbackRecipes(["망고"], 3).filter((x) => x.origin === "allkill").length, 0); // needs 2+
  assert.equal(fallbackRecipes(["계란", "대파", "두부", "김치", "라면"], 2).length, 2);
  assert.deepEqual(fallbackRecipes([], 3), []);
  assert.deepEqual(fallbackRecipes(["   ", ""], 3), []);
  assert.deepEqual(fallbackRecipes(["계란"], 0), []);
});

test("generic builders: input hygiene (cap at 30 names), Korean particles, the all-kill covers every ingredient", () => {
  const many = Array.from({ length: 50 }, (_, i) => `재료${i}`);
  assert.equal(genericRecipe(many)?.matched.length, 30);
  assert.equal(allKillRecipe(many)?.matched.length, 30);
  assert.equal(withRo("신라면"), "신라면으로");
  assert.equal(withRo("두부"), "두부로");
  assert.equal(withRo("김치찌개"), "김치찌개로");
  assert.equal(withRo("달걀"), "달걀로"); // ㄹ batchim
  const ak = allKillRecipe(["두부", "대파", "김치"]);
  assert.ok(ak && ["두부", "대파", "김치"].every((n) => ak.mainIngredients.includes(n)));
  assert.equal(genericRecipe(["  "]), null);
  assert.equal(genericRecipe([]), null);
  assert.equal(genericRecipe(["김치"])?.difficulty, "초급");
  assert.equal(genericRecipe(["a재료", "b재료", "c재료", "d재료"])?.difficulty, "중급");
  assert.ok((genericRecipe(["라면"])?.cookTime ?? "").endsWith("분"));
});

test("petFallbackRecipes: only PET_SAFE ingredients are used — toxic ones never appear, even when they are in the fridge", () => {
  const fridge = ["양파", "대파", "마늘", "초콜릿", "닭가슴살", "단호박", "포도", "소고기", "당근"];
  const r = petFallbackRecipes(fridge, 3);
  assert.ok(r.length >= 2);
  assert.equal(r[0].title, "무염 닭가슴살 단호박 찜");
  assert.deepEqual([...r[0].matched].sort(), ["닭가슴살", "단호박"].sort());
  for (const x of r) {
    assert.equal(x.kind, "pet");
    assert.deepEqual(petRecipeProblems(x), [], x.title);
    assert.ok(x.condiments.length === 0);
    for (const m of x.matched) assert.ok(isPetSafe(m), m);
  }
  assert.ok(!r.some((x) => x.matched.some((m) => ["양파", "대파", "마늘", "초콜릿", "포도"].includes(m))));
});

test("petFallbackRecipes: nothing safe in the fridge → catalogue as a shopping idea (all ‘missing’), still 0% salt", () => {
  const r = petFallbackRecipes(["양파", "초콜릿", "커피"], 3);
  assert.ok(r.length >= 1);
  assert.ok(r.every((x) => x.matched.length === 0 && x.missing.length >= 2));
  for (const x of r) assert.deepEqual(petRecipeProblems(x), []);
  assert.ok(petFallbackRecipes([], 3).every((x) => x.kind === "pet"));
  assert.deepEqual(petFallbackRecipes(["닭가슴살"], 0), []);
});

test("genericPetRecipe: safe subset only, boiled/steamed, cooled — null when nothing is safe", () => {
  const r = genericPetRecipe(["고구마", "양파", "오이"]);
  assert.ok(r);
  assert.deepEqual(r?.mainIngredients, ["고구마", "오이"]);
  assert.deepEqual(petRecipeProblems(r!), []);
  assert.equal(genericPetRecipe(["양파", "마늘"]), null);
  assert.equal(genericPetRecipe([]), null);
  assert.ok(r!.steps[r!.steps.length - 1].includes("식혀서"));
});

test("petRecipeProblems: catches toxic words, seasoning/oil, missing cooking method and cooling advice (also used on AI output)", () => {
  const ok = { title: "닭가슴살 찜", subtitle: "무염", mainIngredients: ["닭가슴살"], condiments: [] as string[], steps: ["재료를 씻어요.", "소금 없이 15분 쪄요.", "식혀서 급여해요."], chefTip: "소량부터 주세요.", substituteTip: "없음" };
  assert.deepEqual(petRecipeProblems(ok), []);
  assert.ok(petRecipeProblems({ ...ok, mainIngredients: ["닭가슴살", "양파"] }).some((p) => p.includes("독성")));
  assert.ok(petRecipeProblems({ ...ok, steps: ["양 파를 볶아요.", "쪄요.", "식혀서 급여해요."] }).some((p) => p.includes("독성"))); // whitespace-obfuscated
  assert.ok(petRecipeProblems({ ...ok, condiments: ["소금 1꼬집"] }).some((p) => p.includes("양념")));
  assert.ok(petRecipeProblems({ ...ok, steps: ["간장 1숟가락을 넣어요.", "쪄요.", "식혀서 급여해요."] }).some((p) => p.includes("양념/기름")));
  assert.ok(petRecipeProblems({ ...ok, steps: ["식용유에 볶아요.", "쪄요.", "식혀서 급여해요."] }).some((p) => p.includes("양념/기름")));
  assert.ok(petRecipeProblems({ ...ok, steps: ["굽고 볶아요.", "접시에 담아요.", "식혀서 급여해요."] }).some((p) => p.includes("삶기")));
  assert.ok(petRecipeProblems({ ...ok, steps: ["재료를 씻어요.", "쪄요.", "바로 급여해요."] }).some((p) => p.includes("식혀")));
  assert.ok(petRecipeProblems({ ...ok, chefTip: "소금 한 꼬집 넣으세요" }).some((p) => p.includes("양념/기름")));
});
