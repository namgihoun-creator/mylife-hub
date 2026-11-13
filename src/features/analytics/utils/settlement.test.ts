import { test } from "node:test";
import assert from "node:assert/strict";
import { EST_WON_PER_ITEM, buildSettlement, foodHeadline, teamMessage, type SettlementInput } from "./settlement.ts";
import { isMonth, monthRange, nextMonth, pickMonth, prevMonth, shiftMonth } from "./month.ts";
import { diffText, summarizeBills } from "./bills.ts";

const base = (over: Partial<SettlementInput> = {}): SettlementInput => ({ month: "2026-11", today: "2026-11-20", humanBudget: 400000, expenses: [], activity: [], expiredInStock: 0, taskEvents: [], ...over });

test("food: only groceries + delivery count; saved / over / even / no budget", () => {
  const e = (category: string, amount: number) => ({ category, amount });
  const saved = buildSettlement(base({ expenses: [e("human_groceries", 150000), e("human_delivery", 50000), e("pet_care", 999999)] })).food;
  assert.deepEqual({ spent: saved.spent, groceries: saved.groceries, delivery: saved.delivery, usedPct: saved.usedPct, defendedPct: saved.defendedPct, diff: saved.diff, status: saved.status }, { spent: 200000, groceries: 150000, delivery: 50000, usedPct: 50, defendedPct: 50, diff: 200000, status: "SAVED" });
  const over = buildSettlement(base({ expenses: [e("human_groceries", 300000), e("human_delivery", 140000)] })).food;
  assert.deepEqual({ usedPct: over.usedPct, defendedPct: over.defendedPct, diff: over.diff, status: over.status }, { usedPct: 110, defendedPct: 0, diff: -40000, status: "OVER" });
  assert.equal(buildSettlement(base({ expenses: [e("human_groceries", 400000)] })).food.status, "EVEN");
  const none = buildSettlement(base({ humanBudget: 0, expenses: [e("human_groceries", 5000)] })).food;
  assert.deepEqual({ status: none.status, usedPct: none.usedPct, defendedPct: none.defendedPct }, { status: "NO_BUDGET", usedPct: 0, defendedPct: 0 });
  assert.equal(buildSettlement(base({ expenses: [e("human_groceries", -5), e("human_groceries", Number.NaN)] })).food.spent, 0);
});

test("food headline wording", () => {
  const f = (over: Partial<SettlementInput>) => foodHeadline(buildSettlement(base(over)).food);
  assert.equal(f({ expenses: [{ category: "human_groceries", amount: 280000 }] }), "120,000원 절약했어요");
  assert.equal(f({ expenses: [{ category: "human_groceries", amount: 430000 }] }), "30,000원 초과했어요");
  assert.equal(f({ humanBudget: 0 }), "식비 예산이 아직 없어요");
});

test("waste: logged discards (their estimate or 3,000원) + expired items still in the storage", () => {
  const w = buildSettlement(base({ activity: [{ kind: "DISCARDED", est_amount: 3000 }, { kind: "DISCARDED", est_amount: 5000 }, { kind: "DISCARDED", est_amount: 0 }, { kind: "CONSUMED" }], expiredInStock: 2 })).waste;
  assert.deepEqual(w, { logReady: true, discardedCount: 3, stockCount: 2, count: 5, estimatedWon: 3000 + 5000 + 3000 + 2 * 3000, perItemWon: EST_WON_PER_ITEM });
});

test("waste: without the activity log only the stock part is counted and the block says so", () => {
  const w = buildSettlement(base({ activity: null, expiredInStock: 4 })).waste;
  assert.deepEqual({ logReady: w.logReady, count: w.count, estimatedWon: w.estimatedWon }, { logReady: false, count: 4, estimatedWon: 12000 });
});

test("team: tasks + used-up + shopping, contributors from user ids (discards are not teamwork)", () => {
  const t = buildSettlement(
    base({
      taskEvents: [{ actor_identifier: "user:a" }, { actor_identifier: "user:b" }, { actor_identifier: "magic:token-hash" }, { actor_identifier: null }],
      activity: [{ kind: "CONSUMED", created_by: "a" }, { kind: "SHOPPED", created_by: "b" }, { kind: "SHOPPED", created_by: "b" }, { kind: "DISCARDED", created_by: "c" }],
    }),
  ).team;
  assert.deepEqual(t, { logReady: true, tasks: 4, consumed: 1, shopped: 2, total: 7, contributors: 2 });
  assert.equal(teamMessage(t), "2명이 함께 7건을 해냈어요!");
  assert.match(teamMessage({ ...t, contributors: 1 }), /파트너와 나눠/);
  assert.equal(teamMessage({ ...t, total: 0, tasks: 0, consumed: 0, shopped: 0 }), "이 달에는 아직 함께 한 기록이 없어요.");
  assert.equal(buildSettlement(base({ activity: null })).team.logReady, false);
});

