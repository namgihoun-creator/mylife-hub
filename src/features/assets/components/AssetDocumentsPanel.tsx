"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { createClient } from "@/shared/lib/supabase/client";
import { cn } from "@/shared/lib/utils";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  formatBytes,
  validateDocumentFile,
  type AssetDocument,
  type DocumentType,
} from "../schemas/document.schema";
import {
  deleteAssetDocument,
  getDocumentDownloadUrl,
  getDocumentPreviewUrl,
  listAssetDocuments,
  prepareAssetDocumentUpload,
  uploadAssetDocument,
} from "../server/document.actions";

const TYPE_TAG: Record<DocumentType, string> = {
  RECEIPT: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  WARRANTY: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300",
  MANUAL: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  OTHER: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\s/g, "");

function DocumentRow({
  doc,
  onDeleted,
  onError,
}: {
  doc: AssetDocument;
  onDeleted: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const isImage = doc.mime_type.startsWith("image/");
  const [thumb, setThumb] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"download" | "delete" | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    getDocumentPreviewUrl(doc.id).then((r) => alive && r.ok && setThumb(r.url));
    return () => {
      alive = false;
    };
  }, [doc.id, isImage]);

  const download = async () => {
    setBusy("download");
    const r = await getDocumentDownloadUrl(doc.id);
    setBusy(null);
    if (!r.ok) return onError(r.error);
    try {
      // Fetch the signed (60s) URL and save the blob under the ORIGINAL file name (Korean names stay intact).
      const res = await fetch(r.url);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      window.open(r.url, "_blank", "noopener"); // fallback: let the browser handle the signed URL
    }
  };

  const remove = async () => {
    setBusy("delete");
    const r = await deleteAssetDocument(doc.id);
    setBusy(null);
    if (!r.ok) {
      setConfirming(false);
      return onError(r.error);
    }
    onDeleted(doc.id);
  };

  return (
    <li
      data-testid="asset-document"
      data-doc-id={doc.id}
      className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-300 dark:border-zinc-800/80 dark:bg-zinc-950 dark:hover:border-zinc-700"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        {isImage && thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
          <img src={thumb} alt={`${doc.file_name} 미리보기`} className="h-full w-full object-cover" />
        ) : (
          <FileText role={isImage ? undefined : "img"} className={cn("h-5 w-5", isImage ? "text-zinc-300 dark:text-zinc-700" : "text-rose-500 dark:text-rose-400")} aria-label={isImage ? undefined : "PDF"} aria-hidden={isImage ? true : undefined} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50" title={doc.file_name}>
          {doc.file_name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("rounded-full border px-2 py-px text-[10px] font-semibold", TYPE_TAG[doc.document_type])}>
            {DOCUMENT_TYPE_LABEL[doc.document_type]}
          </span>
          <span className="text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
            {formatBytes(doc.file_size)} · {formatDate(doc.created_at)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={remove}
              disabled={busy === "delete"}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-500"
            >
              {busy === "delete" && <Loader2 className="h-3 w-3 animate-spin" />}
              삭제 확인
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-8 items-center rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={download}
              disabled={busy !== null}
              aria-label={`${doc.file_name} 다운로드`}
              title="다운로드"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`${doc.file_name} 삭제`}
              title="삭제"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** 문서 & 보증서 tab: type tags + drag-and-drop uploader + document cards. Files go browser → Storage directly (signed token). */
export function AssetDocumentsPanel({ assetId }: { assetId: string }) {
  const [docs, setDocs] = useState<AssetDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocumentType>("RECEIPT");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null); // file name in flight
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await listAssetDocuments(assetId);
    if (r.ok) {
      setDocs(r.documents);
      setLoadError(null);
    } else setLoadError(r.error);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = async (files: File[]) => {
    setMessage(null);
    const supabase = createClient();
    for (const file of files) {
      const invalid = validateDocumentFile(file);
      if (invalid) {
        setMessage({ kind: "error", text: `${file.name}: ${invalid}` });
        continue;
      }
      setUploading(file.name);
      try {
        const prep = await prepareAssetDocumentUpload({ assetId, fileName: file.name, mimeType: file.type, size: file.size, documentType: docType });
        if (!prep.ok) {
          setMessage({ kind: "error", text: `${file.name}: ${prep.error}` });
          continue;
        }
        const up = await supabase.storage.from(DOCUMENT_BUCKET).uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type });
        if (up.error) {
          setMessage({ kind: "error", text: `${file.name}: 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.` });
          continue;
        }
        const done = await uploadAssetDocument({ assetId, path: prep.path, fileName: file.name, documentType: docType });
        if (!done.ok) {
          setMessage({ kind: "error", text: `${file.name}: ${done.error}` });
          continue;
        }
        setDocs((cur) => [done.document, ...(cur ?? [])]);
        setMessage({ kind: "success", text: `${file.name} 업로드 완료` });
      } catch {
        setMessage({ kind: "error", text: `${file.name}: 네트워크 오류가 발생했어요.` });
      } finally {
        setUploading(null);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-4" data-testid="documents-panel">
      <fieldset className="space-y-2">
        <legend className="text-xs font-normal text-zinc-500 dark:text-zinc-400">문서 유형</legend>
        <div role="radiogroup" aria-label="문서 유형" className="flex flex-wrap gap-2">
          {DOCUMENT_TYPES.map((t) => {
            const active = docType === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDocType(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                  active
                    ? "border-zinc-900 bg-zinc-50 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900/60 dark:text-zinc-50 dark:ring-zinc-100"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-black dark:text-zinc-400 dark:hover:border-zinc-700",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                    active ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-700",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full bg-zinc-900 transition-transform dark:bg-zinc-100", active ? "scale-100" : "scale-0")} />
                </span>
                {DOCUMENT_TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div
        data-testid="document-dropzone"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void uploadFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          "relative flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60"
            : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600",
        )}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {uploading ? `${uploading} 올리는 중…` : "파일을 끌어다 놓거나 선택하세요"}
        </p>
        <p className="text-xs font-normal text-zinc-500 dark:text-zinc-400">JPG · PNG · WEBP · PDF, 최대 10MB</p>
        <button
          type="button"
          disabled={uploading !== null}
          onClick={() => inputRef.current?.click()}
          className="mt-1 inline-flex h-8 items-center rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="문서 파일 선택"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => void uploadFiles([...(e.target.files ?? [])])}
        />
      </div>

      <p role="status" aria-live="polite" data-testid="document-message" className={cn("min-h-4 text-xs font-medium", message?.kind === "error" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
        {message?.text}
      </p>

      <section aria-label="업로드된 문서" className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          업로드된 문서 <span className="font-normal text-zinc-500 dark:text-zinc-400">{docs?.length ?? 0}</span>
        </h3>
        {loadError ? (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{loadError}</p>
        ) : docs === null ? (
          <div className="h-[72px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        ) : docs.length === 0 ? (
          <p data-testid="documents-empty" className="rounded-xl border border-dashed border-zinc-200 p-4 text-center text-xs font-normal text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            아직 올린 문서가 없어요. 영수증이나 보증서를 올려 두면 필요할 때 바로 찾을 수 있어요.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {docs.map((d) => (
              <DocumentRow key={d.id} doc={d} onDeleted={(id) => setDocs((cur) => (cur ?? []).filter((x) => x.id !== id))} onError={(text) => setMessage({ kind: "error", text })} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
