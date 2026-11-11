// Unit tests for the money-log helpers (month bounds, recent entries, gauge percentage) and the budget stages they feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetLevel, monthBounds, recentExpenses, summarizeBudget, usedPercent } from "./kitchen-budget.ts";

test("monthBounds: first/last day, leap February, December, invalid", () => {
  assert.deepEqual(monthBounds("2026-11-10"), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(monthBounds("2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(monthBounds("2027-02-28"), { start: "2027-02-01", end: "2027-02-28" });
  assert.deepEqual(monthBounds("2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
  assert.equal(monthBounds("2027-02-29"), null);
  assert.equal(monthBounds("nope"), null);
});

test("recentExpenses: newest date first, same day = later entry on top, capped, input untouched", () => {
  const rows = [
    { id: "a", expense_date: "2026-11-05", created_at: "2026-11-05T01:00:00Z" },
    { id: "b", expense_date: "2026-11-09", created_at: "2026-11-09T01:00:00Z" },
    { id: "c", expense_date: "2026-11-09", created_at: "2026-11-09T05:00:00Z" },
    { id: "d", expense_date: "2026-11-01", created_at: "2026-11-01T01:00:00Z" },
    { id: "e", expense_date: "2026-11-07", created_at: "2026-11-07T01:00:00Z" },
  ];
  const copy = JSON.stringify(rows);
  assert.deepEqual(recentExpenses(rows, 3).map((r) => r.id), ["c", "b", "e"]);
  assert.equal(recentExpenses(rows).length, 3);
  assert.equal(recentExpenses(rows, 99).length, 5);
  assert.deepEqual(recentExpenses(rows, 0), []);
  assert.deepEqual(recentExpenses([], 3), []);
  assert.equal(JSON.stringify(rows), copy);
});

test("usedPercent: gauge percentage — 0 / rounding / over 100 / zero budget", () => {
  assert.equal(usedPercent(0, 100_000), 0);
  assert.equal(usedPercent(0, 0), 0);
  assert.equal(usedPercent(85_000, 100_000), 85);
  assert.equal(usedPercent(33_333, 100_000), 33);
  assert.equal(usedPercent(33_335, 100_000), 33);
  assert.equal(usedPercent(120_000, 100_000), 120);
  assert.equal(usedPercent(1, 0), 100); // spending against a 0-won budget reads as full
  assert.equal(usedPercent(-5, 100), 0);
});

test("the gauge colours follow the 80% / 100% stages exactly (79 ok, 80 warn, 99 warn, 100 danger)", () => {
  const level = (pct: number) => budgetLevel(pct * 1000, 100_000);
  assert.deepEqual([79, 80, 99, 100, 101].map(level), ["ok", "warn", "warn", "danger", "danger"]);
});

test("summary feeds the card: only this month, 3 newest, overspent => today's recommendation 0", () => {
  const S = { human_monthly_budget: 100_000, pet_monthly_budget: 50_000 };
  const e = (d: string, c: "human_groceries" | "human_delivery" | "pet_care", a: number) => ({ expense_date: d, category: c, amount: a });
  const s = summarizeBudget(S, [e("2026-11-02", "human_groceries", 60_000), e("2026-11-03", "human_delivery", 45_000), e("2026-11-04", "pet_care", 52_000), e("2026-10-30", "human_groceries", 999_999)], "2026-11-10");
  assert.ok(s);
  assert.deepEqual([s.human.spent, s.human.level, s.human.left, s.pet.level, s.todayBudget], [105_000, "danger", -5_000, "danger", 0]);
  const calm = summarizeBudget(S, [e("2026-11-02", "human_groceries", 30_000)], "2026-11-10");
  assert.deepEqual([calm?.human.level, calm?.todayBudget], ["ok", Math.floor(70_000 / 21)]);
});
