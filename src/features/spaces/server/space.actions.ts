"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import { inferMall } from "@/shared/utils/space-planner";
import {
  annotationsSchema,
  candidateInputSchema,
  candidateStatusSchema,
  createSpaceSchema,
  spaceIdSchema,
  updateSpaceMetaSchema,
  type CandidateInput,
  type FurnitureCandidate,
  type SpaceActionResult,
  type SpaceDetail,
  type SpaceListItem,
  type SpaceProject,
} from "../schemas/space-board.schema";
import type { AnnotationInput } from "../schemas/space.schema";

// Every action runs under the caller's JWT: RLS (current_household_id()) is the household boundary. Spaces are a shared
// couple resource, so any signed-in household member may do everything; the photo bucket is private and only ever shown
// through short-lived signed URLs.

const BUCKET = "space-photos";
const SIGNED_URL_SECONDS = 60 * 60;
const SPACE_COLUMNS = "id, name, room_type, photo_path, annotations, style_preference, ai_diagnosis, created_at, updated_at";
const CANDIDATE_COLUMNS = "id, space_id, name, category, price, width_cm, depth_cm, height_cm, product_url, source_mall, status, memo, created_at";
const NOT_READY = "공간 플래너 데이터베이스가 아직 준비되지 않았어요.";

const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");

type Ctx = { supabase: SupabaseClient; householdId: string; userId: string };
async function context(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  return { ok: true, ctx: { supabase: await createClient(), householdId: profile.householdId, userId: user.id } };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v)); // numeric columns arrive as strings
const toCandidate = (r: Record<string, unknown>): FurnitureCandidate => ({
  ...(r as unknown as FurnitureCandidate),
  price: r.price === null ? null : Number(r.price),
  width_cm: num(r.width_cm),
  depth_cm: num(r.depth_cm),
  height_cm: num(r.height_cm),
});
const toSpace = (r: Record<string, unknown>): SpaceProject => {
  const ann = annotationsSchema.safeParse(r.annotations);
  return { ...(r as unknown as SpaceProject), annotations: ann.success ? ann.data : [] };
};

async function signedUrls(supabase: SupabaseClient, paths: (string | null)[]): Promise<(string | null)[]> {
  const real = [...new Set(paths.filter((p): p is string => !!p))];
  if (real.length === 0) return paths.map(() => null);
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(real, SIGNED_URL_SECONDS);
  const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return paths.map((p) => (p ? (map.get(p) ?? null) : null));
}