test("settlement: isCurrentMonth follows today's month", () => {
  assert.equal(buildSettlement(base()).isCurrentMonth, true);
  assert.equal(buildSettlement(base({ month: "2026-10" })).isCurrentMonth, false);
});

test("month helpers: shift across years, range of a Seoul month, validity", () => {
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(shiftMonth("2026-03", -14), "2025-01");
  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28", startIso: "2026-02-01T00:00:00+09:00", endIso: "2026-03-01T00:00:00+09:00" });
  assert.equal(monthRange("2028-02")?.end, "2028-02-29");
  assert.equal(monthRange("2026-13"), null);
  assert.equal(isMonth("2026-10"), true);
  for (const bad of ["2026-1", "202610", "2026-00", "2026-13", "", null, 5]) assert.equal(isMonth(bad), false);
  assert.equal(pickMonth("2026-09", "2026-11"), "2026-09");
  assert.equal(pickMonth("2027-01", "2026-11"), "2026-11"); // never the future
  assert.equal(pickMonth("garbage", "2026-11"), "2026-11");
  assert.equal(pickMonth(undefined, "2026-11"), "2026-11");
});

test("bills: month total, change vs last month (amount and %), split by type", () => {
  const bills = [
    { bill_type: "ELECTRICITY", billing_month: "2026-10", amount: 48230 },
    { bill_type: "MAINTENANCE", billing_month: "2026-10", amount: 152000 },
    { bill_type: "GAS", billing_month: "2026-10", amount: 21000 },
    { bill_type: "ELECTRICITY", billing_month: "2026-09", amount: 40000 },
    { bill_type: "MAINTENANCE", billing_month: "2026-09", amount: 150000 },
    { bill_type: "WATER", billing_month: "2026-08", amount: 99999 },
    { bill_type: "MYSTERY", billing_month: "2026-10", amount: 1000 },
  ];
  const s = summarizeBills(bills, "2026-10");
  assert.equal(s.total, 48230 + 152000 + 21000 + 1000);
  assert.equal(s.prevTotal, 190000);
  assert.equal(s.diff, 222230 - 190000);
  assert.equal(s.diffPct, 17);
  assert.deepEqual(s.byType.map((t) => t.type), ["MAINTENANCE", "ELECTRICITY", "GAS", "ETC"]);
  assert.equal(diffText(s), "+32,230원 (▲ 17%)");
});

test("bills: nothing to compare with -> null diff and a clear label; decreases; unchanged", () => {
  const first = summarizeBills([{ bill_type: "GAS", billing_month: "2026-10", amount: 10000 }], "2026-10");
  assert.deepEqual({ diff: first.diff, pct: first.diffPct, prevCount: first.prevCount }, { diff: null, pct: null, prevCount: 0 });
  assert.equal(diffText(first), "전월 기록 없음");
  const down = summarizeBills([{ bill_type: "GAS", billing_month: "2026-10", amount: 9000 }, { bill_type: "GAS", billing_month: "2026-09", amount: 12000 }], "2026-10");
  assert.equal(diffText(down), "-3,000원 (▼ 25%)");
  const same = summarizeBills([{ bill_type: "GAS", billing_month: "2026-10", amount: 9000 }, { bill_type: "GAS", billing_month: "2026-09", amount: 9000 }], "2026-10");
  assert.equal(diffText(same), "전월과 같아요");
  assert.equal(summarizeBills(null, "2026-10").total, 0);
  const zeroPrev = summarizeBills([{ bill_type: "GAS", billing_month: "2026-10", amount: 5000 }, { bill_type: "GAS", billing_month: "2026-09", amount: 0 }], "2026-10");
  assert.deepEqual({ diff: zeroPrev.diff, pct: zeroPrev.diffPct }, { diff: 5000, pct: null });
  assert.equal(summarizeBills([{ bill_type: "GAS", billing_month: "2025-12", amount: 7000 }, { bill_type: "GAS", billing_month: "2026-01", amount: 8000 }], "2026-01").prevTotal, 7000); // year boundary
});
