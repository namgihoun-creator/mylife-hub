import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionProfile } from "@/features/auth/server/session";
import { clientIp, rateLimit } from "@/shared/lib/rate-limit";
import { UrlError, fetchProductHtml, parseProductHtml } from "@/features/spaces/server/product-url";

export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;
const bodySchema = z.object({ url: z.string().trim().min(1).max(2000) });

const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers: NO_STORE });

/**
 * Product link -> { title, imageUrl, price, sourceMall } for the wish board (signed-in household members only, 15/min).
 * The server fetches the page, so it is an SSRF surface: http(s) only, private/loopback/link-local hosts refused (also after DNS
 * resolution and on every redirect hop), 5 s timeout, 1 MB cap. A page without usable metadata is a normal 422, not a crash.
 */
export async function POST(request: Request) {
  const { user, profile } = await getSessionProfile();
  if (!user) return fail(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  if (!profile) return fail(403, "NO_HOUSEHOLD", "가구 설정이 필요합니다.");

  const limit = rateLimit(`space-parse-url:${user.id}:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED", message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "BAD_REQUEST", "잘못된 요청입니다.");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "BAD_REQUEST", "상품 링크를 입력해 주세요.");

  try {
    const { html, finalUrl } = await fetchProductHtml(parsed.data.url);
    const meta = parseProductHtml(html, finalUrl.toString());
    if (!meta.title && !meta.imageUrl && meta.price === null) {
      return fail(422, "NO_METADATA", "이 링크에서 상품 정보를 읽지 못했어요. 직접 입력해 주세요.", { sourceMall: meta.sourceMall });
    }
    return NextResponse.json({ ok: true, ...meta, url: finalUrl.toString() }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof UrlError) {
      const status = e.code === "INVALID_URL" ? 400 : e.code === "BLOCKED_URL" ? 400 : 502;
      return fail(status, e.code, e.message);
    }
    return fail(502, "FETCH_FAILED", "링크를 불러오지 못했어요. 직접 입력해 주세요.");
  }
}
