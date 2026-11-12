"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { SpaceDimensionAnnotator } from "./SpaceDimensionAnnotator";
import { SpaceAiCoordinator } from "./SpaceAiCoordinator";
import { WishFurnitureBoard } from "./WishFurnitureBoard";
import { addCandidate, deleteSpace, getSpaceSync } from "../server/space.actions";
import { roomLabel, type RoomType } from "../schemas/space-constants";
import type { FurnitureCandidate, SpaceDetail, SpaceDiagnosisCache } from "../schemas/space-board.schema";
import type { AnnotationInput } from "../schemas/space.schema";
import type { Recommendation } from "../server/gemini-space";
import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";

const SYNC_MS = 15_000;

/**
 * One space: measure -> ask the AI -> collect wish furniture. Holds the shared state (measurements feed both the AI call and the
 * fit badges). The partner's changes arrive by polling `getSpaceSync` (every 15 s while the tab is visible, and when it regains
 * focus); measurements are not overwritten while this user is drawing, dragging or editing.
 */
export function SpaceWorkspace({ detail }: { detail: SpaceDetail }) {
  const router = useRouter();
  const { space, householdId } = detail;
  const [photoUrl, setPhotoUrl] = useState(detail.photoUrl);
  const [annotations, setAnnotations] = useState<AnnotationInput[]>(space.annotations);
  const [candidates, setCandidates] = useState<FurnitureCandidate[]>(detail.candidates);
  const [diagnosis, setDiagnosis] = useState<SpaceDiagnosisCache | null>(space.ai_diagnosis);
  const [roomType, setRoomType] = useState<RoomType>(space.room_type);
  const [style, setStyle] = useState<string | null>(space.style_preference);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const annotatorBusy = useRef(false);
  const onBusy = useCallback((b: boolean) => {
    annotatorBusy.current = b;
  }, []);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getSpaceSync(space.id);
      if (!alive || !res.ok) return;
      setCandidates((prev) => (JSON.stringify(prev) === JSON.stringify(res.candidates) ? prev : res.candidates));
      if (!annotatorBusy.current) setAnnotations((prev) => (JSON.stringify(prev) === JSON.stringify(res.annotations) ? prev : res.annotations));
      if (res.diagnosis) setDiagnosis((prev) => (prev?.analyzedAt === res.diagnosis?.analyzedAt ? prev : res.diagnosis));
    };
    const timer = setInterval(sync, SYNC_MS);
    const onVisible = () => void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [space.id]);

  const addedNames = useMemo(() => new Set(candidates.map((c) => c.name)), [candidates]);
  const addFromAi = async (rec: Recommendation): Promise<string | null> => {
    const res = await addCandidate(space.id, {
      name: rec.title,
      category: rec.category,
      widthCm: rec.recommendedSize.widthCm,
      depthCm: rec.recommendedSize.depthCm,
      heightCm: rec.recommendedSize.heightCm,
      memo: `AI 추천 · 예상 ${rec.estimatedPriceRange || "가격 미정"}`,
    });
    if (!res.ok) return res.error;
    setCandidates((prev) => [...prev, res.candidate]);
    return null;
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setDeleting(true);
    const res = await deleteSpace(space.id);
    if (!res.ok) {
      setDeleting(false);
      setConfirmDelete(false);
      return setDeleteError(res.error);
    }
    router.push("/spaces");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href="/spaces" className="inline-flex min-h-9 items-center gap-1 rounded-full text-sm font-bold text-slate-500 hover:text-sky-700 dark:text-zinc-400 dark:hover:text-sky-300">
          <ArrowLeft size={16} strokeWidth={2.5} aria-hidden /> 공간 목록
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h1 data-testid="space-title" className="break-words text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">{space.name}</h1>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{roomLabel(roomType)}</span>
              {style && <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{style}</span>}
            </div>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <ContextHelpButton topic="space_planner" />
            <button
              type="button"
              data-testid="space-delete"
              disabled={deleting}
              onClick={remove}
              onBlur={() => setConfirmDelete(false)}
              className={
                confirmDelete
                  ? "inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full bg-rose-600 px-3.5 text-xs font-bold text-white shadow-sm dark:bg-rose-500"
                  : "inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full bg-white px-3.5 text-xs font-bold text-rose-600 shadow-sm hover:bg-rose-50 dark:bg-zinc-800 dark:text-rose-300"
              }
            >
              {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />} {confirmDelete ? "삭제 확인" : "공간 삭제"}
            </button>
          </div>
        </div>
        {deleteError && <p role="alert" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{deleteError}</p>}
      </div>

      <SpaceDimensionAnnotator
        spaceId={space.id}
        householdId={householdId}
        photoUrl={photoUrl}
        annotations={annotations}
        onChange={setAnnotations}
        onPhotoChange={(url) => {
          setPhotoUrl(url);
          setDiagnosis(null); // the server dropped the diagnosis with the old photo
        }}
        onBusyChange={onBusy}
      />
      <SpaceAiCoordinator
        spaceId={space.id}
        hasPhoto={!!photoUrl}
        roomType={roomType}
        style={style}
        annotations={annotations}
        diagnosis={diagnosis}
        addedNames={addedNames}
        onMeta={(m) => {
          if (m.roomType) setRoomType(m.roomType);
          if (m.style !== undefined) setStyle(m.style);
        }}
        onDiagnosis={setDiagnosis}
        onAddToBoard={addFromAi}
      />
      <WishFurnitureBoard spaceId={space.id} annotations={annotations} candidates={candidates} onCandidates={setCandidates} />
    </div>
  );
}
