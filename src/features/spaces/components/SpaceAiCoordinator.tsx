"use client";

import { useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { FitBadge, FitBasis } from "./FitBadge";
import { evaluateFurnitureFit } from "@/shared/utils/space-planner";
import { ShoppingButtons } from "./ShoppingButtons";
import { updateSpaceMeta } from "../server/space.actions";
import { ROOM_OPTIONS, STYLE_OPTIONS, type RoomType } from "../schemas/space-constants";
import type { SpaceDiagnosisCache } from "../schemas/space-board.schema";
import type { AnnotationInput } from "../schemas/space.schema";
import type { Recommendation } from "../server/gemini-space";
import { GRADIENT_CTA } from "@/shared/components/ui/gradient-cta";
import { cn } from "@/shared/lib/utils";

const pill = (on: boolean) =>
  cn(
    "min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition-all active:scale-95 motion-reduce:transform-none",
    on ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
  );

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null;

/** Room purpose + style -> "AI 가구 추천받기". A saved diagnosis shows at once; every recommendation links to the four malls and can go to the wish board. */
export function SpaceAiCoordinator({
  spaceId,
  hasPhoto,
  roomType,
  style,
  annotations,
  diagnosis,
  addedNames,
  onMeta,
  onDiagnosis,
  onAddToBoard,
}: {
  spaceId: string;
  hasPhoto: boolean;
  roomType: RoomType;
  style: string | null;
  annotations: AnnotationInput[];
  diagnosis: SpaceDiagnosisCache | null;
  addedNames: ReadonlySet<string>;
  onMeta: (m: { roomType?: RoomType; style?: string | null }) => void;
  onDiagnosis: (d: SpaceDiagnosisCache) => void;
  onAddToBoard: (rec: Recommendation) => Promise<string | null>; // returns an error message, or null when added
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const setRoom = (r: RoomType) => {
    onMeta({ roomType: r });
    void updateSpaceMeta(spaceId, { roomType: r });
  };
  const setStyle = (s: string | null) => {
    onMeta({ style: s });
    void updateSpaceMeta(spaceId, { style: s });
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/spaces/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, roomType, style: style ?? undefined, annotations }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; diagnosis?: SpaceDiagnosisCache } | null;
      if (!res.ok || !json?.ok || !json.diagnosis) {
        setError(json?.message ?? "분석하지 못했어요. 잠시 뒤에 다시 해 보세요.");
        return;
      }
      onDiagnosis({ ...json.diagnosis, analyzedAt: new Date().toISOString() });
    } catch {
      setError("서버에 연결하지 못했어요. 잠시 뒤에 다시 해 보세요.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (rec: Recommendation) => {
    setAdding(rec.title);
    setAddError(null);
    const err = await onAddToBoard(rec);
    setAdding(null);
    if (err) setAddError(err);
  };

  const stamp = when(diagnosis?.analyzedAt);

  return (
    <section data-testid="ai-coordinator" aria-label="AI 공간 코디네이터" className="space-y-4 rounded-3xl bg-white p-4 shadow-sm dark:bg-zinc-900 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
        <Sparkles size={18} strokeWidth={2.5} className="text-teal-600 dark:text-teal-300" aria-hidden /> AI 공간 코디네이터
      </h2>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">공간 용도</p>
          <div role="radiogroup" aria-label="공간 용도" className="flex flex-wrap gap-1.5">
            {ROOM_OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={roomType === o.value} data-testid={`room-${o.value}`} onClick={() => setRoom(o.value)} className={pill(roomType === o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">선호 스타일</p>
          <div role="radiogroup" aria-label="선호 스타일" className="flex flex-wrap gap-1.5">
            {STYLE_OPTIONS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(style === s ? null : s)} className={pill(style === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="ai-run" disabled={busy || !hasPhoto} onClick={analyze} className={cn(GRADIENT_CTA, "disabled:cursor-not-allowed disabled:opacity-60")}>
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : diagnosis ? <RefreshCw size={18} strokeWidth={2.5} aria-hidden /> : <Sparkles size={18} strokeWidth={2.5} aria-hidden />}
            {busy ? "분석하는 중…" : diagnosis ? "다시 분석하기" : "AI 가구 추천받기"}
          </button>
          {stamp && !busy && <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">마지막 분석 {stamp}</span>}
        </div>
        {!hasPhoto && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">공간 사진을 먼저 올리면 AI가 분석할 수 있어요.</p>}
        {error && (
          <p role="alert" data-testid="ai-error" className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </p>
        )}
      </div>

      {diagnosis && (
        <div data-testid="ai-result" className="space-y-3">
          <div data-testid="ai-summary" className="rounded-2xl bg-gradient-to-br from-sky-50 to-teal-50 p-4 dark:from-sky-950/30 dark:to-teal-950/30">
            <p className="text-xs font-extrabold text-sky-700 dark:text-sky-300">공간 진단</p>
            <p className="mt-1 text-sm font-medium leading-relaxed text-slate-800 dark:text-zinc-100">{diagnosis.spaceSummary || "공간 요약을 만들지 못했어요."}</p>
          </div>

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {diagnosis.recommendations.map((r) => {
              const added = addedNames.has(r.title);
              const size = r.recommendedSize;
              return (
                <li key={r.title} data-testid="ai-rec" className="flex min-w-0 flex-col gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-extrabold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">{r.category}</span>
                    <FitBadge fit={r.fit} />
                  </div>
                  <FitBasis basis={evaluateFurnitureFit(annotations, r.recommendedSize).basisLabel} className="-mt-1.5" />
                  <h3 className="text-base font-extrabold leading-snug text-slate-900 dark:text-zinc-50">{r.title}</h3>
                  <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-zinc-300">{r.reason}</p>
                  <dl className="grid grid-cols-1 gap-1.5 text-sm min-[360px]:grid-cols-2">
                    <div className="rounded-xl bg-white px-3 py-2 dark:bg-zinc-900">
                      <dt className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">권장 사이즈</dt>
                      <dd data-testid="rec-size" className="font-extrabold tabular-nums text-slate-900 dark:text-zinc-50">
                        {size.widthCm}×{size.depthCm}×{size.heightCm}cm
                      </dd>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 dark:bg-zinc-900">
                      <dt className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">예상 가격대</dt>
                      <dd className="font-extrabold text-slate-900 dark:text-zinc-50">{r.estimatedPriceRange || "-"}</dd>
                    </div>
                  </dl>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                    검색어 <span className="font-bold text-slate-700 dark:text-zinc-200">{r.searchKeywords}</span>
                  </p>
                  <ShoppingButtons keyword={r.searchKeywords} />
                  <button
                    type="button"
                    data-testid="rec-add"
                    disabled={added || adding === r.title}
                    onClick={() => add(r)}
                    className={cn(
                      "mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-bold transition-all active:scale-95 disabled:cursor-default motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400",
                      added ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300" : "bg-teal-600 text-white shadow-sm hover:bg-teal-500 dark:bg-teal-500",
                    )}
                  >
                    {adding === r.title ? <Loader2 size={16} className="animate-spin" aria-hidden /> : added ? <Check size={16} strokeWidth={2.5} aria-hidden /> : <Plus size={16} strokeWidth={2.5} aria-hidden />}
                    {added ? "위시 보드에 담았어요" : "위시 보드에 담기"}
                  </button>
                </li>
              );
            })}
          </ul>
          {addError && (
            <p role="alert" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {addError}
            </p>
          )}
          <p className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">AI 추천은 참고용이에요. 구매 전에 상품 페이지의 실제 치수를 꼭 확인해 주세요.</p>
        </div>
      )}
    </section>
  );
}
