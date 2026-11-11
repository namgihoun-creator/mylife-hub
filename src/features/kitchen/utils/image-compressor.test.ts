// Unit tests for the pure part of the photo compressor (the Canvas part needs a browser — it is exercised by the E2E suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JPEG_QUALITY, MAX_BASE64_CHARS, MAX_SIDE, compressImage, fitWithin } from "./image-compressor.ts";

test("constants match the spec: long side 1024px, JPEG 0.75", () => {
  assert.equal(MAX_SIDE, 1024);
  assert.equal(JPEG_QUALITY, 0.75);
  assert.ok(MAX_BASE64_CHARS < 1_000_000); // well below the 1MB..4.5MB request limits
});

test("fitWithin: longest side capped at 1024, aspect ratio kept, never upscaled", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1024, height: 768 }); // typical phone photo
  assert.deepEqual(fitWithin(3024, 4032), { width: 768, height: 1024 }); // portrait
  assert.deepEqual(fitWithin(1024, 1024), { width: 1024, height: 1024 });
  assert.deepEqual(fitWithin(1025, 1025), { width: 1024, height: 1024 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 }); // already small: untouched
  assert.deepEqual(fitWithin(10, 10), { width: 10, height: 10 });
  assert.deepEqual(fitWithin(12000, 100), { width: 1024, height: 9 }); // extreme panorama
  assert.deepEqual(fitWithin(100000, 1), { width: 1024, height: 1 }); // never collapses to 0px
  assert.deepEqual(fitWithin(4000, 3000, 512), { width: 512, height: 384 }); // custom limit
});

test("fitWithin: bad dimensions do not throw", () => {
  assert.deepEqual(fitWithin(0, 100), { width: 1, height: 1 });
  assert.deepEqual(fitWithin(-5, 10), { width: 1, height: 1 });
  assert.deepEqual(fitWithin(Number.NaN, 10), { width: 1, height: 1 });
});

test("compressImage rejects non-images before touching any browser API", async () => {
  await assert.rejects(() => compressImage(new Blob(["hello"], { type: "text/plain" })), /사진 파일만/);
  await assert.rejects(() => compressImage(new Blob([new Uint8Array(4)], { type: "application/pdf" })), /사진 파일만/);
});
