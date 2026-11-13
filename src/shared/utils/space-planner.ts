// Space & furniture planner helpers — pure functions (no I/O), shared by the API route, the UI and Node tests.

// ---------------------------------------------------------------------------------------------- shopping links
export const SHOPPING_MALLS = [
  { id: "ohouse", label: "오늘의집", url: (q: string) => `https://ohou.se/store/search?query=${q}` },
  { id: "naver", label: "네이버 쇼핑", url: (q: string) => `https://search.shopping.naver.com/search/all?query=${q}` },
  { id: "coupang", label: "쿠팡", url: (q: string) => `https://www.coupang.com/np/search?q=${q}` },
  { id: "ikea", label: "이케아 코리아", url: (q: string) => `https://www.ikea.com/kr/ko/search/?q=${q}` },
] as const;

export type ShoppingMallId = (typeof SHOPPING_MALLS)[number]["id"];
export type ShoppingLink = { mall: ShoppingMallId; label: string; url: string };

export const MAX_KEYWORD_LENGTH = 100;

// ---- optional affiliate parameters --------------------------------------------------------------------------------------
// NEXT_PUBLIC_AFFILIATE_{COUPANG,OHHOUSE,NAVER,IKEA}_TAG hold a query fragment such as "lptag=AF1234567" (or "a=1&b=2"). When set it is
// merged into that mall's search URL; unset / malformed values leave the plain search URL untouched. The four variables are read
// with literal `process.env.NAME` expressions on purpose: that is the only form Next.js inlines into the browser bundle.
export type AffiliateTags = Partial<Record<ShoppingMallId, string | undefined>>;

export function readAffiliateTags(): AffiliateTags {
  try {
    // no `typeof process` guard: the bundler replaces each literal expression below at build time, even in the browser
    return {
      coupang: process.env.NEXT_PUBLIC_AFFILIATE_COUPANG_TAG,
      ohouse: process.env.NEXT_PUBLIC_AFFILIATE_OHHOUSE_TAG,
      naver: process.env.NEXT_PUBLIC_AFFILIATE_NAVER_TAG,
      ikea: process.env.NEXT_PUBLIC_AFFILIATE_IKEA_TAG,
    };
  } catch {
    return {};
  }
}

const PARAM_NAME = /^[A-Za-z0-9_.\-]{1,40}$/;
const PARAM_VALUE = /^[A-Za-z0-9_.\-~%+,]{1,120}$/; // no ":" "/" "@": a value can never smuggle in another URL

/** "lptag=AF1&subid=x" (a leading "?" / "&" is tolerated) -> [["lptag","AF1"],["subid","x"]]; anything unsafe or malformed -> []. */
export function parseAffiliateTag(raw: string | null | undefined): [string, string][] {
  const text = String(raw ?? "").trim().replace(/^[?&]+/, "");
  if (!text || text.length > 300) return [];
  const out: [string, string][] = [];
  for (const part of text.split("&")) {
    const i = part.indexOf("=");
    if (i < 1) return []; // a bare value has no parameter name: refuse the whole tag rather than guess
    const key = part.slice(0, i), value = part.slice(i + 1);
    if (!PARAM_NAME.test(key) || !PARAM_VALUE.test(value)) return [];
    out.push([key, value]);
  }
  return out;
}

/**
 * Merge affiliate pairs into a URL's query by appending `&key=value` to the text as it is: the keyword keeps its exact encoding (a
 * re-serialising URLSearchParams would turn %20 into "+"). The search keyword parameter is never touched, a key the URL already has is
 * not duplicated, and a key repeated inside the tag counts once (the last value wins).
 */
export function withAffiliate(url: string, tag: string | null | undefined, protectedKeys: readonly string[] = ["q", "query"]): string {
  const pairs = parseAffiliateTag(tag);
  if (pairs.length === 0) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const have = new Set([...u.searchParams.keys()]);
  const add = new Map<string, string>();
  for (const [k, v] of pairs) if (!protectedKeys.includes(k) && !have.has(k)) add.set(k, v);
  if (add.size === 0) return url;
  const extra = [...add].map(([k, v]) => `${k}=${v}`).join("&");
  return u.search ? `${url}&${extra}` : `${url}?${extra}`;
}

/** One search URL per mall for a Korean keyword (trimmed, whitespace collapsed, URL-encoded). Empty keyword -> no links. Affiliate tags (env) are merged when set. */
export function buildShoppingLinks(keyword: string, tags: AffiliateTags = readAffiliateTags()): ShoppingLink[] {
  const clean = String(keyword ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_KEYWORD_LENGTH).trim();
  if (!clean) return [];
  const q = encodeURIComponent(clean);
  return SHOPPING_MALLS.map((m) => ({ mall: m.id, label: m.label, url: withAffiliate(m.url(q), tags[m.id]) }));
}

