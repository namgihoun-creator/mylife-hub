import { test } from "node:test";
import assert from "node:assert/strict";
import { UrlError, fetchProductHtml, isBlockedHost, parseProductHtml, sourceMallName, validateTargetUrl, assertPublicHost, MAX_HTML_BYTES } from "./product-url.ts";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof UrlError ? e.code : "OTHER";
  }
  return "NONE";
};

test("validateTargetUrl: only http(s); everything else is INVALID_URL", () => {
  for (const u of ["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)", "gopher://x", "data:text/html,hi", "not a url", ""]) assert.equal(code(() => validateTargetUrl(u)), "INVALID_URL", u);
  assert.equal(validateTargetUrl("https://www.ikea.com/kr/ko/p/x/").hostname, "www.ikea.com");
  assert.equal(validateTargetUrl("http://ohou.se/a").protocol, "http:");
});

test("SSRF: localhost, loopback and private IPv4 ranges are blocked", () => {
  const blocked = [
    "http://localhost/", "http://LOCALHOST:3000/", "http://foo.localhost/", "http://127.0.0.1/", "http://127.1.2.3/", "http://0.0.0.0/",
    "http://10.0.0.1/", "http://10.255.255.255/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.0.1/", "http://192.168.1.10:8080/",
    "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://224.0.0.1/",
    "http://2130706433/", "http://0x7f000001/", "http://017700000001/", "http://127.0.0.1.:80/", // decimal / hex / octal / trailing-dot forms normalise to 127.0.0.1
    "http://printer.local/", "http://db.internal/",
  ];
  for (const u of blocked) assert.equal(code(() => validateTargetUrl(u)), "BLOCKED_URL", u);
});

test("SSRF: IPv6 loopback, link-local, unique-local and IPv4-mapped are blocked", () => {
  for (const u of ["http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[febf::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:10.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:c0a8:1]/"]) {
    assert.equal(code(() => validateTargetUrl(u)), "BLOCKED_URL", u);
  }
  assert.equal(code(() => validateTargetUrl("http://[2606:4700:4700::1111]/")), "NONE"); // a public IPv6 literal is fine
});

test("SSRF: public addresses just outside the private ranges stay allowed", () => {
  for (const h of ["172.15.0.1", "172.32.0.1", "11.0.0.1", "192.167.0.1", "169.253.1.1", "100.63.0.1", "8.8.8.8"]) assert.equal(isBlockedHost(h), false, h);
  for (const h of ["172.16.0.1", "172.31.0.1", "10.1.1.1", "192.168.5.5", "169.254.0.1"]) assert.equal(isBlockedHost(h), true, h);
});

test("SSRF: credentials in the URL and odd ports are refused", () => {
  assert.equal(code(() => validateTargetUrl("https://user:pw@example.com/")), "BLOCKED_URL");
  assert.equal(code(() => validateTargetUrl("https://example.com:22/")), "BLOCKED_URL");
  assert.equal(code(() => validateTargetUrl("https://example.com:8443/x")), "NONE");
});

test("SSRF: a public-looking hostname that resolves to a private address is refused (DNS rebinding)", async () => {
  await assert.rejects(assertPublicHost(new URL("https://evil.example.com/"), async () => ["93.184.216.34", "10.0.0.5"]), (e: unknown) => e instanceof UrlError && e.code === "BLOCKED_URL");
  await assert.rejects(assertPublicHost(new URL("https://evil.example.com/"), async () => ["::1"]), (e: unknown) => e instanceof UrlError && e.code === "BLOCKED_URL");
  await assert.rejects(assertPublicHost(new URL("https://nx.example.com/"), async () => { throw new Error("ENOTFOUND"); }), (e: unknown) => e instanceof UrlError && e.code === "FETCH_FAILED");
  await assertPublicHost(new URL("https://ok.example.com/"), async () => ["93.184.216.34"]); // no throw
});

const PUBLIC = async () => ["93.184.216.34"];
const html = (body: string, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) => new Response(body, { status: 200, headers });

test("fetchProductHtml: a redirect to a private host is refused on that hop", async () => {
  let calls = 0;
  const fetchImpl = (async (u: URL) => {
    calls++;
    return String(u).includes("start") ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }) : html("secret");
  }) as unknown as typeof fetch;
  await assert.rejects(fetchProductHtml("https://start.example.com/p", { fetchImpl, resolve: PUBLIC }), (e: unknown) => e instanceof UrlError && e.code === "BLOCKED_URL");
  assert.equal(calls, 1, "the private URL was never requested");
});

