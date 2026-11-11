// Unit tests for the offline "말로 정리" parser. Run: npm run test:kitchen   (Node's built-in runner, no browser / DB / network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  describePlanRow,
  finishCheckout,
  findInventory,
  parseCheckoutRules,
  reduceQuantity,
  type CheckoutPlanRow,
  type InventoryRef,
} from "./smart-checkout-rules.ts";
import { guessExpenseCategory, parseWon } from "./kitchen-budget.ts";

const T = "2026-11-10";
const inv = (id: string, name: string, storage_type: InventoryRef["storage_type"] = "FRIDGE", amount = "1개", expire_date = "2026-11-20"): InventoryRef => ({ id, name, storage_type, amount, expire_date });
const KITCHEN: InventoryRef[] = [
  inv("11111111-1111-4111-8111-111111111111", "대파", "FRIDGE", "4대"),
  inv("22222222-2222-4222-8222-222222222222", "계란", "FRIDGE", "30구"),
  inv("33333333-3333-4333-8333-333333333333", "소고기", "FRIDGE", "300g", "2026-11-12"),
  inv("44444444-4444-4444-8444-444444444444", "삼겹살", "FRIDGE", "600g", "2026-11-12"),
  inv("55555555-5555-4555-8555-555555555555", "우유", "FRIDGE", "1l"),
  inv("66666666-6666-4666-8666-666666666666", "두부", "FRIDGE", "1모"),
  inv("77777777-7777-4777-8777-777777777777", "냉동만두", "FREEZER", "1봉", "2027-01-01"),
  inv("88888888-8888-4888-8888-888888888888", "양파", "ROOM_TEMP", "3개", "2026-12-10"),
];
const rows = (text: string) => parseCheckoutRules(text, KITCHEN);

// ---------------------------------------------------------------------------------------------- amounts
test("parseWon / guessExpenseCategory: won formats and budget routing", () => {
  assert.equal(parseWon("22000원"), 22000);
  assert.equal(parseWon("22,000원"), 22000);
  assert.equal(parseWon("2만원"), 20000);
  assert.equal(parseWon("2만 5천원"), 25000);
  assert.equal(parseWon("3천원"), 3000);
  assert.equal(parseWon("1만 2천 500원"), 12500);
  assert.equal(parseWon("원"), null);
  assert.equal(parseWon("치킨"), null);
  assert.equal(parseWon("0원"), null);
  assert.equal(parseWon("999999999999원"), null); // over the 100,000,000 cap
  assert.equal(guessExpenseCategory("사료 35000원 구매"), "pet_care");
  assert.equal(guessExpenseCategory("치킨 22000원 배달"), "human_delivery");
  assert.equal(guessExpenseCategory("마트 35000원"), "human_groceries");
  assert.equal(guessExpenseCategory("고양이 모래 12000원 배달"), "pet_care"); // pet words beat delivery words
});

// ---------------------------------------------------------------------------------------------- the headline sentences
test("parser: ‘대파 1대 쓰고 삼겹살은 냉동실로 보냈어’ → consume 1대 + move to freezer", () => {
  const r = rows("대파 1대 쓰고 삼겹살은 냉동실로 보냈어");
  assert.deepEqual(r, [
    { name: "대파", action: "consume", amount: "1대", target_location: "" },
    { name: "삼겹살", action: "move", amount: "", target_location: "냉동" },
  ]);
});

test("parser: expense sentences become ledger rows with amount, category and memo", () => {
  assert.deepEqual(rows("치킨 22000원 배달"), [{ name: "치킨", action: "expense", amount: 22000, target_location: "", category: "human_delivery" }]);
  assert.deepEqual(rows("사료 35,000원 구매"), [{ name: "사료", action: "expense", amount: 35000, target_location: "", category: "pet_care" }]); // the comma in 35,000 is not a clause break
  assert.deepEqual(rows("마트에서 2만 5천원 장봤어").map((x) => [x.action, x.amount]), [["expense", 25000]]);
  assert.deepEqual(rows("원두 12000원")[0].category, "human_groceries");
  assert.equal(rows("5000원 썼어")[0].name, "지출"); // nothing but the amount: generic memo
});