// ---------------------------------------------------------------------------------------------- fit check
/** A measured line on the room photo. Only `label` and `lengthCm` matter for the fit check; x/y are the on-photo endpoints. */
export type SpaceAnnotation = { id?: string; x1?: number; y1?: number; x2?: number; y2?: number; label: string; lengthCm: number };
export type FurnitureSize = { widthCm?: number | null; depthCm?: number | null; heightCm?: number | null };

export type FitStatus = "FIT" | "TIGHT" | "OVERFLOW" | "UNKNOWN";
export type FitAxis = "width" | "depth" | "height";
export type AxisFit = { axis: FitAxis; /** label of the measured line used as the basis */ basis: string; availableCm: number; furnitureCm: number; slackCm: number; status: Exclude<FitStatus, "UNKNOWN"> };
export type FitResult = {
  status: FitStatus;
  /** Smallest remaining space over the compared axes (negative = by how much it overflows); null when nothing was comparable. */
  slackCm: number | null;
  axes: AxisFit[];
  message: string;
  /** Which measured line the verdict compares against, e.g. "가로 소파 벽면 240cm 기준 · 30cm 여유"; "" when UNKNOWN. */
  basisLabel: string;
};

/** Slack up to this many cm (and at least 0) counts as "tight". */
export const TIGHT_MARGIN_CM = 5;

const HEIGHT_WORDS = /높이|천장|height/i;
const DEPTH_WORDS = /깊이|세로|길이 방향|depth/i;

/**
 * Which furniture dimension a measured line is about, from its label: 높이/천장 -> height, 깊이/세로 -> depth,
 * everything else (가로, 폭, 벽면, 창문 폭, unlabeled …) -> width.
 */
