// Unit tests for the pure kitchen rule engine (src/features/kitchen/rules). No browser, no database, no network.
// Usage: npm run test:kitchen      (Node's built-in test runner; imports the TypeScript sources directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const R = await import("../src/features/kitchen/rules/index.ts");

// ------------------------------------------------------------------------------------------------ dates
test("date-utils: real calendar dates, leap years (윤달/윤일)", () => {
  assert.equal(R.isValidDate("2028-02-29"), true);
  assert.equal(R.isValidDate("2000-02-29"), true);
  assert.equal(R.isValidDate("2027-02-29"), false);
  assert.equal(R.isValidDate("2100-02-29"), false); // century rule
  assert.equal(R.isValidDate("2026-13-01"), false);
  assert.equal(R.isValidDate("2026-04-31"), false);
  assert.equal(R.isValidDate("2026-4-1"), false);
  assert.equal(R.isValidDate(20260101), false);
  assert.equal(R.isLeapYear(2028) && R.isLeapYear(2000) && !R.isLeapYear(2100) && !R.isLeapYear(2027), true);
  assert.equal(R.daysInMonth(2028, 2), 29);
  assert.equal(R.daysInMonth(2027, 2), 28);
  assert.equal(R.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(R.addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(R.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(R.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(R.daysBetween("2028-03-01", "2028-02-01"), 29);
  assert.equal(R.daysBetween("2027-03-01", "2027-02-01"), 28);
  assert.equal(R.toDateOnly("2026-11-09T03:00:00Z"), "2026-11-09");
  assert.equal(R.toDateOnly("2026-11-09 03:00:00+09"), "2026-11-09");
  assert.equal(R.toDateOnly("2026-02-30"), null);
  assert.equal(R.toDateOnly(null), null);
  assert.equal(R.toDateOnly("yesterday"), null);
});

// ------------------------------------------------------------------------------------------------ shelf life
test("shelf-life: dictionary has exactly the 50 CookSaver ingredients and the headline values", () => {
  assert.equal(Object.keys(R.SHELF_LIFE).length, 50);
  assert.equal(R.SHELF_LIFE.계란.FRIDGE, 21);
  assert.equal(R.SHELF_LIFE.우유.FRIDGE, 10);
  assert.equal(R.SHELF_LIFE.두부.FRIDGE, 7);
  assert.equal(R.SHELF_LIFE.삼겹살.FRIDGE, 3); // raw meat: 3 days chilled …
  assert.equal(R.SHELF_LIFE.삼겹살.FREEZER, 90); // … or 90 frozen
  assert.equal(R.SHELF_LIFE.소고기.FRIDGE, 3);
  assert.equal(R.SHELF_LIFE.닭고기.FRIDGE, 2);
  assert.equal(R.SHELF_LIFE.참치캔.ROOM_TEMP, 365);
  for (const [k, table] of Object.entries(R.SHELF_LIFE)) {
    assert.ok(Object.keys(table).length >= 1, `${k} has an entry`);
    for (const days of Object.values(table)) assert.ok(Number.isInteger(days) && days > 0, `${k} positive integer days`);
  }
  assert.deepEqual(R.DEFAULT_DAYS, { FRIDGE: 5, FREEZER: 30, ROOM_TEMP: 90 });
});

test("shelf-life: storageAndDays — dictionary, aliases, explicit storage words, prepared cuts, processed foods", () => {
  const sd = (n) => { const r = R.storageAndDays(n); return [r.storage, r.days]; };
  assert.deepEqual(sd("계란"), ["FRIDGE", 21]);
  assert.deepEqual(sd("달걀 30구"), ["FRIDGE", 21]); // alias
  assert.deepEqual(sd("우유"), ["FRIDGE", 10]);
  assert.deepEqual(sd("찌개용 두부"), ["FRIDGE", 7]);
  assert.deepEqual(sd("양파"), ["ROOM_TEMP", 30]); // usual place = first key
  assert.deepEqual(sd("냉동 삼겹살"), ["FREEZER", 90]); // typed place wins
  assert.deepEqual(sd("삼겹살"), ["FRIDGE", 3]);
  assert.deepEqual(sd("냉동 두부"), ["FREEZER", 30]); // typed place the table lacks -> that place's default
  assert.deepEqual(sd("깐양파"), ["FRIDGE", 5]); // prepared cut: chilled, at most 5
  assert.deepEqual(sd("다진마늘"), ["FRIDGE", 5]);
  assert.deepEqual(sd("깐 대파"), ["FRIDGE", 5]); // min(7, 5)
  assert.deepEqual(sd("치즈라면"), ["ROOM_TEMP", 180]); // head noun is last -> 라면
  assert.deepEqual(sd("신라면"), ["ROOM_TEMP", 180]);
  assert.deepEqual(sd("우유식빵"), ["ROOM_TEMP", 5]); // 식빵, not 우유
  assert.deepEqual(sd("참치캔"), ["ROOM_TEMP", 365]);
  assert.deepEqual(sd("감자칩"), ["ROOM_TEMP", 90]); // processed: dictionary NOT used (감자 would be 30)
  assert.equal(R.shelfEntry("토마토소스"), null);
  assert.equal(R.shelfEntry("딸기잼"), null);
  assert.deepEqual(sd("생고기"), ["FREEZER", 30]); // not in the dictionary: keyword rule + default days
  assert.deepEqual(sd("초코파이"), ["FRIDGE", 5]);
  assert.deepEqual(sd(""), ["FRIDGE", 5]);
  assert.equal(R.storageAndDays("계란").source, "dictionary");
  assert.equal(R.storageAndDays("초코파이").source, "default");
});

test("shelf-life: dictionaryDays / defaultExpireDate (leap year, month and year rollover)", () => {
  assert.equal(R.dictionaryDays("두부", "FRIDGE"), 7);
  assert.equal(R.dictionaryDays("두부", "FREEZER"), null);
  assert.equal(R.dictionaryDays("깐양파", "FRIDGE"), 5);
  assert.equal(R.dictionaryDays("초코파이", "FRIDGE"), null);
  assert.equal(R.defaultExpireDate("계란", "2028-02-10").expireDate, "2028-03-02"); // leap February
  assert.equal(R.defaultExpireDate("계란", "2027-02-10").expireDate, "2027-03-03");
  assert.equal(R.defaultExpireDate("계란", "2026-12-20").expireDate, "2027-01-10"); // year rollover
  assert.equal(R.defaultExpireDate("두부", "2026-11-10", "FREEZER").days, 30); // chosen place without a table entry -> default
  assert.equal(R.defaultExpireDate("삼겹살", "2026-11-10", "FREEZER").expireDate, "2027-02-08");
  const d = R.defaultExpireDate("초코파이", "2026-11-10");
  assert.deepEqual([d.storage, d.days, d.expireDate, d.source], ["FRIDGE", 5, "2026-11-15", "default"]);
});

// ------------------------------------------------------------------------------------------------ expiry
test("expiry: dday is negative once expired; labels D-Day / D-n / D+n", () => {
  assert.equal(R.dday("2026-11-10", "2026-11-10"), 0);
  assert.equal(R.dday("2026-11-15", "2026-11-10"), 5);
  assert.equal(R.dday("2026-11-08", "2026-11-10"), -2);
  assert.equal(R.dday("2027-01-02", "2026-12-31"), 2); // year boundary
  assert.equal(R.dday("2026-12-30", "2027-01-02"), -3);
  assert.equal(R.dday("2028-03-01", "2028-02-27"), 3); // leap: 27→28→29→Mar 1
  assert.equal(R.dday("2027-03-01", "2027-02-27"), 2);
  assert.equal(R.dday("2026-02-30", "2026-02-01"), null); // impossible date
  assert.equal(R.dday("not-a-date", "2026-02-01"), null);
  assert.equal(R.dday("2026-02-01", "garbage"), null);
  assert.equal(R.ddayLabel(0), "D-Day");
  assert.equal(R.ddayLabel(5), "D-5");
  assert.equal(R.ddayLabel(-2), "D+2");
});

test("expiry: URGENT (<= 3, expired included) and the 3-colour traffic light boundaries", () => {
  assert.equal(R.URGENT_DAYS, 3);
  for (const [n, u] of [[-30, true], [-1, true], [0, true], [3, true], [4, false], [30, false]]) assert.equal(R.isUrgent(n), u, `urgent(${n})`);
  for (const [n, c] of [[-5, "red"], [0, "red"], [2, "red"], [3, "yellow"], [7, "yellow"], [8, "green"], [90, "green"]]) assert.equal(R.trafficLight(n), c, `light(${n})`);
  const e = R.expiryInfo("2026-11-08", "2026-11-10");
  assert.deepEqual(e, { days: -2, label: "D+2", light: "red", urgent: true, expired: true });
  const ok = R.expiryInfo("2026-11-20", "2026-11-10");
  assert.deepEqual(ok, { days: 10, label: "D-10", light: "green", urgent: false, expired: false });
  const today = R.expiryInfo("2026-11-10", "2026-11-10");
  assert.equal(today.expired, false); // expiring TODAY is not yet expired
  assert.equal(today.label, "D-Day");
  assert.equal(R.expiryInfo("2026-13-40", "2026-11-10"), null);
});

test("expiry: freezer fossil (>= 30 days frozen) edge cases", () => {
  const T = "2026-11-10";
  const fz = (added_at) => ({ storage_type: "FREEZER", added_at });
  assert.equal(R.FOSSIL_DAYS, 30);
  assert.equal(R.isFossil(fz("2026-10-11"), T), true); // exactly 30 days
  assert.equal(R.isFossil(fz("2026-10-12"), T), false); // 29 days
  assert.equal(R.isFossil(fz("2025-01-01"), T), true);
  assert.equal(R.isFossil(fz("2026-11-10"), T), false); // added today
  assert.equal(R.isFossil(fz("2026-12-01"), T), false); // future date: never a fossil
  assert.equal(R.isFossil(fz("2026-10-11T08:30:00+09:00"), T), true); // timestamp accepted
  assert.equal(R.isFossil(fz(null), T), false);
  assert.equal(R.isFossil(fz(undefined), T), false);
  assert.equal(R.isFossil(fz("2026-02-30"), T), false); // invalid date
  assert.equal(R.isFossil({ storage_type: "FRIDGE", added_at: "2020-01-01" }, T), false); // only the freezer
  assert.equal(R.isFossil({ storage_type: "ROOM_TEMP", added_at: "2020-01-01" }, T), false);
  assert.equal(R.isFossil(fz("2028-01-31"), "2028-03-01"), true); // leap year: Jan 31 → Mar 1 = 30 days
  assert.equal(R.isFossil(fz("2027-01-31"), "2027-03-01"), false); // 29 days in a common year
  assert.equal(R.frozenDays("2026-10-11", T), 30);
  assert.equal(R.frozenDays("2026-12-01", T), -21);
  assert.equal(R.frozenDays(null, T), null);
});

// ------------------------------------------------------------------------------------------------ pet safety
test("pet-safety: toxic / safe / unknown, toxic always wins, whitespace and bad input", () => {
  for (const n of ["양파", "깐양파", "대파", "쪽파", "마늘", "다진 마늘", "부추", "포도", "건포도", "초콜릿", "초콜렛", "코코아", "아보카도", "자일리톨 껌", "마카다미아", "커피", "맥주", "와인"]) {
    assert.equal(R.isPetToxic(n), true, `${n} toxic`);
    assert.equal(R.petSafety(n), "toxic");
  }
  for (const n of ["닭가슴살", "소고기", "당근", "단호박", "브로콜리", "양배추", "두부", "계란", "달걀", "고구마", "오이"]) {
    assert.equal(R.isPetSafe(n), true, `${n} safe`);
    assert.equal(R.petSafety(n), "safe");
    assert.equal(R.isPetToxic(n), false);
  }
  assert.equal(R.isPetToxic("양 파"), true); // whitespace ignored
  assert.equal(R.isPetToxic("닭 가슴 살"), false);
  assert.equal(R.isPetSafe("닭 가슴 살"), true);
  assert.equal(R.isPetSafe("양파 닭가슴살 볶음"), false); // toxic wins over safe
  assert.equal(R.petSafety("초콜릿 쿠키"), "toxic");
  assert.equal(R.petSafety("딸기"), "unknown");
  assert.equal(R.petSafety("사료"), "unknown");
  for (const bad of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(R.isPetToxic(bad), false);
    assert.equal(R.isPetSafe(bad), false);
    assert.equal(R.petSafety(bad), "unknown");
  }
  assert.equal(R.toxicMatch("깐양파 500g"), "양파");
  assert.equal(R.toxicMatch("당근"), null);
  assert.equal(R.PET_TREAT_DAYS, 2);
});

// ------------------------------------------------------------------------------------------------ budget
const S = (h = 350_000, p = 100_000) => ({ human_monthly_budget: h, pet_monthly_budget: p });
const ex = (d, c, a) => ({ expense_date: d, category: c, amount: a });

test("budget: burn-rate stages at the exact 80% and 100% boundaries", () => {
  assert.equal(R.budgetLevel(0, 100_000), "ok");
  assert.equal(R.budgetLevel(79_999, 100_000), "ok");
  assert.equal(R.budgetLevel(80_000, 100_000), "warn"); // exactly 80%
  assert.equal(R.budgetLevel(99_999, 100_000), "warn");
  assert.equal(R.budgetLevel(100_000, 100_000), "danger"); // exactly 100%
  assert.equal(R.budgetLevel(250_000, 100_000), "danger");
  assert.equal(R.budgetLevel(0, 0), "ok"); // no budget, no spending
  assert.equal(R.budgetLevel(1, 0), "danger"); // no budget, any spending
  assert.equal(R.budgetLevel(5, -10), "danger"); // nonsense budget never throws
  assert.equal(R.budgetLevel(280_000, 350_000), "warn"); // 80% of 350,000 = 280,000 exactly
  assert.equal(R.budgetLevel(279_999, 350_000), "ok");
  assert.equal(R.burnRatio(1, 3), 0.3333);
  assert.equal(R.burnRatio(0, 0), 0);
  assert.equal(R.burnRatio(10, 0), 1);
  assert.equal(R.burnRatio(150, 100), 1.5);
});

test("budget: days left counts today (leap February, month end, invalid dates)", () => {
  assert.equal(R.daysLeftInMonth("2026-11-10"), 21);
  assert.equal(R.daysLeftInMonth("2026-11-30"), 1);
  assert.equal(R.daysLeftInMonth("2026-11-01"), 30);
  assert.equal(R.daysLeftInMonth("2028-02-10"), 20); // leap
  assert.equal(R.daysLeftInMonth("2027-02-10"), 19);
  assert.equal(R.daysLeftInMonth("2028-02-29"), 1);
  assert.equal(R.daysLeftInMonth("2026-12-31"), 1);
  assert.equal(R.daysLeftInMonth("2027-02-29"), null);
  assert.equal(R.daysLeftInMonth("nope"), null);
});

test("budget: recommended daily spend — floors, never negative, overspent = 0 won", () => {
  assert.equal(R.recommendedDaily(350_000, 21), 16_666);
  assert.equal(R.recommendedDaily(100, 3), 33);
  assert.equal(R.recommendedDaily(2, 3), 0);
  assert.equal(R.recommendedDaily(0, 10), 0);
  assert.equal(R.recommendedDaily(-50_000, 10), 0); // over budget -> 0
  assert.equal(R.recommendedDaily(90_000, 1), 90_000); // last day gets everything left
  assert.equal(R.recommendedDaily(1000, 0), 0); // no days left: guarded, no Infinity / NaN
  assert.equal(R.recommendedDaily(Number.NaN, 5), 0);
});

test("budget: summarizeBudget — month filter, categories, overspend, level per part", () => {
  const rows = [
    ex("2026-11-01", "human_groceries", 100_000),
    ex("2026-11-05", "human_delivery", 60_000),
    ex("2026-11-09", "pet_care", 85_000),
    ex("2026-10-31", "human_groceries", 999_999), // last month: ignored
    ex("2026-12-01", "human_delivery", 999_999), // next month: ignored
  ];
  const s = R.summarizeBudget(S(), rows, "2026-11-10");
  assert.equal(s.month, "2026-11");
  assert.deepEqual(s.totals, { human_groceries: 100_000, human_delivery: 60_000, pet_care: 85_000 });
  assert.deepEqual(s.human, { monthly: 350_000, spent: 160_000, left: 190_000, ratio: 0.4571, level: "ok" });
  assert.deepEqual(s.pet, { monthly: 100_000, spent: 85_000, left: 15_000, ratio: 0.85, level: "warn" }); // pet is judged separately
  assert.equal(s.daysLeft, 21);
  assert.equal(s.todayBudget, 9_047); // floor(190000 / 21)

  const over = R.summarizeBudget(S(100_000, 50_000), [ex("2026-11-02", "human_groceries", 130_000), ex("2026-11-03", "pet_care", 50_000)], "2026-11-10");
  assert.equal(over.human.left, -30_000); // overspent shows as negative left …
  assert.equal(over.human.level, "danger");
  assert.equal(over.todayBudget, 0); // … but today's recommendation is 0 won
  assert.equal(over.pet.level, "danger");
  assert.equal(over.pet.left, 0);

  const empty = R.summarizeBudget(S(), [], "2026-11-10");
  assert.equal(empty.human.spent, 0);
  assert.equal(empty.human.level, "ok");
  assert.equal(empty.todayBudget, 16_666);

  const zero = R.summarizeBudget(S(0, 0), [], "2026-11-10");
  assert.equal(zero.todayBudget, 0);
  assert.equal(zero.human.level, "ok");

  const lastDay = R.summarizeBudget(S(100_000, 0), [ex("2026-11-30", "human_groceries", 40_000)], "2026-11-30");
  assert.equal(lastDay.daysLeft, 1);
  assert.equal(lastDay.todayBudget, 60_000);

  const leap = R.summarizeBudget(S(290_000, 0), [], "2028-02-10"); // 20 days left in a leap February
  assert.equal(leap.daysLeft, 20);
  assert.equal(leap.todayBudget, 14_500);

  assert.equal(R.summarizeBudget(S(), [], "2027-02-29"), null); // invalid date
  const ts = R.summarizeBudget(S(), [ex("2026-11-05T10:00:00Z", "human_groceries", 1000)], "2026-11-10"); // timestamp-ish dates still filter by month
  assert.equal(ts.totals.human_groceries, 1000);
});

// ------------------------------------------------------------------------------------------------ defrost
test("defrost-guide: group per ingredient, priority order, safe default", () => {
  const g = (n) => R.defrostInfo(n).group;
  assert.equal(g("냉동 삼겹살"), "육류/가금류");
  assert.equal(R.defrostInfo("냉동 삼겹살").defrost, "전자레인지 200W(해동모드) 3~4분");
  assert.equal(R.defrostInfo("닭가슴살").odor, "청주·생강즙으로 잡내 제거");
  assert.equal(g("한우 등심"), "육류/가금류");
  assert.equal(g("고등어"), "생선/해물");
  assert.equal(R.defrostInfo("새우").defrost, "소금물 15분 침지 해동");
  assert.equal(R.defrostInfo("연어").odor, "레몬즙·식초로 비린내 제거");
  assert.equal(g("만두"), "채소/만두");
  assert.equal(R.defrostInfo("시금치").defrost, "해동 없이 냉동 상태로 즉시 가열 조리 권장");
  assert.equal(R.defrostInfo("시금치").odor, ""); // vegetables have no odor tip
  assert.equal(g("즉석밥"), "밥/떡/빵");
  assert.equal(R.defrostInfo("식빵").defrost, "물 한 컵과 함께 전자레인지 2분");
  assert.equal(g("고기만두"), "채소/만두"); // processed (dumpling) is checked before raw meat
  assert.equal(g("볶음밥"), "밥/떡/빵"); // rice first
  assert.equal(g("닭고기 야채죽"), "채소/만두"); // 야채 is listed before 닭 in priority order
  assert.deepEqual(R.defrostInfo("아이스크림"), R.DEFROST_DEFAULT);
  assert.equal(R.defrostInfo("???").group, "기타");
  for (const bad of ["", null, undefined, 7]) assert.deepEqual(R.defrostInfo(bad), R.DEFROST_DEFAULT);
  const a = R.defrostInfo("??"), b = R.defrostInfo("??");
  a.defrost = "mutated";
  assert.notEqual(b.defrost, "mutated"); // callers cannot corrupt the shared default
  assert.equal(R.DEFROST_DEFAULT.defrost, "냉장실에서 천천히 해동");
});

// ------------------------------------------------------------------------------------------------ parity with the Python original
const PY = "D:/cooksaver/src";
test("parity: TypeScript rules agree with the original Python (CookSaver bulk.py) on a name corpus", { skip: !existsSync(`${PY}/cooksaver/bulk.py`) && "CookSaver source not present" }, () => {
  const names = [
    "계란", "달걀", "우유", "두부", "찌개용 두부", "콩나물", "요거트", "슬라이스치즈", "버터", "생크림", "삼겹살", "냉동 삼겹살", "냉동 대패삼겹살", "목살", "소고기", "한우 등심", "돼지고기", "닭가슴살", "닭다리", "다짐육",
    "햄", "소시지", "베이컨", "고등어", "오징어", "새우", "연어", "어묵", "대파", "손질 대파", "쪽파", "양파", "깐양파", "마늘", "다진마늘", "깐마늘", "감자", "감자칩", "고구마", "당근", "양배추", "배추", "상추", "깻잎",
    "시금치", "부추", "오이", "애호박", "청양고추", "표고버섯", "방울토마토", "토마토소스", "사과", "단감", "바나나", "딸기", "딸기잼", "귤", "포도", "김치", "식빵", "우유식빵", "라면", "신라면", "치즈라면", "즉석밥", "참치캔",
    "참치김밥", "통조림 햄", "생고기", "초코파이", "아이스크림", "냉동 만두", "실온 보관 쌀", "냉장 두부", "냉동 두부", "간장", "쌈장", "과일 주스", "마늘빵", "양파링", "", "   ", "소고기 미역국", "볶음밥", "떡볶이 떡", "냉동 새우",
  ];
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(PY)})
from cooksaver import bulk
names = json.loads(sys.stdin.read())
out = []
for n in names:
    cat, days = bulk.storage_and_days(n)
    out.append({"n": n, "cat": cat, "days": days, "toxic": bulk.pet_toxic(n), "safe": bulk.pet_safe(n), "defrost": bulk.defrost_info(n) if n.strip() else None,
                "dd": {c: bulk.dictionary_days(n, c) for c in ("냉장", "냉동", "실온")}})
print(json.dumps(out, ensure_ascii=False))
`;
  const run = spawnSync("python", ["-X", "utf8", "-I", "-c", script], { input: JSON.stringify(names), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (run.status !== 0) assert.fail(`python failed: ${run.stderr}`);
  const ref = JSON.parse(run.stdout);
  const KO = { FRIDGE: "냉장", FREEZER: "냉동", ROOM_TEMP: "실온" };
  const EN = { 냉장: "FRIDGE", 냉동: "FREEZER", 실온: "ROOM_TEMP" };
  assert.equal(ref.length, names.length);
  for (const r of ref) {
    const got = R.storageAndDays(r.n);
    assert.deepEqual([KO[got.storage], got.days], [r.cat, r.days], `storage/days for "${r.n}"`);
    assert.equal(R.isPetToxic(r.n), r.toxic, `toxic "${r.n}"`);
    assert.equal(R.isPetSafe(r.n), r.safe, `safe "${r.n}"`);
    if (r.defrost) {
      const d = R.defrostInfo(r.n);
      assert.deepEqual({ group: d.group, defrost: d.defrost, odor: d.odor }, r.defrost, `defrost "${r.n}"`);
    }
    for (const [ko, days] of Object.entries(r.dd)) assert.equal(R.dictionaryDays(r.n, EN[ko]), days, `dictionaryDays "${r.n}" ${ko}`);
  }
});

test("parity: budget summary matches the Python budget.summary on randomised inputs", { skip: !existsSync(`${PY}/cooksaver/budget.py`) && "CookSaver source not present" }, () => {
  let seed = 12345;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const cases = [];
  const todays = ["2026-11-10", "2026-11-30", "2028-02-10", "2027-02-28", "2026-12-31", "2026-01-01"];
  for (let i = 0; i < 60; i++) {
    const today = todays[rnd(todays.length)];
    const month = today.slice(0, 7);
    const expenses = Array.from({ length: rnd(8) }, () => ({
      date: rnd(4) === 0 ? "2025-06-15" : `${month}-${String(1 + rnd(27)).padStart(2, "0")}`,
      category: ["human_groceries", "human_delivery", "pet_care"][rnd(3)],
      amount: 1 + rnd(120_000),
    }));
    cases.push({ today, human: rnd(5) === 0 ? 0 : rnd(400_000), pet: rnd(5) === 0 ? 0 : rnd(150_000), expenses });
  }
  const script = `
import sys, json
from datetime import date
sys.path.insert(0, ${JSON.stringify(PY)})
from cooksaver import budget
out = []
for c in json.loads(sys.stdin.read()):
    b = {"human_monthly": c["human"], "pet_monthly": c["pet"], "current_month": c["today"][:7], "expenses": [{"id": f"e{i}", **e} for i, e in enumerate(c["expenses"])]}
    s = budget.summary(b, date.fromisoformat(c["today"]))
    out.append({"human": s["human"], "pet": s["pet"], "days_left": s["days_left"], "today_budget": s["today_budget"], "totals": s["totals"]})
print(json.dumps(out))
`;
  const run = spawnSync("python", ["-X", "utf8", "-I", "-c", script], { input: JSON.stringify(cases), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (run.status !== 0) assert.fail(`python failed: ${run.stderr}`);
  const ref = JSON.parse(run.stdout);
  cases.forEach((c, i) => {
    const got = R.summarizeBudget(
      { human_monthly_budget: c.human, pet_monthly_budget: c.pet },
      c.expenses.map((e) => ({ expense_date: e.date, category: e.category, amount: e.amount })),
      c.today,
    );
    const r = ref[i];
    const tag = `case ${i} ${JSON.stringify({ t: c.today, h: c.human, p: c.pet })}`;
    assert.deepEqual(got.human, r.human, `human ${tag}`);
    assert.deepEqual(got.pet, r.pet, `pet ${tag}`);
    assert.equal(got.daysLeft, r.days_left, `days_left ${tag}`);
    assert.equal(got.todayBudget, r.today_budget, `today_budget ${tag}`);
    assert.deepEqual(got.totals, r.totals, `totals ${tag}`);
  });
});
