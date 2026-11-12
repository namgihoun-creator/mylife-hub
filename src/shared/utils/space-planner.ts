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

/** One search URL per mall for a Korean keyword (trimmed, whitespace collapsed, URL-encoded). Empty keyword -> no links. */
export function buildShoppingLinks(keyword: string): ShoppingLink[] {
  const clean = String(keyword ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_KEYWORD_LENGTH).trim();
  if (!clean) return [];
  const q = encodeURIComponent(clean);
  return SHOPPING_MALLS.map((m) => ({ mall: m.id, label: m.label, url: m.url(q) }));
}

// ---------------------------------------------------------------------------------------------- fit check
/** A measured line on the room photo. Only `label` and `lengthCm` matter for the fit check; x/y are the on-photo endpoints. */
export type SpaceAnnotation = { id?: string; x1?: number; y1?: number; x2?: number; y2?: number; label: string; lengthCm: number };
export type FurnitureSize = { widthCm?: number | null; depthCm?: number | null; heightCm?: number | null };

export type FitStatus = "FIT" | "TIGHT" | "OVERFLOW" | "UNKNOWN";
export type FitAxis = "width" | "depth" | "height";
export type AxisFit = { axis: FitAxis; availableCm: number; furnitureCm: number; slackCm: number; status: Exclude<FitStatus, "UNKNOWN"> };
export type FitResult = {
  status: FitStatus;
  /** Smallest remaining space over the compared axes (negative = by how much it overflows); null when nothing was comparable. */
  slackCm: number | null;
  axes: AxisFit[];
  message: string;
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
  for (const a of spaceAnnotations ?? []) {
    if (!a || !usable(a.lengthCm)) continue;
    const axis = annotationAxis(String(a.label ?? ""));
    available[axis] = Math.min(available[axis] ?? Infinity, a.lengthCm);
  }

  const axes: AxisFit[] = [];
  for (const axis of ["width", "depth", "height"] as const) {
    const furnitureCm = sizes[axis];
    const availableCm = available[axis];
    if (furnitureCm === null || availableCm === undefined) continue;
    const slackCm = round1(availableCm - furnitureCm);
    axes.push({ axis, availableCm, furnitureCm, slackCm, status: slackCm < 0 ? "OVERFLOW" : slackCm <= TIGHT_MARGIN_CM ? "TIGHT" : "FIT" });
  }

  if (axes.length === 0) {
    return { status: "UNKNOWN", slackCm: null, axes, message: "비교할 치수가 부족해요. 공간 실측과 가구 크기를 입력해 주세요." };
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
  return { status: worst.status, slackCm, axes, message };
}
