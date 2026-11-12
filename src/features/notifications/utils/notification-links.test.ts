// Where a notification leads (bell click and push notificationclick share notificationHref).
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationHref } from "./notification-links.ts";

const A = "0b6f1c2e-3d4a-4b5c-8d9e-0123456789ab";
const K = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

test("appliance due alerts open that appliance's detail panel", () => {
  for (const t of ["DUE_SOON", "DUE_TODAY", "OVERDUE"]) assert.equal(notificationHref(t, A), `/assets?openAssetId=${A}`);
});

test("rental expiry opens the transfer-comparison tab", () => {
  assert.equal(notificationHref("RENTAL_EXPIRING", A), `/assets?openAssetId=${A}&tab=compare`);
});

test("kitchen expiry focuses the ingredient on /kitchen", () => {
  assert.equal(notificationHref("KITCHEN_EXPIRING", null, K), `/kitchen?focus=${K}`);
});

test("deleted targets fall back to the list pages", () => {
  assert.equal(notificationHref("DUE_SOON", null), "/timeline");
  assert.equal(notificationHref("OVERDUE", undefined), "/timeline");
  assert.equal(notificationHref("RENTAL_EXPIRING", null), "/assets");
  assert.equal(notificationHref("KITCHEN_EXPIRING", null, null), "/kitchen");
});

test("non-UUID ids are never put into a URL; unknown types go to the timeline", () => {
  assert.equal(notificationHref("DUE_SOON", "../../etc"), "/timeline");
  assert.equal(notificationHref("KITCHEN_EXPIRING", null, "x&y=1"), "/kitchen");
  assert.equal(notificationHref("SOMETHING_NEW", A), "/timeline");
  assert.equal(notificationHref("MAGIC_COMPLETED", A), "/timeline");
  assert.equal(notificationHref("INVITE_ACCEPTED"), "/assets");
});
