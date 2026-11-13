import { NextResponse } from "next/server";
import { getSessionProfile } from "@/features/auth/server/session";
import { clientIp, rateLimit } from "@/shared/lib/rate-limit";
import { analyzeBill } from "@/features/analytics/server/gemini-bill";
import { analyzeBillBodySchema } from "@/features/analytics/schemas/bill.schema";
import { checkImage } from "@/features/kitchen/server/gemini-kitchen";

export const maxDuration = 60; // Gemini Vision can take a while (45 s client timeout per model)

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers: NO_STORE });

/**
 * Utility-bill reader (signed-in household members only, 10/min per user+IP).
 * Body: { imageBase64, mimeType } — the browser has already shrunk the photo. Nothing is stored here: the person reviews the extracted
 * values in the dialog and saves them through the bill server action. Same Gemini engine and dev:e2e mock as the other AI features.
 */
export async function POST(request: Request) {
  const { user, profile } = await getSessionProfile();
  if (!user) return fail(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  if (!profile) return fail(403, "NO_HOUSEHOLD", "가구 설정이 필요합니다.");

  const limit = rateLimit(`bill-analyze:${user.id}:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
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
  const parsed = analyzeBillBodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "고지서 사진을 확인해 주세요.");
  const { imageBase64, mimeType } = parsed.data;
  const problem = checkImage(imageBase64, mimeType);
  if (problem) return fail(400, "BAD_IMAGE", problem);

  const result = await analyzeBill({ imageBase64, mime: mimeType });
  if (!result.ok) return fail(503, "AI_UNAVAILABLE", result.error, { unavailable: true });
  return NextResponse.json({ ok: true, bill: result.bill }, { headers: NO_STORE });
}
