import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationAxis, buildShoppingLinks, composeLabel, evaluateFurnitureFit, inferMall, isJointPick, parseAffiliateTag, readAffiliateTags, summarizeBudget, type SpaceAnnotation } from "./space-planner.ts";

const wall = (label: string, lengthCm: number): SpaceAnnotation => ({ id: label, x1: 0, y1: 0, x2: 1, y2: 0, label, lengthCm });

test("shopping links: four malls, keyword encoded, whitespace collapsed", () => {
  const links = buildShoppingLinks("  아이보리  패브릭 3인 소파 2100 ");
  assert.deepEqual(links.map((l) => l.mall), ["ohouse", "naver", "coupang", "ikea"]);
  const q = encodeURIComponent("아이보리 패브릭 3인 소파 2100");
  assert.equal(links[0].url, `https://ohou.se/store/search?query=${q}`);
  assert.equal(links[1].url, `https://search.shopping.naver.com/search/all?query=${q}`);
  assert.equal(links[2].url, `https://www.coupang.com/np/search?q=${q}`);
  assert.equal(links[3].url, `https://www.ikea.com/kr/ko/search/?q=${q}`);
  assert.deepEqual(links.map((l) => l.label), ["오늘의집", "네이버 쇼핑", "쿠팡", "이케아 코리아"]);
});

test("shopping links: query-breaking characters are escaped, empty keyword gives no links, length is capped", () => {
  const url = buildShoppingLinks("a&b=c#d?e")[0].url;
  assert.equal(url, "https://ohou.se/store/search?query=a%26b%3Dc%23d%3Fe");
  assert.deepEqual(buildShoppingLinks("   "), []);
  assert.deepEqual(buildShoppingLinks(undefined as unknown as string), []);
  assert.ok(decodeURIComponent(buildShoppingLinks("가".repeat(500))[0].url.split("query=")[1]).length <= 100);
});

test("fit: plenty of room -> FIT with the spare cm", () => {
  const r = evaluateFurnitureFit([wall("가로 벽면", 240)], { widthCm: 210 });
  assert.equal(r.status, "FIT");
  assert.equal(r.slackCm, 30);
  assert.match(r.message, /30cm 여유/);
});

test("fit: within 5 cm (inclusive, even exactly 0) is TIGHT", () => {
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 236 }).status, "TIGHT");
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 235 }).status, "TIGHT"); // exactly 5
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 240 }).status, "TIGHT"); // exactly 0
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 234.9 }).status, "FIT");
  assert.match(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 236 }).message, /빠듯/);
});

test("fit: bigger than the space -> OVERFLOW with the excess", () => {
  const r = evaluateFurnitureFit([wall("가로", 240)], { widthCm: 243.5 });
  assert.equal(r.status, "OVERFLOW");
  assert.equal(r.slackCm, -3.5);
  assert.match(r.message, /3\.5cm 초과/);
});

test("fit: the worst axis decides; labels pick the axis (가로 / 깊이·세로 / 높이)", () => {
  const space = [wall("가로 벽면", 300), wall("깊이", 90), wall("천장 높이", 240)];
  const r = evaluateFurnitureFit(space, { widthCm: 200, depthCm: 95, heightCm: 80 });
  assert.equal(r.status, "OVERFLOW");
  assert.deepEqual(r.axes.map((a) => [a.axis, a.status]), [["width", "FIT"], ["depth", "OVERFLOW"], ["height", "FIT"]]);
  assert.equal(r.slackCm, -5);
  assert.match(r.message, /깊이 기준 5cm 초과/);
  assert.equal(annotationAxis("창문 폭"), "width");
  assert.equal(annotationAxis("세로 벽"), "depth");
  assert.equal(annotationAxis("천장"), "height");
  assert.equal(annotationAxis(""), "width");
});

test("fit: several lines on one axis -> the smallest (most restrictive) is used", () => {
  const r = evaluateFurnitureFit([wall("가로 벽면", 300), wall("창문 아래 가로", 180)], { widthCm: 170 });
  assert.equal(r.axes[0].availableCm, 180);
  assert.equal(r.status, "FIT");
  assert.equal(r.slackCm, 10);
});

test("fit: missing data is UNKNOWN, never a fake FIT; junk values are ignored", () => {
  assert.equal(evaluateFurnitureFit([], { widthCm: 100 }).status, "UNKNOWN");
  assert.equal(evaluateFurnitureFit(null, { widthCm: 100 }).status, "UNKNOWN");
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], {}).status, "UNKNOWN");
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: null }).status, "UNKNOWN");
  assert.equal(evaluateFurnitureFit([wall("가로", Number.NaN), wall("가로", -5)], { widthCm: 100 }).status, "UNKNOWN");
  assert.equal(evaluateFurnitureFit([wall("높이", 240)], { widthCm: 100 }).status, "UNKNOWN"); // only a height was measured
  assert.equal(evaluateFurnitureFit([wall("가로", 240)], { widthCm: 0 }).status, "UNKNOWN");
});

