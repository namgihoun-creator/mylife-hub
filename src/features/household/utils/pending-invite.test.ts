// Unit tests for the "remember the invite I opened" helper (localStorage is stubbed: no browser needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PENDING_INVITE_TTL_MS, clearPendingInvite, readPendingInvite, rememberInvite } from "./pending-invite.ts";

const CODE = "abcdEFGH_ijkl-MNOPqrstuv0123456789xyz";
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

test("remember → read round trip; clear removes it", () => {
  mem.clear();
  assert.equal(readPendingInvite(), null);
  rememberInvite(CODE, 1_000);
  assert.equal(readPendingInvite(2_000), CODE);
  clearPendingInvite();
  assert.equal(readPendingInvite(2_000), null);
});

test("expires after 7 days (and the stale entry is dropped); the boundary day still counts", () => {
  mem.clear();
  rememberInvite(CODE, 0);
  assert.equal(readPendingInvite(PENDING_INVITE_TTL_MS), CODE);
  assert.equal(readPendingInvite(PENDING_INVITE_TTL_MS + 1), null);
  assert.equal(mem.size, 0);
});

test("malformed codes are never stored; malformed / tampered storage is ignored and cleaned", () => {
  mem.clear();
  for (const bad of ["", "short", "has spaces in it 0123456789", "<script>alert(1)</script>0123456789", `${CODE}/../x`]) {
    rememberInvite(bad);
    assert.equal(mem.size, 0, bad);
  }
  mem.set("mylife.pendingInvite", "not json");
  assert.equal(readPendingInvite(), null);
  mem.set("mylife.pendingInvite", JSON.stringify({ code: "<img src=x onerror=alert(1)>0123456789abcdef", at: Date.now() }));
  assert.equal(readPendingInvite(), null);
  mem.set("mylife.pendingInvite", JSON.stringify({ code: CODE, at: Date.now() + 10 * 60_000 })); // timestamp from the future
  assert.equal(readPendingInvite(), null);
  mem.set("mylife.pendingInvite", JSON.stringify({ code: 42, at: "x" }));
  assert.equal(readPendingInvite(), null);
});

test("storage that throws (private mode / blocked) never breaks anything", () => {
  const boom = () => { throw new Error("denied"); };
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: boom, setItem: boom, removeItem: boom } };
  assert.doesNotThrow(() => rememberInvite(CODE));
  assert.equal(readPendingInvite(), null);
  assert.doesNotThrow(() => clearPendingInvite());
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
});