test("parser: several things in one breath — clause splitting on 고 / 는데 / 그리고 / commas", () => {
  const r = rows("대파 1대 썼고 계란 2개 먹었어, 남은 소고기는 냉동실로 보냈어");
  assert.deepEqual(r.map((x) => [x.name, x.action, x.amount, x.target_location]), [
    ["대파", "consume", "1대", ""],
    ["계란", "consume", "2개", ""],
    ["소고기", "move", "", "냉동"],
  ]);
  assert.deepEqual(rows("계란 2개 쓰고 우유 1l 먹었는데 두부는 버렸어").map((x) => [x.name, x.action]), [["계란", "consume"], ["우유", "consume"], ["두부", "discard"]]);
  assert.deepEqual(rows("냉동만두 3개 먹었어 그리고 양파 1개 썼어").map((x) => [x.name, x.amount]), [["냉동만두", "3개"], ["양파", "1개"]]);
  assert.deepEqual(rows("우유 버렸어. 두부 상했어\n치킨 20000원 시켰어").map((x) => x.action), ["discard", "discard", "expense"]);
});

test("parser: action priority — discard > move > expense > consume", () => {
  assert.equal(rows("먹다 남은 우유 상해서 버렸어")[0].action, "discard");
  assert.equal(rows("두부 먹어 보니 곰팡이")[0].action, "discard"); // discard words win over consume words in the same clause
  assert.deepEqual(rows("소고기 냉장실로 옮겼어").map((x) => [x.action, x.target_location]), [["move", "냉장"]]);
  assert.equal(rows("우유 실온에 두었어")[0].target_location, "실온");
  assert.equal(rows("삼겹살 냉동했어")[0].target_location, "냉동");
  assert.equal(rows("삼겹살 3000원 어치 먹었어")[0].action, "expense"); // an amount of money beats a consume word
  assert.equal(rows("삼겹살 먹었어")[0].amount, ""); // no quantity said -> everything
  assert.equal(rows("삼겹살 300g 먹었어")[0].amount, "300g");
  assert.equal(rows("삼겹살 300g 냉동실로 옮겼어")[0].amount, ""); // quantity is only kept for consume
});

test("parser: ingredient names are matched to the kitchen's (particles, partial words, unknown items)", () => {
  assert.equal(rows("대파를 다 썼어")[0].name, "대파");
  assert.equal(rows("계란은 먹었어")[0].name, "계란");
  assert.equal(rows("만두 3개 먹었어")[0].name, "냉동만두"); // a spoken word inside a kitchen name
  assert.equal(rows("냉동만두 1봉 먹었어")[0].name, "냉동만두");
  assert.equal(rows("파프리카 1개 썼어")[0].name, "파프리카"); // not in the kitchen: the first word, particle stripped
  assert.equal(rows("피자는 버렸어")[0].name, "피자");
  assert.equal(findInventory("소고기랑 삼겹살", KITCHEN)?.name, "소고기"); // equal-length whole names: the first listed wins (as in CookSaver)
  assert.equal(findInventory("냉동만두 먹었어", [...KITCHEN, inv("x", "만두")])?.name, "냉동만두"); // the longer whole name wins
});

test("parser: nothing recognisable → no rows; harmless garbage never throws", () => {
  for (const t of ["", "   ", "아무 말 대잔치", "오늘 날씨 좋다", ",,,.", "원", "1개", "123"]) assert.deepEqual(rows(t), [], JSON.stringify(t));
  assert.doesNotThrow(() => rows("a".repeat(5000)));
  assert.doesNotThrow(() => parseCheckoutRules("대파 썼어", []));
  assert.deepEqual(parseCheckoutRules("대파 1대 썼어", []).map((x) => [x.name, x.action, x.amount]), [["대파", "consume", "1대"]]); // empty kitchen: still parsed, just unmatched
});

test("parser: everyday connectives (쓰고 / 먹고 / 버리고 / 넣고 / 옮기고 / 보내고 / 두고) split clauses — improvement over CookSaver", () => {
  assert.deepEqual(rows("대파 1대 쓰고 삼겹살은 냉동실로 보냈어").map((x) => [x.name, x.action, x.amount, x.target_location]), [["대파", "consume", "1대", ""], ["삼겹살", "move", "", "냉동"]]);
  assert.deepEqual(rows("계란 2개 쓰고 우유 1l 먹었는데 두부는 버렸어").map((x) => [x.name, x.action]), [["계란", "consume"], ["우유", "consume"], ["두부", "discard"]]);
  assert.deepEqual(rows("우유 먹고 두부 버리고 양파는 냉장실로 옮겼어").map((x) => [x.name, x.action]), [["우유", "consume"], ["두부", "discard"], ["양파", "move"]]);
  assert.deepEqual(rows("두부 넣고 대파 썰고 계란 풀고").map((x) => x.action), []); // cooking talk without a consume/move/discard word is ignored
  // nouns containing 고 are not split
  assert.deepEqual(rows("소고기 먹었어").map((x) => [x.name, x.action]), [["소고기", "consume"]]);
  assert.deepEqual(rows("닭고기 300g 썼어")[0].amount, "300g");
});