test("fit: no float noise in the spare space", () => {
  assert.equal(evaluateFurnitureFit([wall("가로", 240.3)], { widthCm: 200.1 }).slackCm, 40.2);
});

test("composeLabel: the label always reads back as the axis that was picked", () => {
  assert.equal(composeLabel("width", ""), "가로");
  assert.equal(composeLabel("width", "소파 벽면"), "소파 벽면");
  assert.equal(annotationAxis(composeLabel("depth", "소파 벽면")), "depth");
  assert.equal(composeLabel("depth", "소파 벽면"), "소파 벽면 깊이");
  assert.equal(composeLabel("depth", "창가 깊이"), "창가 깊이");
  assert.equal(annotationAxis(composeLabel("height", "")), "height");
  assert.equal(composeLabel("custom", "  창문   아래  "), "창문 아래");
  assert.equal(composeLabel("height", "가".repeat(60)).length <= 40, true);
  assert.equal(annotationAxis(composeLabel("height", "가".repeat(60))), "height");
});

test("inferMall: the four malls (and subdomains) are recognised, anything else is null", () => {
  assert.equal(inferMall("https://ohou.se/productions/123/selling"), "ohouse");
  assert.equal(inferMall("https://search.shopping.naver.com/x"), "naver");
  assert.equal(inferMall("https://smartstore.naver.com/a/products/1"), "naver");
  assert.equal(inferMall("https://www.coupang.com/vp/products/1"), "coupang");
  assert.equal(inferMall("https://www.ikea.com/kr/ko/p/x/"), "ikea");
  assert.equal(inferMall("https://notikea.com/x"), null);
  assert.equal(inferMall("https://evil.com/?u=ikea.com"), null);
  assert.equal(inferMall("not a url"), null);
  assert.equal(inferMall(null), null);
});

test("fit basis label: names the measured line, its length and the margin", () => {
  const wall = [{ label: "소파 벽면", lengthCm: 240 }];
  assert.equal(evaluateFurnitureFit(wall, { widthCm: 210 }).basisLabel, "가로 소파 벽면 240cm 기준 · 30cm 여유");
  assert.equal(evaluateFurnitureFit([{ label: "가로", lengthCm: 240 }], { widthCm: 210 }).basisLabel, "가로 240cm 기준 · 30cm 여유");
  assert.equal(evaluateFurnitureFit([{ label: "깊이", lengthCm: 90 }], { depthCm: 95 }).basisLabel, "깊이 90cm 기준 · 5cm 초과");
  assert.equal(evaluateFurnitureFit([{ label: "창가 깊이", lengthCm: 90 }], { depthCm: 86 }).basisLabel, "창가 깊이 90cm 기준 · 4cm 여유");
});

test("fit basis label: the worst axis and the shortest matching line are the basis; UNKNOWN has none", () => {
  const ann = [{ label: "벽면 A", lengthCm: 300 }, { label: "벽면 B", lengthCm: 250 }, { label: "천장 높이", lengthCm: 235 }];
  const r = evaluateFurnitureFit(ann, { widthCm: 240, heightCm: 240 });
  assert.equal(r.status, "OVERFLOW");
  assert.equal(r.basisLabel, "천장 높이 235cm 기준 · 5cm 초과");
  assert.equal(evaluateFurnitureFit(ann, { widthCm: 200 }).basisLabel, "가로 벽면 B 250cm 기준 · 50cm 여유");
  assert.equal(evaluateFurnitureFit([], { widthCm: 200 }).basisLabel, "");
  assert.equal(evaluateFurnitureFit(ann, {}).basisLabel, "");
});

test("budget: SELECTED total, CANDIDATE+SELECTED total, PURCHASED apart, missing prices counted", () => {
  const b = summarizeBudget([
    { status: "SELECTED", price: 650000 },
    { status: "SELECTED", price: 320000 },
    { status: "CANDIDATE", price: 180000 },
    { status: "CANDIDATE", price: null },
    { status: "PURCHASED", price: 99000 },
    { status: "SOLD", price: 5 },
  ]);
  assert.deepEqual(b, { selectedTotal: 970000, selectedCount: 2, candidateTotal: 1150000, candidateCount: 4, purchasedTotal: 99000, unpriced: 1 });
  assert.deepEqual(summarizeBudget([]), { selectedTotal: 0, selectedCount: 0, candidateTotal: 0, candidateCount: 0, purchasedTotal: 0, unpriced: 0 });
  assert.equal(summarizeBudget(null).candidateTotal, 0);
  assert.equal(summarizeBudget([{ status: "SELECTED", price: -5 }, { status: "SELECTED", price: Number.NaN }]).selectedTotal, 0);
});

