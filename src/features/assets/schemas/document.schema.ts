import { z } from "zod";

export const DOCUMENT_BUCKET = "asset-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB (also enforced by the bucket and a table CHECK)

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type DocumentMime = (typeof ALLOWED_MIME)[number];
export const MIME_EXT: Record<DocumentMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const DOCUMENT_TYPES = ["RECEIPT", "WARRANTY", "MANUAL", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  RECEIPT: "영수증",
  WARRANTY: "보증서",
  MANUAL: "설명서",
  OTHER: "기타",
};

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;

/** Client-side pre-check (the server re-validates everything, and Storage enforces size/type again). */
export function validateDocumentFile(file: { size: number; type: string }): string | null {
  if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) return "JPG, PNG, WEBP 이미지 또는 PDF만 올릴 수 있어요.";
  if (file.size <= 0) return "빈 파일은 올릴 수 없어요.";
  if (file.size > MAX_DOCUMENT_BYTES) return `파일은 ${formatBytes(MAX_DOCUMENT_BYTES)} 이하만 올릴 수 있어요.`;
  return null;
}

const uuid = z.string().uuid();

export const prepareUploadInputSchema = z.object({
  assetId: uuid,
  fileName: z.string().trim().min(1, "파일 이름이 비어 있어요.").max(255, "파일 이름이 너무 길어요."),
  mimeType: z.enum(ALLOWED_MIME, { message: "JPG, PNG, WEBP 이미지 또는 PDF만 올릴 수 있어요." }),
  size: z
    .number()
    .int()
    .positive("빈 파일은 올릴 수 없어요.")
    .max(MAX_DOCUMENT_BYTES, `파일은 ${formatBytes(MAX_DOCUMENT_BYTES)} 이하만 올릴 수 있어요.`),
  documentType: z.enum(DOCUMENT_TYPES),
});

export const finalizeUploadInputSchema = z.object({
  assetId: uuid,
  path: z.string().min(10).max(400),
  fileName: z.string().trim().min(1).max(255),
  documentType: z.enum(DOCUMENT_TYPES),
});

export type AssetDocument = {
  id: string;
  asset_id: string;
  file_name: string;
  file_size: number;
  mime_type: DocumentMime;
  document_type: DocumentType;
  created_at: string;
};

export type PrepareUploadResult = { ok: true; path: string; token: string } | { ok: false; error: string };
export type DocumentActionResult = { ok: true; document: AssetDocument } | { ok: false; error: string };
export type DeleteDocumentResult = { ok: true } | { ok: false; error: string };
export type DownloadUrlResult = { ok: true; url: string; expiresIn: number } | { ok: false; error: string };
export type DocumentListResult = { ok: true; documents: AssetDocument[] } | { ok: false; error: string };