test("fetchProductHtml: follows safe redirects (max 3), passes the 5 s abort signal and manual redirect mode", async () => {
  const seen: { redirect?: string; signal?: boolean }[] = [];
  const fetchImpl = (async (u: URL, init: RequestInit) => {
    seen.push({ redirect: init.redirect, signal: init.signal instanceof AbortSignal });
    if (String(u).endsWith("/a")) return new Response(null, { status: 301, headers: { location: "/b" } });
    return html("<title>ok</title>");
  }) as unknown as typeof fetch;
  const r = await fetchProductHtml("https://shop.example.com/a", { fetchImpl, resolve: PUBLIC });
  assert.equal(r.finalUrl.pathname, "/b");
  assert.ok(seen.every((s) => s.redirect === "manual" && s.signal));
  const loop = (async () => new Response(null, { status: 302, headers: { location: "/again" } })) as unknown as typeof fetch;
  await assert.rejects(fetchProductHtml("https://shop.example.com/a", { fetchImpl: loop, resolve: PUBLIC }), (e: unknown) => e instanceof UrlError && e.code === "FETCH_FAILED");
});

test("fetchProductHtml: timeout / network error -> FETCH_FAILED, non-HTML -> NOT_HTML, HTTP error -> FETCH_FAILED", async () => {
  const boom = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch;
  await assert.rejects(fetchProductHtml("https://shop.example.com/", { fetchImpl: boom, resolve: PUBLIC }), (e: unknown) => e instanceof UrlError && e.code === "FETCH_FAILED");
  const img = (async () => new Response("x", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  await assert.rejects(fetchProductHtml("https://shop.example.com/", { fetchImpl: img, resolve: PUBLIC }), (e: unknown) => e instanceof UrlError && e.code === "NOT_HTML");
  const denied = (async () => new Response("no", { status: 403, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  await assert.rejects(fetchProductHtml("https://shop.example.com/", { fetchImpl: denied, resolve: PUBLIC }), (e: unknown) => e instanceof UrlError && e.code === "FETCH_FAILED");
});

test("fetchProductHtml: the body is capped at 1 MB (a huge page is read only up to the cap)", async () => {
  const big = "<title>t</title>" + "a".repeat(MAX_HTML_BYTES * 3);
  const fetchImpl = (async () => html(big)) as unknown as typeof fetch;
  const r = await fetchProductHtml("https://shop.example.com/", { fetchImpl, resolve: PUBLIC });
  assert.ok(r.html.length <= MAX_HTML_BYTES);
  assert.match(r.html, /<title>t<\/title>/);
});

const PAGE = `<!doctype html><html><head>
<title>fallback title</title>
<meta property="og:title" content="화이트 &amp; 오크 3인 소파 &quot;모던&quot;">
<meta property="og:image" content="/img/sofa.jpg">
<meta property="product:price:amount" content="1,290,000">
<meta property="product:price:currency" content="KRW">
</head><body>x</body></html>`;

test("parseProductHtml: og:title (entities decoded), og:image made absolute, price from product:price:amount", () => {
  const m = parseProductHtml(PAGE, "https://www.ikea.com/kr/ko/p/sofa-123/");
  assert.equal(m.title, '화이트 & 오크 3인 소파 "모던"');
  assert.equal(m.imageUrl, "https://www.ikea.com/img/sofa.jpg");
  assert.equal(m.price, 1290000);
  assert.equal(m.sourceMall, "이케아");
  assert.equal(m.mallId, "ikea");
});

test("parseProductHtml: falls back to <title>, og:price:amount and attribute orders / quote styles", () => {
  const m = parseProductHtml(`<head><title>\n  단순   제목  </title><meta content='39900' property='og:price:amount'><meta content=https://cdn.example.com/a.png property=og:image></head>`, "https://shop.example.com/x");
  assert.equal(m.title, "단순 제목");
  assert.equal(m.price, 39900);
  assert.equal(m.imageUrl, "https://cdn.example.com/a.png");
  assert.equal(m.sourceMall, "shop.example.com");
  assert.equal(m.mallId, null);
});

test("parseProductHtml: a non-http image, junk price and an empty page give nulls", () => {
  const m = parseProductHtml(`<meta property="og:image" content="javascript:alert(1)"><meta property="product:price:amount" content="무료"><meta property="og:title" content="">`, "https://www.coupang.com/vp/products/1");
  assert.equal(m.imageUrl, null);
  assert.equal(m.price, null);
  assert.equal(m.title, null);
  assert.equal(m.sourceMall, "쿠팡");
  const e = parseProductHtml("", "https://ohou.se/productions/1/selling");
  assert.deepEqual({ t: e.title, i: e.imageUrl, p: e.price, m: e.sourceMall }, { t: null, i: null, p: null, m: "오늘의집" });
});

test("sourceMallName: 오늘의집 · 네이버 쇼핑 · 쿠팡 · 이케아, otherwise the bare host", () => {
  assert.equal(sourceMallName("https://ohou.se/x").name, "오늘의집");
  assert.equal(sourceMallName("https://smartstore.naver.com/a/products/1").name, "네이버 쇼핑");
  assert.equal(sourceMallName("https://brand.naver.com/b").name, "네이버 쇼핑");
  assert.equal(sourceMallName("https://link.coupang.com/a/b").name, "쿠팡");
  assert.equal(sourceMallName("https://www.ikea.com/kr/ko/").name, "이케아");
  assert.equal(sourceMallName("https://www.hanssem.com/x").name, "hanssem.com");
  assert.equal(sourceMallName("nope").name, "");
});
