/** Pure iOS-Safari detection (no DOM access; unit-tested with node:test). */

/** iPhone / iPad / iPod, including iPadOS 13+ in desktop mode (it reports itself as a Mac with a touch screen). */
export function isIosDevice(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

// Other iOS browsers (Chrome, Firefox, Edge, Opera …) and in-app browsers (KakaoTalk, Naver, Instagram, Facebook, Line …) have no
// "Add to Home Screen" share-sheet entry of their own, so the banner would send people on a dead end there.
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|Daum|KAKAOTALK|NAVER\(|NaverApp|Line\/|Instagram|FBAN|FBAV|FB_IAB|Twitter|Whale|SamsungBrowser|; wv\)/i;

/** iPhone/iPad (incl. iPadOS desktop mode) running real Safari, not another browser or an in-app WebView. */
export function isIosSafari(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (!isIosDevice(ua, platform, maxTouchPoints)) return false;
  if (NOT_SAFARI.test(ua)) return false;
  return /Safari\//.test(ua) && /(Version\/|AppleWebKit)/.test(ua);
}
