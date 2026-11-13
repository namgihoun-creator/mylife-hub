import { test } from "node:test";
import assert from "node:assert/strict";
import { isIosDevice, isIosSafari } from "./ios-safari.ts";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_MODE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";
const IPHONE_KAKAO = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5";
const IPHONE_NAVER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 NAVER(inapp; search; 1000; 12.6.3)";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI = IPAD_DESKTOP_MODE;

test("iPhone Safari is detected", () => {
  assert.equal(isIosSafari(IPHONE_SAFARI, "iPhone", 5), true);
});

test("iPadOS in desktop mode (Macintosh UA + touch) counts as iOS Safari; a real Mac does not", () => {
  assert.equal(isIosSafari(IPAD_DESKTOP_MODE, "MacIntel", 5), true);
  assert.equal(isIosSafari(MAC_SAFARI, "MacIntel", 0), false);
  assert.equal(isIosDevice(MAC_SAFARI, "MacIntel", 0), false);
});

test("other iOS browsers and in-app browsers are NOT Safari (no share-sheet install path to point at)", () => {
  for (const ua of [IPHONE_CHROME, IPHONE_KAKAO, IPHONE_NAVER, IPHONE_FIREFOX]) assert.equal(isIosSafari(ua, "iPhone", 5), false, ua.slice(60, 140));
});

test("Android and desktop browsers are never iOS Safari", () => {
  assert.equal(isIosSafari(ANDROID_CHROME, "Linux armv8l", 5), false);
  assert.equal(isIosSafari("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123 Safari/537.36", "Win32", 0), false);
});
