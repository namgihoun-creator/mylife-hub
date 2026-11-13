// Product-page metadata for the wish board: SSRF-safe fetch + Open Graph parsing. No framework imports (node:test imports this file).

import { lookup } from "node:dns/promises";
import { inferMall, type ShoppingMallId } from "../../../shared/utils/space-planner.ts";

export const MAX_HTML_BYTES = 1024 * 1024; // 1 MB
export const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

export class UrlError extends Error {
  readonly code: "INVALID_URL" | "BLOCKED_URL" | "FETCH_FAILED" | "TOO_LARGE" | "NOT_HTML";
  constructor(code: UrlError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------- SSRF guard
function ipv4Parts(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** Loopback, private, link-local, CGNAT, "this network", multicast and reserved IPv4 ranges. */
export function isPrivateIPv4(host: string): boolean {
  const p = ipv4Parts(host);
  if (!p) return false;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  );
}

/** ::1, ::, fe80::/10 (link-local), fc00::/7 (unique local), ff00::/8 (multicast) and IPv4-mapped (::ffff:a.b.c.d) forms of a blocked IPv4. */
export function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase().split("%")[0];
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  const mapped = h.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes(".")) return isPrivateIPv4(tail);
    const hex = tail.split(":").map((x) => parseInt(x, 16));
    if (hex.length === 2 && hex.every((n) => Number.isInteger(n))) return isPrivateIPv4(`${hex[0] >> 8}.${hex[0] & 255}.${hex[1] >> 8}.${hex[1] & 255}`);
    return true;
  }
  const first = parseInt(h.split(":")[0] || "0", 16);
  return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00;
}

/** Hostnames that must never be fetched: localhost & friends, internal suffixes, and any private/loopback IP literal. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (isPrivateIPv4(h) || isPrivateIPv6(h)) return true;
  return false;
}

/** Parse + validate: http(s) only, no credentials, standard web ports only, host not blocked. */
export function validateTargetUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new UrlError("INVALID_URL", "올바른 상품 링크가 아니에요.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlError("INVALID_URL", "http(s) 링크만 불러올 수 있어요.");
  if (u.username || u.password) throw new UrlError("BLOCKED_URL", "이 링크는 불러올 수 없어요.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new UrlError("BLOCKED_URL", "이 링크는 불러올 수 없어요.");
  if (isBlockedHost(u.hostname)) throw new UrlError("BLOCKED_URL", "이 링크는 불러올 수 없어요.");
  return u;
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (h) => (await lookup(h, { all: true })).map((a) => a.address);

/** DNS-rebinding guard: every address a public-looking hostname resolves to must be public as well. */
export async function assertPublicHost(u: URL, resolve: Resolver = defaultResolver): Promise<void> {
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (h.includes(":") || ipv4Parts(h)) return; // IP literal: already checked by validateTargetUrl
  let addrs: string[];
  try {
    addrs = await resolve(h);
  } catch {
    throw new UrlError("FETCH_FAILED", "링크의 사이트에 접속하지 못했어요.");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIPv4(a) || isPrivateIPv6(a))) throw new UrlError("BLOCKED_URL", "이 링크는 불러올 수 없어요.");
}

// ---------------------------------------------------------------------------------------------- fetch
async function readLimited(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max * 8) throw new UrlError("TOO_LARGE", "페이지가 너무 커요.");
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    got += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    /* already finished */
  }
  const buf = new Uint8Array(Math.min(got, max));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, buf.length - off));
    buf.set(part, off);
    off += part.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf); // the OG tags live in <head>, so a truncated page is enough
}

export type FetchDeps = { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number };

/** Fetch the page HTML (<= 1 MB, 5 s). Redirects are followed by hand so every hop is validated again. Returns the final URL too. */
export async function fetchProductHtml(rawUrl: string, deps: FetchDeps = {}): Promise<{ html: string; finalUrl: URL }> {
  const doFetch = deps.fetchImpl ?? fetch;
  let url = validateTargetUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, deps.resolve);
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MyLifeHubBot/1.0; +link-preview)", Accept: "text/html,application/xhtml+xml", "Accept-Language": "ko-KR,ko;q=0.9" },
      });
    } catch {
      throw new UrlError("FETCH_FAILED", "링크를 불러오지 못했어요. (시간 초과 또는 접속 실패)");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === MAX_REDIRECTS) throw new UrlError("FETCH_FAILED", "링크가 너무 많이 이동해요.");
      url = validateTargetUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new UrlError("FETCH_FAILED", `사이트가 정보를 내주지 않았어요. (${res.status})`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/text\/html|application\/xhtml/.test(type)) throw new UrlError("NOT_HTML", "상품 페이지가 아니에요.");
    return { html: await readLimited(res, MAX_HTML_BYTES), finalUrl: url };
  }
  throw new UrlError("FETCH_FAILED", "링크가 너무 많이 이동해요.");
}

// ---------------------------------------------------------------------------------------------- parsing
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function metaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.slice(0, MAX_HTML_BYTES).match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    const key = attr("property") ?? attr("name");
    const val = attr("content");
    if (!key || !val) continue;
    const k = (key[1] ?? key[2] ?? key[3]).toLowerCase();
    const v = decodeEntities((val[1] ?? val[2] ?? val[3] ?? "").trim());
    if (v && !map.has(k)) map.set(k, v);
  }
  return map;
}

const oneLine = (s: string, max: number) => s.split(/\s+/).filter(Boolean).join(" ").slice(0, max);

export const MALL_NAME: Record<ShoppingMallId, string> = { ohouse: "오늘의집", naver: "네이버 쇼핑", coupang: "쿠팡", ikea: "이케아" };

/** "오늘의집"/"네이버 쇼핑"/"쿠팡"/"이케아" for the known malls, else the bare host ("example.com"). */
export function sourceMallName(url: string): { mallId: ShoppingMallId | null; name: string } {
  const mallId = inferMall(url);
  if (mallId) return { mallId, name: MALL_NAME[mallId] };
  try {
    return { mallId: null, name: new URL(url).hostname.replace(/^www\./, "") };
  } catch {
    return { mallId: null, name: "" };
  }
}

export type ProductMeta = { title: string | null; imageUrl: string | null; price: number | null; sourceMall: string; mallId: ShoppingMallId | null };

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000_000 ? Math.round(n) : null;
}

/** og:title (fallback <title>), og:image (made absolute, http(s) only), price meta, and the mall name from the final URL. */
export function parseProductHtml(html: string, pageUrl: string): ProductMeta {
  const meta = metaMap(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = oneLine(meta.get("og:title") ?? meta.get("twitter:title") ?? (titleTag ? decodeEntities(titleTag) : ""), 100) || null;

  let imageUrl: string | null = null;
  const img = meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("og:image:secure_url") ?? meta.get("twitter:image");
  if (img) {
    try {
      const u = new URL(img, pageUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.toString().length <= 2000) imageUrl = u.toString();
    } catch {
      /* ignore a malformed image URL */
    }
  }
  const price = parsePrice(meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("product:sale_price:amount"));
  const { mallId, name } = sourceMallName(pageUrl);
  return { title, imageUrl, price, sourceMall: name, mallId };
}