// ---------------------------------------------------------------------------------------------- quantities
test("reduceQuantity: same unit subtracts, otherwise everything is used", () => {
  assert.deepEqual(reduceQuantity("4대", "1대"), { left: "3대", note: "1대 차감 → 3대 남음" });
  assert.deepEqual(reduceQuantity("30구", "2구"), { left: "28구", note: "2구 차감 → 28구 남음" });
  assert.deepEqual(reduceQuantity("1.5kg", "0.5kg"), { left: "1kg", note: "0.5kg 차감 → 1kg 남음" });
  assert.deepEqual(reduceQuantity("0.3l", "0.1l").left, "0.2l"); // no float noise (0.19999…)
  assert.deepEqual(reduceQuantity("2개", "2개"), { left: null, note: "2개 차감 → 모두 소진" });
  assert.deepEqual(reduceQuantity("2개", "5개"), { left: null, note: "5개 차감 → 모두 소진" }); // more than we have
  assert.deepEqual(reduceQuantity("4대", ""), { left: null, note: "전부 소진" });
  assert.match(reduceQuantity("1모", "2개").note, /단위가 달라/);
  assert.equal(reduceQuantity("1모", "2개").left, null);
  assert.equal(reduceQuantity("조금", "1개").left, null); // unknown stock text
  assert.equal(reduceQuantity("", "1개").left, null);
});

// ---------------------------------------------------------------------------------------------- finishCheckout
test("finishCheckout: attaches rows to kitchen items and computes quantity left / new expiry", () => {
  const plan = finishCheckout(rows("대파 1대 쓰고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달"), KITCHEN, T);
  assert.equal(plan.length, 3);
  assert.deepEqual([plan[0].action, plan[0].itemId, plan[0].amount, plan[0].quantityLeft], ["consume", KITCHEN[0].id, "1대", "3대"]);
  assert.deepEqual([plan[1].action, plan[1].itemId, plan[1].target, plan[1].newExpireDate], ["move", KITCHEN[3].id, "FREEZER", "2027-02-08"]); // frozen: today + 90 (dictionary)
  assert.deepEqual([plan[2].action, plan[2].itemId, plan[2].won, plan[2].category, plan[2].name], ["expense", null, 22000, "human_delivery", "치킨"]);
});

test("finishCheckout: validates rows from ANY source (an AI may return junk)", () => {
  const junk = [
    { name: "대파", action: "explode", amount: "1대", target_location: "" }, // unknown action
    { name: "", action: "consume", amount: "", target_location: "" }, // blank name
    { name: "삼겹살", action: "move", amount: "", target_location: "달나라" }, // bad target
    { name: "치킨", action: "expense", amount: "abc", target_location: "" }, // no amount
    { name: "치킨", action: "expense", amount: -5, target_location: "" }, // negative
    { name: "치킨", action: "expense", amount: 999_999_999_999, target_location: "" }, // over the cap
    { name: "치킨", action: "expense", amount: "22,000", target_location: "", category: "weapons" }, // bad category -> guessed
    { name: 42, action: "consume", amount: "", target_location: "" }, // not a string
    null,
    "oops",
    { name: "두부", action: "discard", amount: "ignored", target_location: "ignored" },
  ];
  const plan = finishCheckout(junk, KITCHEN, T);
  assert.deepEqual(plan.map((p) => [p.action, p.name]), [["expense", "치킨"], ["discard", "두부"]]);
  assert.equal(plan[0].won, 22000);
  assert.equal(plan[0].category, "human_groceries"); // 치킨 alone has no delivery word
  assert.equal(plan[1].amount, ""); // discard drops the amount
  assert.deepEqual(finishCheckout("not an array", KITCHEN, T), []);
  assert.deepEqual(finishCheckout(undefined, KITCHEN, T), []);
  assert.equal(finishCheckout(Array.from({ length: 80 }, () => ({ name: "두부", action: "discard", amount: "", target_location: "" })), KITCHEN, T).length, 30); // row cap
});

test("finishCheckout: items that are not in the kitchen stay unresolved; a move to the same place is flagged", () => {
  const plan = finishCheckout(rows("피자 1판 먹었어, 냉동만두는 냉동실로 보냈어"), KITCHEN, T);
  assert.equal(plan[0].itemId, null);
  assert.equal(describePlanRow(plan[0]).ok, false);
  assert.match(describePlanRow(plan[0]).text, /냉장고에서 찾지 못했어요/);
  assert.equal(plan[1].newExpireDate, null);
  assert.equal(plan[1].note, "이미 그 보관 장소에 있어요");
  assert.equal(describePlanRow(plan[1]).ok, false);
  const thaw = finishCheckout([{ name: "냉동만두", action: "move", amount: "", target_location: "냉장" }], KITCHEN, T)[0];
  assert.equal(thaw.newExpireDate, "2026-11-15"); // thawing never extends: min(2027-01-01, today + 5)
  const expired = finishCheckout([{ name: "소고기", action: "move", amount: "", target_location: "냉동" }], [inv("a", "소고기", "FRIDGE", "300g", "2026-11-08")], T)[0];
  assert.equal(expired.newExpireDate, "2026-11-08"); // freezing does not rescue an expired item
});

