import { test } from "node:test";
import assert from "node:assert/strict";
import { fridgeChipLabel, isFridgeAsset } from "./fridge.ts";

test("isFridgeAsset: category '냉장고' or a name with 냉장고/냉동고 (incl. 김치냉장고), spaces ignored", () => {
  assert.equal(isFridgeAsset({ name: "삼성 비스포크", category: "냉장고" }), true);
  assert.equal(isFridgeAsset({ name: "딤채 김치냉장고", category: null }), true);
  assert.equal(isFridgeAsset({ name: "김치 냉장고", category: "생활가전" }), true);
  assert.equal(isFridgeAsset({ name: "미니 냉동고", category: "가전" }), true);
  assert.equal(isFridgeAsset({ name: "우리집 냉 장 고", category: null }), true);
  assert.equal(isFridgeAsset({ name: "LG 냉장고 4도어", category: "주방가전" }), true);
  assert.equal(isFridgeAsset({ name: "에어컨", category: "냉난방" }), false);
  assert.equal(isFridgeAsset({ name: "정수기", category: "정수기" }), false);
  assert.equal(isFridgeAsset({ name: "냉장", category: "냉동식품" }), false); // not a fridge appliance
  assert.equal(isFridgeAsset({ name: null, category: null }), false);
  assert.equal(isFridgeAsset({}), false);
});

test("fridgeChipLabel: '보관 N개' with the expiring count only when there is one", () => {
  assert.equal(fridgeChipLabel({ total: 12, urgent: 0 }), "보관 12개");
  assert.equal(fridgeChipLabel({ total: 12, urgent: 3 }), "보관 12개 (임박 3개)");
  assert.equal(fridgeChipLabel({ total: 0, urgent: 0 }), "보관 0개");
});
