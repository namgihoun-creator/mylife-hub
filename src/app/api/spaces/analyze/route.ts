import { NextResponse } from "next/server";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import { clientIp, rateLimit } from "@/shared/lib/rate-limit";
import { analyzeSpace, type RoomType } from "@/features/spaces/server/gemini-space";
import { analyzeBodySchema, annotationsSchema } from "@/features/spaces/schemas/space.schema";
import { checkImage, sniffImage, MAX_IMAGE_BYTES } from "@/features/kitchen/server/gemini-kitchen";

export const maxDuration = 60; // Gemini Vision can take a while (45 s client timeout per model)

const NO_STORE = { "Cache-Control": "no-store" };
const BUCKET = "space-photos";
// Gemini is on the free tier: a couple analysing a room needs a handful of calls, not hundreds.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;

const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers: NO_STORE });

/**
 * Space coordinator (signed-in household members only).
 * Body: { spaceId?, imageBase64+mime | photoPath, annotations[], roomType, style }.
 * A stored photo (photoPath, or the one on `spaceId`) is read from the private bucket under the caller's JWT, so storage
 * RLS decides access; a path outside the caller's household folder is refused up front. With `spaceId` the result is also
 * cached on the space (ai_diagnosis).
 */
export async function POST(request: Request) {
  const { user, profile } = await getSessionProfile();
  if (!user) return fail(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  if (!profile) return fail(403, "NO_HOUSEHOLD", "가구 설정이 필요합니다.");

  const limit = rateLimit(`space-analyze:${user.id}:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
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
  const parsed = analyzeBodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "BAD_REQUEST", "공간 사진과 치수 정보를 확인해 주세요.");
  const body = parsed.data;

  const supabase = await createClient();

  // Saved space (RLS: own household only) supplies whatever the request leaves out.
  let photoPath = body.photoPath ?? null;
  let annotations = body.annotations;
  let roomType: RoomType = body.roomType ?? "etc";
  let style = body.style ?? null;
  if (body.spaceId) {
    const { data: space } = await supabase
      .from("space_projects")
      .select("photo_path, annotations, room_type, style_preference")
      .eq("id", body.spaceId)
      .maybeSingle();
    if (!space) return fail(404, "SPACE_NOT_FOUND", "공간을 찾을 수 없어요.");
    if (!body.imageBase64 && !photoPath) photoPath = (space.photo_path as string | null) ?? null;
    const saved = annotationsSchema.safeParse(space.annotations);
    if (annotations.length === 0 && saved.success) annotations = saved.data;
    if (!body.roomType) roomType = space.room_type as RoomType;
    if (!style) style = (space.style_preference as string | null) ?? null;
  }

  // Photo: inline base64 or the private bucket.
  let imageBase64: string;
  let mime: NonNullable<typeof body.mime>;
  if (body.imageBase64 && body.mime) {
    const problem = checkImage(body.imageBase64, body.mime);
    if (problem) return fail(400, "BAD_IMAGE", problem);
    imageBase64 = body.imageBase64;
    mime = body.mime;
  } else if (photoPath) {
    const parts = photoPath.split("/");
    if (parts[0] !== profile.householdId || parts.some((p) => !p || p === "." || p === "..")) {
      return fail(403, "FORBIDDEN_PATH", "이 사진은 사용할 수 없어요.");
    }
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(photoPath);
    if (error || !blob) return fail(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없어요.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return fail(400, "BAD_IMAGE", "사진이 너무 커요. 더 작은 사진으로 다시 올려 주세요.");
    const sniffed = sniffImage(bytes);
    if (!sniffed) return fail(400, "BAD_IMAGE", "JPG, PNG, WEBP 사진만 분석할 수 있어요.");
    imageBase64 = Buffer.from(bytes).toString("base64");
    mime = sniffed;
  } else {
    return fail(400, "BAD_REQUEST", "공간 사진이 필요해요.");
  }

  const result = await analyzeSpace({ imageBase64, mime, annotations, roomType, style });
  if (!result.ok) return fail(503, "AI_UNAVAILABLE", result.error, { unavailable: true });

  let cached = false;
  if (body.spaceId) {
    const { error } = await supabase
      .from("space_projects")
      .update({ ai_diagnosis: { ...result.diagnosis, analyzedAt: new Date().toISOString() } })
      .eq("id", body.spaceId);
    cached = !error;
  }

  return NextResponse.json({ ok: true, diagnosis: result.diagnosis, cached }, { headers: NO_STORE });
}