// ---------------------------------------------------------------------------------------------- read
export async function getSpacesList(): Promise<SpaceActionResult<{ spaces: SpaceListItem[] }>> {
  const c = await context();
  if (!c.ok) return c;
  const { supabase } = c.ctx;
  const [sp, cands] = await Promise.all([
    supabase.from("space_projects").select(SPACE_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("space_furniture_candidates").select("space_id"),
  ]);
  if (sp.error) return { ok: false, error: NOT_READY };
  if (cands.error) return { ok: false, error: NOT_READY };

  const counts = new Map<string, number>();
  for (const r of cands.data ?? []) counts.set(r.space_id as string, (counts.get(r.space_id as string) ?? 0) + 1);
  const rows = (sp.data ?? []).map((r) => toSpace(r));
  const urls = await signedUrls(supabase, rows.map((r) => r.photo_path));
  return {
    ok: true,
    spaces: rows.map((s, i) => ({
      id: s.id, name: s.name, room_type: s.room_type, photo_path: s.photo_path, style_preference: s.style_preference,
      created_at: s.created_at, updated_at: s.updated_at,
      photoUrl: urls[i], annotationCount: s.annotations.length, candidateCount: counts.get(s.id) ?? 0,
    })),
  };
}

export async function getSpaceDetail(id: string): Promise<SpaceActionResult<{ detail: SpaceDetail }>> {
  const c = await context();
  if (!c.ok) return c;
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "공간을 찾을 수 없어요." };
  const { supabase, householdId } = c.ctx;
  const [sp, cands] = await Promise.all([
    supabase.from("space_projects").select(SPACE_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("space_furniture_candidates").select(CANDIDATE_COLUMNS).eq("space_id", id).order("created_at", { ascending: true }),
  ]);
  if (sp.error || cands.error) return { ok: false, error: NOT_READY };
  if (!sp.data) return { ok: false, error: "공간을 찾을 수 없어요." };
  const space = toSpace(sp.data);
  const [photoUrl] = await signedUrls(supabase, [space.photo_path]);
  return { ok: true, detail: { space, photoUrl, candidates: (cands.data ?? []).map(toCandidate), householdId } };
}

/** Light read for the near-real-time sync between the two partners' phones. */
export async function getSpaceSync(id: string): Promise<SpaceActionResult<{ annotations: AnnotationInput[]; candidates: FurnitureCandidate[]; diagnosis: SpaceProject["ai_diagnosis"] }>> {
  const c = await context();
  if (!c.ok) return c;
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "공간을 찾을 수 없어요." };
  const { supabase } = c.ctx;
  const [sp, cands] = await Promise.all([
    supabase.from("space_projects").select("annotations, ai_diagnosis").eq("id", id).maybeSingle(),
    supabase.from("space_furniture_candidates").select(CANDIDATE_COLUMNS).eq("space_id", id).order("created_at", { ascending: true }),
  ]);
  if (sp.error || cands.error || !sp.data) return { ok: false, error: "동기화하지 못했어요." };
  const ann = annotationsSchema.safeParse(sp.data.annotations);
  return { ok: true, annotations: ann.success ? ann.data : [], candidates: (cands.data ?? []).map(toCandidate), diagnosis: (sp.data.ai_diagnosis as SpaceProject["ai_diagnosis"]) ?? null };
}

// ---------------------------------------------------------------------------------------------- spaces
export async function createSpace(input: unknown): Promise<SpaceActionResult<{ id: string }>> {
  const c = await context();
  if (!c.ok) return c;
  const parsed = createSpaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const { supabase, householdId, userId } = c.ctx;
  const { data, error } = await supabase
    .from("space_projects")
    .insert({ household_id: householdId, created_by: userId, name: parsed.data.name, room_type: parsed.data.roomType, style_preference: parsed.data.style ?? null })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "공간을 만들지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true, id: data.id as string };
}

