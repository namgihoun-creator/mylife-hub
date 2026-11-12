"use client";

import { useState } from "react";
import { ExternalLink, Heart, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { FitBadge } from "./FitBadge";
import { ShoppingButtons } from "./ShoppingButtons";
import { addCandidate, deleteCandidate, setCandidateStatus, updateCandidate } from "../server/space.actions";
import { CANDIDATE_STATUSES, STATUS_LABEL, type CandidateStatus } from "../schemas/space-constants";
import type { FurnitureCandidate } from "../schemas/space-board.schema";
import type { AnnotationInput } from "../schemas/space.schema";
import { evaluateFurnitureFit } from "@/shared/utils/space-planner";
import { cn } from "@/shared/lib/utils";

type Draft = { name: string; category: string; w: string; d: string; h: string; price: string; url: string; memo: string };
const EMPTY: Draft = { name: "", category: "", w: "", d: "", h: "", price: "", url: "", memo: "" };
const fromCandidate = (c: FurnitureCandidate): Draft => ({
  name: c.name, category: c.category ?? "", w: c.width_cm?.toString() ?? "", d: c.depth_cm?.toString() ?? "", h: c.height_cm?.toString() ?? "",
  price: c.price?.toString() ?? "", url: c.product_url ?? "", memo: c.memo ?? "",
});
const numOrNull = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const sizeText = (c: Pick<FurnitureCandidate, "width_cm" | "depth_cm" | "height_cm">) =>
  c.width_cm || c.depth_cm || c.height_cm ? `${c.width_cm ?? "?"}×${c.depth_cm ?? "?"}×${c.height_cm ?? "?"}cm` : null;

const STATUS_STYLE: Record<CandidateStatus, string> = {
  CANDIDATE: "bg-slate-700 text-white dark:bg-zinc-200 dark:text-zinc-900",
  SELECTED: "bg-sky-600 text-white dark:bg-sky-500",
  PURCHASED: "bg-teal-600 text-white dark:bg-teal-500",
};

const field = "flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-900 dark:text-zinc-50";

/** The couple's shared wish list for this space: manual entry + AI picks, live fit verdicts against the measured lines, and a 3-step status. */
export function WishFurnitureBoard({
  spaceId,
  annotations,
  candidates,
  onCandidates,
}: {
  spaceId: string;
  annotations: AnnotationInput[];
  candidates: FurnitureCandidate[];
  onCandidates: (next: FurnitureCandidate[] | ((prev: FurnitureCandidate[]) => FurnitureCandidate[])) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const livePreview = evaluateFurnitureFit(annotations, { widthCm: numOrNull(draft.w) || null, depthCm: numOrNull(draft.d) || null, heightCm: numOrNull(draft.h) || null });

  const openNew = () => {
    setEditId(null);
    setDraft(EMPTY);
    setError(null);
    setOpen(true);
  };
  const openEdit = (c: FurnitureCandidate) => {
    setEditId(c.id);
    setDraft(fromCandidate(c));
    setError(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setEditId(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = numOrNull(draft.w), d = numOrNull(draft.d), h = numOrNull(draft.h), price = numOrNull(draft.price);
    if ([w, d, h, price].some((n) => Number.isNaN(n))) return setError("크기와 가격은 숫자로 적어 주세요.");
    if (price !== null && !Number.isInteger(price)) return setError("가격은 원 단위 정수로 적어 주세요.");
    const input = { name: draft.name, category: draft.category, widthCm: w, depthCm: d, heightCm: h, price, productUrl: draft.url, memo: draft.memo };
    setSaving(true);
    setError(null);
    const res = editId ? await updateCandidate(editId, input) : await addCandidate(spaceId, input);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onCandidates((prev) => (editId ? prev.map((c) => (c.id === editId ? res.candidate : c)) : [...prev, res.candidate]));
    close();
  };

  const changeStatus = async (c: FurnitureCandidate, status: CandidateStatus) => {
    if (c.status === status) return;
    onCandidates((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)));
    const res = await setCandidateStatus(c.id, status);
    if (!res.ok) {
      onCandidates((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: c.status } : x)));
      setError(res.error);
    }
  };
  const remove = async (c: FurnitureCandidate) => {
    if (confirmDel !== c.id) return setConfirmDel(c.id);
    setConfirmDel(null);
    const res = await deleteCandidate(c.id);
    if (!res.ok) return setError(res.error);
    onCandidates((prev) => prev.filter((x) => x.id !== c.id));
  };

  return (
    <section data-testid="wish-board" aria-label="위시 가구 보드" className="space-y-4 rounded-3xl bg-white p-4 shadow-sm dark:bg-zinc-900 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
          <Heart size={18} strokeWidth={2.5} className="text-rose-500 dark:text-rose-300" aria-hidden /> 부부 위시 가구
          <span data-testid="wish-count" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold tabular-nums text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">{candidates.length}</span>
        </h2>
        {!open && (
          <button type="button" data-testid="wish-add-open" onClick={openNew} className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
            <Plus size={16} strokeWidth={2.5} aria-hidden /> 직접 추가
          </button>
        )}
      </div>

      {open && (
        <form data-testid="wish-form" onSubmit={submit} className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-zinc-800/60 sm:p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-100">{editId ? "가구 수정" : "위시 가구 추가"}</p>
            <button type="button" aria-label="닫기" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-700">
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">가구 이름</span>
              <input data-testid="wish-name" required maxLength={100} value={draft.name} onChange={set("name")} placeholder="예: 아이보리 3인 소파" className={field} />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">카테고리</span>
              <input data-testid="wish-category" maxLength={30} value={draft.category} onChange={set("category")} placeholder="예: 소파" className={field} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([["w", "가로 cm", "wish-w"], ["d", "깊이 cm", "wish-d"], ["h", "높이 cm", "wish-h"]] as const).map(([k, label, tid]) => (
              <label key={k} className="block min-w-0 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">{label}</span>
                <input data-testid={tid} inputMode="decimal" value={draft[k]} onChange={set(k)} placeholder="0" className={cn(field, "px-3 tabular-nums")} />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">가격 (원)</span>
              <input data-testid="wish-price" inputMode="numeric" value={draft.price} onChange={set("price")} placeholder="650000" className={cn(field, "tabular-nums")} />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">상품 링크</span>
              <input data-testid="wish-url" type="url" inputMode="url" maxLength={2000} value={draft.url} onChange={set("url")} placeholder="https://…" className={field} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">부부 공유 메모</span>
            <input data-testid="wish-memo" maxLength={300} value={draft.memo} onChange={set("memo")} placeholder="예: 색상은 아이보리로, 배송 2주" className={field} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">현재 공간 기준</span>
            <FitBadge fit={livePreview} />
          </div>
          {error && <p role="alert" data-testid="wish-error" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" data-testid="wish-save" disabled={saving} className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-sky-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-sky-500 active:scale-95 disabled:opacity-60 dark:bg-sky-500">
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden />} {editId ? "저장" : "위시 보드에 추가"}
            </button>
            <button type="button" onClick={close} className="inline-flex min-h-11 items-center rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300">취소</button>
          </div>
        </form>
      )}
      {!open && error && <p role="alert" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

      {candidates.length === 0 ? (
        <p data-testid="wish-empty" className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          아직 담은 가구가 없어요. AI 추천에서 담거나 ‘직접 추가’로 마음에 드는 가구를 모아 보세요.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {candidates.map((c) => {
            const fit = evaluateFurnitureFit(annotations, { widthCm: c.width_cm, depthCm: c.depth_cm, heightCm: c.height_cm });
            const size = sizeText(c);
            return (
              <li key={c.id} data-testid="wish-card" data-status={c.status} className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-32">
                    <h3 className="break-words text-base font-extrabold leading-snug text-slate-900 dark:text-zinc-50">{c.name}</h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
                      {[c.category, size, c.price !== null ? won(c.price) : null].filter(Boolean).join(" · ") || "상세 정보 없음"}
                    </p>
                  </div>
                  <FitBadge fit={fit} />
                </div>
                {c.memo && <p className="break-words rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-600 dark:bg-zinc-900 dark:text-zinc-300">{c.memo}</p>}

                <div role="radiogroup" aria-label="진행 상태" className="flex flex-wrap gap-1.5">
                  {CANDIDATE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={c.status === s}
                      data-status-btn={s}
                      onClick={() => changeStatus(c, s)}
                      className={cn("min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-bold transition-all active:scale-95 motion-reduce:transform-none", c.status === s ? `${STATUS_STYLE[s]} shadow-sm` : "bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300")}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {c.product_url ? (
                    <a href={c.product_url} target="_blank" rel="noopener noreferrer" data-testid="wish-link" className="inline-flex min-h-9 items-center gap-1 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300">
                      상품 보기 <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
                    </a>
                  ) : (
                    <ShoppingButtons keyword={[c.category, c.name].filter(Boolean).join(" ")} />
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <button type="button" aria-label={`${c.name} 수정`} onClick={() => openEdit(c)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-700">
                      <Pencil size={15} aria-hidden />
                    </button>
                    <button type="button" data-testid="wish-delete" aria-label={`${c.name} 삭제`} onClick={() => remove(c)} className={cn("flex h-9 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40", confirmDel === c.id ? "bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-500 dark:bg-rose-500 dark:text-white" : "w-9")}>
                      {confirmDel === c.id ? "삭제 확인" : <Trash2 size={15} aria-hidden />}
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
