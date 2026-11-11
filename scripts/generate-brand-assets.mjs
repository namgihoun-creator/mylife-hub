// Renders the brand assets (OpenGraph card, favicon set, PWA icons) from HTML with Playwright.
// Usage: node scripts/generate-brand-assets.mjs     (outputs are committed; re-run only when the brand changes)
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BG = "#09090b";
const HOME_SVG = (size, stroke) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fafafa" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

const FONT = `"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo","Noto Sans CJK KR",sans-serif`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:${BG};font-family:${FONT};color:#fafafa;position:relative;overflow:hidden}
.glow{position:absolute;border-radius:9999px;filter:blur(110px)}
.g1{width:520px;height:520px;left:-120px;top:-170px;background:rgba(139,92,246,.42)}
.g2{width:560px;height:560px;right:-140px;top:-200px;background:rgba(16,185,129,.34)}
.g3{width:640px;height:380px;left:280px;bottom:-260px;background:rgba(139,92,246,.20)}
.frame{position:absolute;inset:28px;border:1px solid rgba(255,255,255,.10);border-radius:28px}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
.badge{display:inline-flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.18);border-radius:9999px;padding:9px 20px;font-size:22px;color:#d4d4d8;background:rgba(255,255,255,.03)}
.dot{width:9px;height:9px;border-radius:9999px;background:#34d399;box-shadow:0 0 12px #34d399}
.logo{width:104px;height:104px;border:1px solid rgba(255,255,255,.22);border-radius:26px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);margin-top:34px}
h1{font-size:128px;font-weight:800;letter-spacing:-4px;line-height:1.05;margin-top:22px}
.sub{font-size:40px;color:#a1a1aa;margin-top:14px;font-weight:500}
.chips{display:flex;gap:14px;margin-top:40px}
.chip{border:1px solid rgba(255,255,255,.14);border-radius:9999px;padding:8px 20px;font-size:22px;color:#a1a1aa}
</style></head><body>
<div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
<div class="frame"></div>
<div class="wrap">
  <div class="badge"><span class="dot"></span>가전 · 렌탈 능동형 라이프 매니저</div>
  <div class="logo">${HOME_SVG(54, 1.8)}</div>
  <h1>MyLife Hub</h1>
  <div class="sub">스마트 가전·렌탈 통합 관리 플랫폼</div>
  <div class="chips"><span class="chip">약정 만료 추적</span><span class="chip">3-Way 비용 비교</span><span class="chip">소모품 최저가</span><span class="chip">지출 리포트</span></div>
</div>
</body></html>`;

// Square app icon: deep black, faint violet/emerald glow, white house glyph (same Home mark as the header logo).
const iconHtml = (px, glyphPct = 0.5) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0}body{width:${px}px;height:${px}px;background:${BG};position:relative;overflow:hidden}
.g{position:absolute;border-radius:9999px;filter:blur(${Math.round(px * 0.14)}px)}
.a{width:${px * 0.7}px;height:${px * 0.7}px;left:-${px * 0.2}px;top:-${px * 0.25}px;background:rgba(139,92,246,.5)}
.b{width:${px * 0.7}px;height:${px * 0.7}px;right:-${px * 0.22}px;bottom:-${px * 0.25}px;background:rgba(16,185,129,.4)}
.c{position:absolute;display:flex;align-items:center;justify-content:center;inset:0}
</style></head><body><div class="g a"></div><div class="g b"></div><div class="c">${HOME_SVG(Math.round(px * glyphPct), px <= 48 ? 2.4 : 1.9)}</div></body></html>`;

const browser = await chromium.launch();
const shot = async (html, w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  return buf;
};

await mkdir("src/app", { recursive: true });
const og = await shot(ogHtml, 1200, 630);
await writeFile("src/app/opengraph-image.png", og);
await writeFile("src/app/twitter-image.png", og);
await writeFile("src/app/opengraph-image.alt.txt", "MyLife Hub — 스마트 가전·렌탈 통합 관리 플랫폼");
await writeFile("src/app/twitter-image.alt.txt", "MyLife Hub — 스마트 가전·렌탈 통합 관리 플랫폼");

await writeFile("src/app/icon.png", await shot(iconHtml(512), 512, 512));
await writeFile("src/app/apple-icon.png", await shot(iconHtml(180, 0.54), 180, 180));
await writeFile("public/icons/icon-192.png", await shot(iconHtml(192), 192, 192));
await writeFile("public/icons/icon-512.png", await shot(iconHtml(512), 512, 512));

// favicon.ico: PNG-embedded ICO (16/32/48) — supported by every current browser.
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await shot(iconHtml(s, 0.62), s, s));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...entries, ...pngs]));
await browser.close();
console.log("brand assets written");