export async function updateSpaceMeta(id: string, input: unknown): Promise<SpaceActionResult> {
  const c = await context();
  if (!c.ok) return c;
  const parsed = updateSpaceMetaSchema.safeParse(input);
  if (!spaceIdSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const patch: Record<string, unknown> = {};
  if (parsed.data.roomType) patch.room_type = parsed.data.roomType;
  if (parsed.data.style !== undefined) patch.style_preference = parsed.data.style;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await c.ctx.supabase.from("space_projects").update(patch).eq("id", id);
  if (error) return { ok: false, error: "저장하지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true };
}

/** After the browser uploaded `<household>/<space>/<file>` itself: remember the path and drop the previous photo. */
export async function setSpacePhoto(id: string, path: string): Promise<SpaceActionResult<{ photoUrl: string | null }>> {
  const c = await context();
  if (!c.ok) return c;
  const { supabase, householdId } = c.ctx;
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "공간을 찾을 수 없어요." };
  const parts = String(path).split("/");
  if (parts.length !== 3 || parts[0] !== householdId || parts[1] !== id || !parts[2] || parts[2].startsWith(".")) return { ok: false, error: "사진 경로가 올바르지 않아요." };

  const { data: prev, error: readErr } = await supabase.from("space_projects").select("photo_path").eq("id", id).maybeSingle();
  if (readErr || !prev) return { ok: false, error: "공간을 찾을 수 없어요." };
  // A new photo makes the old diagnosis (and its fit verdicts) stale.
  const { error } = await supabase.from("space_projects").update({ photo_path: path, ai_diagnosis: null }).eq("id", id);
  if (error) return { ok: false, error: "사진을 저장하지 못했어요." };
  if (prev.photo_path && prev.photo_path !== path) await supabase.storage.from(BUCKET).remove([prev.photo_path as string]);
  const [photoUrl] = await signedUrls(supabase, [path]);
  revalidatePath("/spaces");
  return { ok: true, photoUrl };
}

export async function saveAnnotations(id: string, annotations: unknown): Promise<SpaceActionResult<{ annotations: AnnotationInput[] }>> {
  const c = await context();
  if (!c.ok) return c;
  const parsed = annotationsSchema.safeParse(annotations);
  if (!spaceIdSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "치수 정보를 확인해 주세요." };
  const { error } = await c.ctx.supabase.from("space_projects").update({ annotations: parsed.data }).eq("id", id);
  if (error) return { ok: false, error: "치수를 저장하지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true, annotations: parsed.data };
}

export async function deleteSpace(id: string): Promise<SpaceActionResult> {
  const c = await context();
  if (!c.ok) return c;
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "공간을 찾을 수 없어요." };
  const { supabase, householdId } = c.ctx;
  // Photos first (the folder is the space id), then the row (candidates cascade).
  const folder = `${householdId}/${id}`;
  const { data: files } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
  if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
  const { error } = await supabase.from("space_projects").delete().eq("id", id);
  if (error) return { ok: false, error: "공간을 삭제하지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------- wish board
const candidateRow = (d: ReturnType<typeof candidateInputSchema.parse>) => ({
  name: d.name,
  category: d.category ?? null,
  price: d.price ?? null,
  width_cm: d.widthCm ?? null,
  depth_cm: d.depthCm ?? null,
  height_cm: d.heightCm ?? null,
  product_url: d.productUrl ?? null,
  source_mall: inferMall(d.productUrl),
  memo: d.memo ?? null,
});

export async function addCandidate(spaceId: string, input: CandidateInput): Promise<SpaceActionResult<{ candidate: FurnitureCandidate }>> {
  const c = await context();
  if (!c.ok) return c;
  const parsed = candidateInputSchema.safeParse(input);
  if (!spaceIdSchema.safeParse(spaceId).success) return { ok: false, error: "공간을 찾을 수 없어요." };
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const { supabase, householdId, userId } = c.ctx;
  const { data, error } = await supabase
    .from("space_furniture_candidates")
    .insert({ space_id: spaceId, household_id: householdId, created_by: userId, ...candidateRow(parsed.data) })
    .select(CANDIDATE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "위시 보드에 담지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true, candidate: toCandidate(data) };
}

export async function updateCandidate(id: string, input: CandidateInput): Promise<SpaceActionResult<{ candidate: FurnitureCandidate }>> {
  const c = await context();
  if (!c.ok) return c;
  const parsed = candidateInputSchema.safeParse(input);
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "가구를 찾을 수 없어요." };
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const { data, error } = await c.ctx.supabase.from("space_furniture_candidates").update(candidateRow(parsed.data)).eq("id", id).select(CANDIDATE_COLUMNS).maybeSingle();
  if (error || !data) return { ok: false, error: "저장하지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true, candidate: toCandidate(data) };
}

export async function setCandidateStatus(id: string, status: string): Promise<SpaceActionResult<{ candidate: FurnitureCandidate }>> {
  const c = await context();
  if (!c.ok) return c;
  const st = candidateStatusSchema.safeParse(status);
  if (!spaceIdSchema.safeParse(id).success || !st.success) return { ok: false, error: "잘못된 요청입니다." };
  const { data, error } = await c.ctx.supabase.from("space_furniture_candidates").update({ status: st.data }).eq("id", id).select(CANDIDATE_COLUMNS).maybeSingle();
  if (error || !data) return { ok: false, error: "상태를 바꾸지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true, candidate: toCandidate(data) };
}

export async function deleteCandidate(id: string): Promise<SpaceActionResult> {
  const c = await context();
  if (!c.ok) return c;
  if (!spaceIdSchema.safeParse(id).success) return { ok: false, error: "가구를 찾을 수 없어요." };
  const { error } = await c.ctx.supabase.from("space_furniture_candidates").delete().eq("id", id);
  if (error) return { ok: false, error: "삭제하지 못했어요." };
  revalidatePath("/spaces");
  return { ok: true };
}