export function annotationAxis(label: string): FitAxis {
  if (HEIGHT_WORDS.test(label)) return "height";
  if (DEPTH_WORDS.test(label)) return "depth";
  return "width";
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const AXIS_KO: Record<FitAxis, string> = { width: "가로", depth: "깊이", height: "높이" };
const RANK: Record<AxisFit["status"], number> = { FIT: 0, TIGHT: 1, OVERFLOW: 2 };

/**
 * Compare a furniture's size with the measured space. For each axis the smallest matching measurement is used (the most
 * restrictive one); axes without a measurement or without a furniture size are skipped. The overall status is the worst axis:
 *   OVERFLOW  slack < 0   (furniture is bigger than the space)
 *   TIGHT     0 <= slack <= 5 cm
 *   FIT       slack > 5 cm
 *   UNKNOWN   nothing comparable (no measurements, or no furniture size)
 */
export function evaluateFurnitureFit(spaceAnnotations: readonly SpaceAnnotation[] | null | undefined, furnitureSize: FurnitureSize | null | undefined): FitResult {
  const sizes: Record<FitAxis, number | null> = {
    width: usable(furnitureSize?.widthCm) ? furnitureSize!.widthCm! : null,
    depth: usable(furnitureSize?.depthCm) ? furnitureSize!.depthCm! : null,
    height: usable(furnitureSize?.heightCm) ? furnitureSize!.heightCm! : null,
  };
  const available: Partial<Record<FitAxis, number>> = {};
  const basisOf: Partial<Record<FitAxis, string>> = {};
  for (const a of spaceAnnotations ?? []) {
    if (!a || !usable(a.lengthCm)) continue;
    const axis = annotationAxis(String(a.label ?? ""));
    if (a.lengthCm < (available[axis] ?? Infinity)) {
      available[axis] = a.lengthCm;
      basisOf[axis] = String(a.label ?? "").trim();
    }
  }

  const axes: AxisFit[] = [];
  for (const axis of ["width", "depth", "height"] as const) {
    const furnitureCm = sizes[axis];
    const availableCm = available[axis];
    if (furnitureCm === null || availableCm === undefined) continue;
    const slackCm = round1(availableCm - furnitureCm);
    axes.push({ axis, basis: basisOf[axis] ?? "", availableCm, furnitureCm, slackCm, status: slackCm < 0 ? "OVERFLOW" : slackCm <= TIGHT_MARGIN_CM ? "TIGHT" : "FIT" });
  }

  if (axes.length === 0) {
    return { status: "UNKNOWN", slackCm: null, axes, message: "비교할 치수가 부족해요. 공간 실측과 가구 크기를 입력해 주세요.", basisLabel: "" };
  }
  const worst = axes.reduce((w, a) => (RANK[a.status] > RANK[w.status] ? a : w));
  const slackCm = Math.min(...axes.map((a) => a.slackCm));
  const where = `${AXIS_KO[worst.axis]} 기준`;
  const message =
    worst.status === "OVERFLOW"
      ? `${where} ${Math.abs(worst.slackCm)}cm 초과해요. 놓기 어려워요.`
      : worst.status === "TIGHT"
        ? `${where} 여유가 ${worst.slackCm}cm뿐이에요. 5cm 이내로 빠듯해요.`
        : `${where} ${worst.slackCm}cm 여유가 있어요.`;
  return { status: worst.status, slackCm, axes, message, basisLabel: fitBasisLabel(worst) };
}

/** "가로 소파 벽면 240cm 기준 · 30cm 여유" / "깊이 90cm 기준 · 5cm 초과": the measured line the verdict is based on. */
export function fitBasisLabel(a: Pick<AxisFit, "axis" | "basis" | "availableCm" | "slackCm" | "status">): string {
  const word = AXIS_KO[a.axis];
  const name = !a.basis ? word : a.basis.includes(word) ? a.basis : `${word} ${a.basis}`;
  const tail = a.status === "OVERFLOW" ? `${round1(Math.abs(a.slackCm))}cm 초과` : `${a.slackCm}cm 여유`;
  return `${name} ${a.availableCm}cm 기준 · ${tail}`;
}

// ---------------------------------------------------------------------------------------------- labels & malls
export type AxisChoice = FitAxis | "custom";
export const AXIS_WORD: Record<FitAxis, string> = { width: "가로", depth: "깊이", height: "높이" };

/**
 * Label of a measured line from the axis the couple picked and an optional name ("소파 벽면"). The result always reads back as
 * the same axis through `annotationAxis` (the fit check relies on that): "깊이"/"높이" is appended when the name does not
 * already carry it; width needs no keyword (it is the default). `custom` keeps the typed name as is.
 */
export function composeLabel(axis: AxisChoice, name: string): string {
  const clean = String(name ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 40).trim();
  if (axis === "custom") return clean;
  if (!clean) return AXIS_WORD[axis];
  if (annotationAxis(clean) === axis) return clean;
  const joined = `${clean} ${AXIS_WORD[axis]}`;
  return joined.length <= 40 ? joined : AXIS_WORD[axis];
}

/** Mall id of a product link (for `source_mall`), or null when it is none of the four. */
export function inferMall(url: string | null | undefined): ShoppingMallId | null {
  let host = "";
  try {
    host = new URL(String(url ?? "")).hostname.toLowerCase();
  } catch {
    return null;
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is("ohou.se")) return "ohouse";
  if (is("naver.com") || is("naver.me")) return "naver";
  if (is("coupang.com") || is("coupa.ng")) return "coupang";
  if (is("ikea.com")) return "ikea";
  return null;
}

// ---------------------------------------------------------------------------------------------- wish board: budget & couple vote
export type BudgetCandidate = { status: string; price?: number | null };
export type BudgetSummary = {
  /** 최종 픽 (SELECTED) total, won */
  selectedTotal: number;
  selectedCount: number;
  /** 전체 후보 total: CANDIDATE + SELECTED (what is still on the table, 구매 완료 excluded) */
  candidateTotal: number;
  candidateCount: number;
  /** 구매 완료 total (already spent) */
  purchasedTotal: number;
  /** how many counted wishes have no price yet (so the total is a floor) */
  unpriced: number;
};

/** Live budget of one space's wish list. A missing price counts as 0 and is reported in `unpriced`. */
export function summarizeBudget(candidates: readonly BudgetCandidate[] | null | undefined): BudgetSummary {
  const out: BudgetSummary = { selectedTotal: 0, selectedCount: 0, candidateTotal: 0, candidateCount: 0, purchasedTotal: 0, unpriced: 0 };
  for (const c of candidates ?? []) {
    const price = typeof c?.price === "number" && Number.isFinite(c.price) && c.price > 0 ? c.price : 0;
    if (c?.status === "PURCHASED") {
      out.purchasedTotal += price;
      continue;
    }
    if (c?.status !== "SELECTED" && c?.status !== "CANDIDATE") continue;
    out.candidateTotal += price;
    out.candidateCount += 1;
    if (!price) out.unpriced += 1;
    if (c.status === "SELECTED") {
      out.selectedTotal += price;
      out.selectedCount += 1;
    }
  }
  return out;
}

/** "부부 공동 픽": at least two household members and every one of them has ♥-ed it. */
export function isJointPick(likedBy: readonly string[] | null | undefined, memberIds: readonly string[] | null | undefined): boolean {
  const members = [...new Set(memberIds ?? [])];
  if (members.length < 2) return false;
  const likes = new Set(likedBy ?? []);
  return members.every((m) => likes.has(m));
}
