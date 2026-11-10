"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/features/auth/server/session";
import { createClient } from "@/shared/lib/supabase/server";
import {
  ALLOWED_MIME,
  DOCUMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
  MIME_EXT,
  finalizeUploadInputSchema,
  prepareUploadInputSchema,
  type AssetDocument,
  type DeleteDocumentResult,
  type DocumentActionResult,
  type DocumentListResult,
  type DocumentMime,
  type DownloadUrlResult,
  type PrepareUploadResult,
} from "../schemas/document.schema";

// Every call runs under the caller's JWT: RLS (household + asset visibility) is the real gate; the checks
// below produce friendly messages and keep the contract tight.
// Files never pass through a Server Action body (Vercel serverless limit 4.5MB < our 10MB): the browser
// uploads straight to Storage with a signed upload token, then `uploadAssetDocument` records the metadata
// after re-reading the object's REAL size/type from Storage.

const COLUMNS = "id, asset_id, file_name, file_size, mime_type, document_type, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const friendly = (msg?: string) => (msg && /[가-힣]/.test(msg) ? msg : "잘못된 요청입니다.");

/** Documents of one asset, newest first. */
export async function listAssetDocuments(assetId: string): Promise<DocumentListResult> {
  if (!UUID.test(assetId)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_documents")
    .select(COLUMNS)
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: "문서 목록을 불러오지 못했어요." };
  return { ok: true, documents: (data ?? []) as AssetDocument[] };
}

/** Step 1 — validate type/size/permission and hand out a one-time signed upload token for a fresh object path. */
export async function prepareAssetDocumentUpload(input: unknown): Promise<PrepareUploadResult> {
  const parsed = prepareUploadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendly(parsed.error.issues[0]?.message) };
  const { assetId, mimeType } = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };

  const supabase = await createClient();
  // RLS: only assets this user can see come back (other household / someone else's PRIVATE asset → null).
  const { data: asset } = await supabase.from("assets").select("id").eq("id", assetId).maybeSingle();
  if (!asset) return { ok: false, error: "자산을 찾을 수 없거나 권한이 없어요." };

  // Server-chosen path: nothing from the client's file name ends up in it.
  const path = `${profile.householdId}/${assetId}/${randomUUID()}.${MIME_EXT[mimeType]}`;
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "업로드를 준비하지 못했어요. 잠시 후 다시 시도해 주세요." };
  return { ok: true, path: data.path, token: data.token };
}

/** Step 2 — after the browser upload: verify the stored object, then insert the metadata row. */
export async function uploadAssetDocument(input: unknown): Promise<DocumentActionResult> {
  const parsed = finalizeUploadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "잘못된 요청입니다." };
  const { assetId, path, fileName, documentType } = parsed.data;

  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };

  // The path must be exactly <household>/<asset>/<file> for THIS household and asset.
  const prefix = `${profile.householdId}/${assetId}/`;
  if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) return { ok: false, error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const storage = supabase.storage.from(DOCUMENT_BUCKET);

  // Trust Storage, not the client: read the stored object's actual size and content type.
  const objectName = path.slice(prefix.length);
  const { data: listed, error: listError } = await storage.list(prefix.slice(0, -1), { search: objectName, limit: 5 });
  const obj = listed?.find((o) => o.name === objectName);
  if (listError || !obj) return { ok: false, error: "업로드된 파일을 확인하지 못했어요. 다시 시도해 주세요." };
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  const mime = String((obj.metadata as { mimetype?: string } | null)?.mimetype ?? "");
  if (!(ALLOWED_MIME as readonly string[]).includes(mime) || size <= 0 || size > MAX_DOCUMENT_BYTES) {
    await storage.remove([path]);
    return { ok: false, error: "허용되지 않는 파일이라 삭제했어요. (10MB 이하 JPG·PNG·WEBP·PDF)" };
  }

  const { data: row, error } = await supabase
    .from("asset_documents")
    .insert({
      household_id: profile.householdId,
      asset_id: assetId,
      owner_id: user.id,
      file_name: fileName,
      storage_path: path,
      file_size: size,
      mime_type: mime as DocumentMime,
      document_type: documentType,
    })
    .select(COLUMNS)
    .single();
  if (error || !row) {
    await storage.remove([path]); // no metadata → no orphan object
    return { ok: false, error: "문서를 저장하지 못했어요. 자산 접근 권한을 확인해 주세요." };
  }

  revalidatePath("/assets");
  return { ok: true, document: row as AssetDocument };
}

/** Short-lived (60s) signed URL for a download. The row is read through RLS first, so only permitted users get one.
 *  The original (possibly Korean) file name is applied client-side: Storage's `download` option would send it percent-encoded. */
export async function getDocumentDownloadUrl(documentId: string): Promise<DownloadUrlResult> {
  if (!UUID.test(documentId)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("asset_documents").select("storage_path").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, error: "문서를 찾을 수 없거나 권한이 없어요." };

  const expiresIn = 60;
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_path, expiresIn);
  if (error || !data) return { ok: false, error: "다운로드 링크를 만들지 못했어요." };
  return { ok: true, url: data.signedUrl, expiresIn };
}

/** Inline-view URL (no forced download) for thumbnails and "열기": same RLS gate, short TTL. */
export async function getDocumentPreviewUrl(documentId: string): Promise<DownloadUrlResult> {
  if (!UUID.test(documentId)) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("asset_documents").select("storage_path").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, error: "문서를 찾을 수 없거나 권한이 없어요." };
  const expiresIn = 300;
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_path, expiresIn);
  if (error || !data) return { ok: false, error: "미리보기를 만들지 못했어요." };
  return { ok: true, url: data.signedUrl, expiresIn };
}

/** Delete: the row first (RLS decides; `select()` proves a row was really removed), then the object. */
export async function deleteAssetDocument(documentId: string): Promise<DeleteDocumentResult> {
  if (!UUID.test(documentId)) return { ok: false, error: "잘못된 요청입니다." };
  const { user } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase.from("asset_documents").delete().eq("id", documentId).select("storage_path");
  if (error) return { ok: false, error: "문서를 삭제하지 못했어요." };
  if (!removed || removed.length === 0) return { ok: false, error: "문서를 찾을 수 없거나 삭제 권한이 없어요." };

  const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).remove([removed[0].storage_path]);
  if (storageError) console.error("asset-documents: object removal failed", storageError.message); // row is gone; the object is unreachable
  revalidatePath("/assets");
  return { ok: true };
}