test("joint pick: needs 2+ members and all of them to like it", () => {
  const A = "a", B = "b", C = "c";
  assert.equal(isJointPick([A, B], [A, B]), true);
  assert.equal(isJointPick([B, A, C], [A, B]), true); // extra / unknown likes do not matter
  assert.equal(isJointPick([A], [A, B]), false);
  assert.equal(isJointPick([], [A, B]), false);
  assert.equal(isJointPick([A], [A]), false); // a solo household has no "joint"
  assert.equal(isJointPick([A, A], [A, A]), false);
  assert.equal(isJointPick(undefined, [A, B]), false);
  assert.equal(isJointPick([A, B], undefined), false);
});

test("affiliate: no tags -> the plain search URLs (unchanged behaviour)", () => {
  const plain = buildShoppingLinks("소파 3인", {});
  assert.equal(plain[2].url, `https://www.coupang.com/np/search?q=${encodeURIComponent("소파 3인")}`);
  assert.equal(plain[0].url, `https://ohou.se/store/search?query=${encodeURIComponent("소파 3인")}`);
  assert.deepEqual(buildShoppingLinks("소파 3인", { coupang: "", naver: undefined }).map((l) => l.url), plain.map((l) => l.url));
});

test("affiliate: a tag is merged into that mall's URL only, keeping the keyword encoding", () => {
  const q = encodeURIComponent("소파 3인");
  const links = buildShoppingLinks("소파 3인", { coupang: "lptag=AF1234567", ikea: "?cid=kr-aff&subid=couple" });
  const by = Object.fromEntries(links.map((l) => [l.mall, l.url]));
  assert.equal(by.coupang, `https://www.coupang.com/np/search?q=${q}&lptag=AF1234567`);
  assert.equal(by.ikea, `https://www.ikea.com/kr/ko/search/?q=${q}&cid=kr-aff&subid=couple`);
  assert.equal(by.ohouse, `https://ohou.se/store/search?query=${q}`);
  assert.equal(by.naver, `https://search.shopping.naver.com/search/all?query=${q}`);
});

test("affiliate: malformed / unsafe tags are ignored, never injected", () => {
  const q = encodeURIComponent("소파");
  const base = `https://www.coupang.com/np/search?q=${q}`;
  for (const bad of ["AF1234567", "=x", "a=", "a=b c", "a=<script>", "javascript:alert(1)", "a=1&b", "x".repeat(400), "a=b&c=d e", "q=hijack&", "a=https://evil.example/", "a b=c"]) {
    const url = buildShoppingLinks("소파", { coupang: bad })[2].url;
    assert.ok(url === base || (bad === "q=hijack&" && url === base), `${bad} -> ${url}`);
  }
});

test("affiliate: the search keyword parameter can never be overridden, a repeated key is set once", () => {
  const q = encodeURIComponent("소파");
  assert.equal(buildShoppingLinks("소파", { coupang: "q=evil&lptag=AF9" })[2].url, `https://www.coupang.com/np/search?q=${q}&lptag=AF9`);
  assert.equal(buildShoppingLinks("소파", { naver: "a=1&a=2" })[1].url, `https://search.shopping.naver.com/search/all?query=${q}&a=2`);
  assert.deepEqual(parseAffiliateTag("lptag=AF1&subid=x"), [["lptag", "AF1"], ["subid", "x"]]);
  assert.deepEqual(parseAffiliateTag(null), []);
});

test("affiliate: tags are read from the NEXT_PUBLIC_AFFILIATE_* environment variables", () => {
  const keys = ["NEXT_PUBLIC_AFFILIATE_COUPANG_TAG", "NEXT_PUBLIC_AFFILIATE_OHHOUSE_TAG", "NEXT_PUBLIC_AFFILIATE_NAVER_TAG", "NEXT_PUBLIC_AFFILIATE_IKEA_TAG"];
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    assert.deepEqual(Object.values(readAffiliateTags()).filter(Boolean), []);
    process.env.NEXT_PUBLIC_AFFILIATE_COUPANG_TAG = "lptag=AF1";
    process.env.NEXT_PUBLIC_AFFILIATE_OHHOUSE_TAG = "ref=couple";
    process.env.NEXT_PUBLIC_AFFILIATE_NAVER_TAG = "np=n1";
    process.env.NEXT_PUBLIC_AFFILIATE_IKEA_TAG = "cid=i1";
    const urls = buildShoppingLinks("책장").map((l) => l.url);
    assert.ok(urls[0].endsWith("&ref=couple") && urls[1].endsWith("&np=n1") && urls[2].endsWith("&lptag=AF1") && urls[3].endsWith("&cid=i1"), urls.join("\n"));
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
});