test("describePlanRow: the one-line previews", () => {
  const p = (r: Parameters<typeof finishCheckout>[0]) => describePlanRow(finishCheckout(r, KITCHEN, T)[0]);
  assert.deepEqual(p([{ name: "대파", action: "consume", amount: "", target_location: "" }]), { ok: true, text: "대파 소진 +3,000원" });
  assert.deepEqual(p([{ name: "대파", action: "consume", amount: "1대", target_location: "" }]), { ok: true, text: "대파 1대 차감 (3대 남음)" });
  assert.deepEqual(p([{ name: "삼겹살", action: "move", amount: "", target_location: "냉동" }]), { ok: true, text: "삼겹살 냉동 이동" });
  assert.deepEqual(p([{ name: "우유", action: "discard", amount: "", target_location: "" }]), { ok: true, text: "우유 폐기" });
  assert.deepEqual(p([{ name: "치킨", action: "expense", amount: 22000, target_location: "", category: "human_delivery" }]), { ok: true, text: "치킨 22,000원 지출" });
});

test("plan rows carry no unexpected fields (what the browser echoes back is re-validated server-side)", () => {
  const plan: CheckoutPlanRow[] = finishCheckout(rows("대파 썼어"), KITCHEN, T);
  assert.deepEqual(Object.keys(plan[0]).sort(), ["action", "amount", "category", "itemId", "name", "newExpireDate", "note", "quantityLeft", "target", "won"]);
});

// ---------------------------------------------------------------------------------------------- parity with the Python original
const PY = "D:/cooksaver/src";
test("parity: TypeScript parser == CookSaver bulk.parse_checkout_rules on a sentence corpus", { skip: !existsSync(`${PY}/cooksaver/bulk.py`) && "CookSaver source not present" }, () => {
  const sentences = [
    "대파 1대 썼고 계란 2개 먹었어, 남은 소고기는 냉동실로 보냈어", "치킨 22000원 배달", "사료 35,000원 구매", "우유 버렸어", "두부 상했어 곰팡이 났어",
    "마트에서 2만 5천원 장봤어", "치킨 2만원 시켜먹었어", "냉동만두 3개 먹었어 그리고 양파 1개 썼어", "소고기 냉장실로 옮겼어", "양파 반 개 썼어", "양파 실온에 두었어", "아무 말 대잔치",
    "삼겹살 300g 먹었어", "계란 2개 썼고 우유 1l 먹었는데 두부는 버렸어", "마트에서 35,000원 샀어", "삼겹살 3000원 어치 먹었어", "만두 3개 먹었어", "파프리카 1개 썼어", "피자는 버렸어",
    "대파를 다 썼어", "계란은 먹었어", "고양이 모래 12000원 배달", "5000원 썼어", "삼겹살 냉동했어", "먹다 남은 우유 상해서 버렸어", "소고기랑 삼겹살 먹었어", "두부 2모 먹었고 우유 반 먹었어",
    "냉동만두 냉장으로 옮겼어", "삼겹살 300g 냉동실로 옮겼어", "오늘 방금 대파 2대 썼어", "좀 남은 양파 다 썼어",
  ];
  const names = KITCHEN.map((k) => k.name);
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(PY)})
from cooksaver import bulk
data = json.loads(sys.stdin.read())
inv = [{"id": str(i), "name": n} for i, n in enumerate(data["names"])]
print(json.dumps([bulk.parse_checkout_rules(s, inv) for s in data["sentences"]], ensure_ascii=False))
`;
  const run = spawnSync("python", ["-X", "utf8", "-I", "-c", script], { input: JSON.stringify({ names, sentences }), encoding: "utf8" });
  if (run.status !== 0) assert.fail(`python failed: ${run.stderr}`);
  const ref = JSON.parse(run.stdout) as Record<string, unknown>[][];
  sentences.forEach((s, i) => {
    const got = rows(s).map((r) => ({ name: r.name, action: r.action, amount: r.amount, target_location: r.target_location, ...(r.action === "expense" ? { category: r.category } : {}) }));
    const want = ref[i].map((r) => ({ name: r.name, action: r.action, amount: r.amount, target_location: r.target_location, ...(r.action === "expense" ? { category: r.category } : {}) }));
    assert.deepEqual(got, want, `sentence: ${s}`);
  });
});
