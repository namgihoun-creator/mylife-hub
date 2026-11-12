import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate3dDistanceCm, checkWebXrArSupport } from "./webxr-ar.ts";

async function withNavigator(value: unknown, fn: () => Promise<void>) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, "navigator", desc);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("calculate3dDistanceCm: axis-aligned, diagonal and rounding", () => {
  assert.equal(calculate3dDistanceCm({ x: 0, y: 0, z: 0 }, { x: 1.85, y: 0, z: 0 }), 185);
  assert.equal(calculate3dDistanceCm({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 500);
  assert.equal(calculate3dDistanceCm({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), 0);
  assert.equal(calculate3dDistanceCm({ x: 0, y: 0, z: 0 }, { x: 0.0049, y: 0, z: 0 }), 0);
  assert.equal(calculate3dDistanceCm({ x: 0, y: 0, z: 0 }, { x: 0.0051, y: 0, z: 0 }), 1);
  assert.equal(calculate3dDistanceCm({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 }), 300);
});

test("calculate3dDistanceCm is symmetric and works with negative coordinates", () => {
  const a = { x: -1.2, y: 0.4, z: 2 };
  const b = { x: 0.3, y: 0.4, z: -0.5 };
  assert.equal(calculate3dDistanceCm(a, b), calculate3dDistanceCm(b, a));
  assert.equal(calculate3dDistanceCm({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 200);
});

test("checkWebXrArSupport: no navigator / no xr → unsupported", async () => {
  await withNavigator(undefined, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
  await withNavigator({}, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
  await withNavigator({ xr: null }, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
  await withNavigator({ xr: {} }, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
});

test("checkWebXrArSupport: isSessionSupported false / throws / rejects → unsupported", async () => {
  await withNavigator({ xr: { isSessionSupported: async () => false } }, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
  await withNavigator({ xr: { isSessionSupported: () => { throw new Error("SecurityError"); } } }, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
  await withNavigator({ xr: { isSessionSupported: async () => { throw new Error("NotAllowed"); } } }, async () => assert.equal(await checkWebXrArSupport(), "unsupported"));
});

test("checkWebXrArSupport: asks for immersive-ar and returns supported on true", async () => {
  let asked = "";
  await withNavigator({ xr: { isSessionSupported: async (m: string) => { asked = m; return true; } } }, async () => {
    assert.equal(await checkWebXrArSupport(), "supported");
  });
  assert.equal(asked, "immersive-ar");
});
