// Unit tests for the combined household cash-flow summary (rentals + kitchen spending vs. defended savings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseholdCashflow } from "./cashflow.ts";

test("cashflow: fixed + variable = total, shares add up, defended kept separate", () => {
  const c = buildHouseholdCashflow({ rentalMonthly: 50_000, humanSpent: 85_000, petSpent: 15_000, savedMoney: 6_000 });
  assert.deepEqual([c.fixed, c.variable, c.total], [50_000, 100_000, 150_000]);
  assert.deepEqual(c.share, { fixed: 33, human: 57, pet: 10 });
  assert.equal(c.defended, 6_000);
  assert.equal(c.defendedPct, 6); // 6,000 / (6,000 + 100,000)
});

test("cashflow: zero states never divide by zero", () => {
  const z = buildHouseholdCashflow({ rentalMonthly: 0, humanSpent: 0, petSpent: 0, savedMoney: 0 });
  assert.deepEqual([z.total, z.share, z.defendedPct], [0, { fixed: 0, human: 0, pet: 0 }, null]);
  const onlyRental = buildHouseholdCashflow({ rentalMonthly: 30_000, humanSpent: 0, petSpent: 0, savedMoney: 0 });
  assert.deepEqual([onlyRental.total, onlyRental.share.fixed, onlyRental.defendedPct], [30_000, 100, null]);
  const onlySaved = buildHouseholdCashflow({ rentalMonthly: 0, humanSpent: 0, petSpent: 0, savedMoney: 9_000 });
  assert.deepEqual([onlySaved.total, onlySaved.defendedPct], [0, 100]);
});

test("cashflow: garbage numbers are treated as 0 (NaN, negative, Infinity, decimals rounded)", () => {
  const c = buildHouseholdCashflow({ rentalMonthly: Number.NaN, humanSpent: -5, petSpent: Number.POSITIVE_INFINITY, savedMoney: 1234.6 });
  assert.deepEqual([c.fixed, c.humanSpent, c.petSpent, c.defended, c.total], [0, 0, 0, 1235, 0]);
});
