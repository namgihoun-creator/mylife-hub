"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, Image as ImageIcon, Loader2, PencilRuler, ScanLine, Trash2, Pencil, X } from "lucide-react";
import { saveAnnotations, setSpacePhoto } from "../server/space.actions";
import { PhotoError, uploadSpacePhoto } from "../utils/space-photo";
import { MAX_ANNOTATIONS } from "../schemas/space-constants";
import type { AnnotationInput } from "../schemas/space.schema";
import { AXIS_WORD, annotationAxis, composeLabel, type AxisChoice } from "@/shared/utils/space-planner";
import { cn } from "@/shared/lib/utils";
import { useWebXrArSupport } from "@/shared/hooks/useWebXrArSupport";
import { WebXrArMeasureModal, type ArMeasurement } from "./WebXrArMeasureModal";

type Point = { x: number; y: number };
type Line = { x1: number; y1: number; x2: number; y2: number };
type Form = { axis: AxisChoice; name: string; cm: string };

const AXES: { value: AxisChoice; label: string }[] = [
  { value: "width", label: "가로" },
  { value: "depth", label: "깊이" },
  { value: "height", label: "높이" },
  { value: "custom", label: "직접 입력" },
];
const MIN_LENGTH = 0.04; // a drag shorter than 4 % of the photo is a tap, not a line
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const cmText = (n: number) => `${Math.round(n * 10) / 10}`;
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Room photo + measured lines. Coordinates are stored as 0..1 fractions of the photo, so the lines stay on the same spot at any
 * screen size. Lines are drawn in an SVG overlay (non-scaling strokes); handles and the cm capsules are HTML positioned in %.
 */
export function SpaceDimensionAnnotator({
  spaceId,
  householdId,
  photoUrl,
  annotations,
  onChange,
  onPhotoChange,
  onBusyChange,
}: {
  spaceId: string;
  householdId: string;
  photoUrl: string | null;
  annotations: AnnotationInput[];
  onChange: (next: AnnotationInput[]) => void;
  onPhotoChange: (url: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const cmInput = useRef<HTMLInputElement>(null);

  const [draw, setDraw] = useState(false);
  const [draft, setDraft] = useState<Line | null>(null); // the line being dragged / awaiting its form
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<{ id: string; line: Line } | null>(null); // handle drag in progress
  const [form, setForm] = useState<Form>({ axis: "width", name: "", cm: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const arSupport = useWebXrArSupport();
  const [arOpen, setArOpen] = useState(false);

  // AR result -> a movable line on the photo plus the prefilled form; the user can drag it into place and save
  const applyAr = (m: ArMeasurement) => {
    if (annotations.length >= MAX_ANNOTATIONS) {
      setMessage(`치수는 ${MAX_ANNOTATIONS}개까지 넣을 수 있어요.`);
      return;
    }
    const y = 0.25 + 0.1 * (annotations.length % 6);
    setSelectedId(null);
    setDraft({ x1: 0.2, y1: y, x2: 0.8, y2: y });
    setDragging(false);
    setForm({ axis: m.axis, name: m.name, cm: cmText(m.lengthCm) });
    setMessage(null);
  };

  const editing = draft !== null && !dragging ? "new" : selectedId ? "existing" : null;
  useEffect(() => onBusyChange?.(dragging || live !== null || editing !== null || saving || uploading), [dragging, live, editing, saving, uploading, onBusyChange]);
  useEffect(() => {
    if (editing) cmInput.current?.focus({ preventScroll: false });
  }, [editing, selectedId]);

  const pointOf = (e: { clientX: number; clientY: number }): Point => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  // ---- persistence (optimistic; revert on failure)
  const persist = async (next: AnnotationInput[]) => {
    const prev = annotations;
    onChange(next);
    setSaving(true);
    const res = await saveAnnotations(spaceId, next);
    setSaving(false);
    if (!res.ok) {
      onChange(prev);
      setMessage(res.error);
      return false;
    }
    setMessage(null);
    return true;
  };

  // ---- drawing a new line
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draw || editing || (e.target as HTMLElement).closest("button")) return; // capsules/handles handle their own taps
    if (annotations.length >= MAX_ANNOTATIONS) {
      setMessage(`치수는 ${MAX_ANNOTATIONS}개까지 넣을 수 있어요.`);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointOf(e);
    setSelectedId(null);
    setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !draft) return;
    const p = pointOf(e);
    setDraft({ ...draft, x2: p.x, y2: p.y });
  };
  const onUp = () => {
    if (!dragging || !draft) return;
    setDragging(false);
    if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < MIN_LENGTH) {
      setDraft(null);
      return;
    }
    setForm({ axis: annotations.length === 0 ? "width" : annotations.some((a) => annotationAxis(a.label) === "width") ? "depth" : "width", name: "", cm: "" });
    setMessage(null);
  };

  // ---- dragging an end handle of an existing line
  const startHandle = (a: AnnotationInput, end: 1 | 2) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // no selection here: opening the form would scroll the page away from the finger mid-drag
    setDraft(null);
    setLive({ id: a.id, line: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 } });
    (e.currentTarget as HTMLElement).dataset.end = String(end);
  };
  const moveHandle = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!live) return;
    const end = e.currentTarget.dataset.end;
    const p = pointOf(e);
    setLive({ id: live.id, line: end === "1" ? { ...live.line, x1: p.x, y1: p.y } : { ...live.line, x2: p.x, y2: p.y } });
  };
  const endHandle = async () => {
    if (!live) return;
    const { id, line } = live;
    setLive(null);
    const cur = annotations.find((a) => a.id === id);
    if (!cur || (cur.x1 === line.x1 && cur.y1 === line.y1 && cur.x2 === line.x2 && cur.y2 === line.y2)) return;
    if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < MIN_LENGTH) return; // too short: keep the old line
    await persist(annotations.map((a) => (a.id === id ? { ...a, x1: r4(line.x1), y1: r4(line.y1), x2: r4(line.x2), y2: r4(line.y2) } : a)));
  };

  // ---- the inline form
  const select = (a: AnnotationInput) => {
    setDraft(null);
    setSelectedId(a.id);
    const axis = annotationAxis(a.label);
    setForm({ axis, name: a.label === AXIS_WORD[axis] ? "" : a.label, cm: cmText(a.lengthCm) });
    setMessage(null);
  };
  const closeForm = () => {
    setDraft(null);
    setSelectedId(null);
    setMessage(null);
  };
  const submit = async () => {
    const cm = Number(form.cm.replace(",", "."));
    if (!Number.isFinite(cm) || cm <= 0 || cm > 2000) return setMessage("길이(cm)를 1~2000 사이로 적어 주세요.");
    const label = composeLabel(form.axis, form.name);
    if (!label) return setMessage("이름을 적어 주세요. (예: 소파 벽면)");
    const length = Math.round(cm * 10) / 10;
    if (draft && !selectedId) {
      const line = { x1: r4(draft.x1), y1: r4(draft.y1), x2: r4(draft.x2), y2: r4(draft.y2) };
      if (await persist([...annotations, { id: newId(), ...line, label, lengthCm: length }])) closeForm();
    } else if (selectedId) {
      if (await persist(annotations.map((a) => (a.id === selectedId ? { ...a, label, lengthCm: length } : a)))) closeForm();
    }
  };
  const remove = async (id: string) => {
    if (await persist(annotations.filter((a) => a.id !== id))) {
      if (selectedId === id) closeForm();
    }
  };

  // ---- photo
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const path = await uploadSpacePhoto(householdId, spaceId, file);
      const res = await setSpacePhoto(spaceId, path);
      if (!res.ok) throw new PhotoError(res.error);
      onPhotoChange(res.photoUrl);
    } catch (e) {
      setMessage(e instanceof PhotoError ? e.message : "사진을 올리지 못했어요.");
    } finally {
      setUploading(false);
      if (camera.current) camera.current.value = "";
      if (gallery.current) gallery.current.value = "";
    }
  };

  const shown = annotations.map((a) => (live && live.id === a.id ? { ...a, ...live.line } : a));
  const pickers = (
    <>
      <input ref={camera} data-testid="photo-camera" type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={gallery} data-testid="photo-gallery" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </>
  );
  const pickBtn = "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-bold transition-all active:scale-95 disabled:opacity-60 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

  return (
    <section data-testid="annotator" aria-label="공간 사진과 실측 치수" className="space-y-3 rounded-3xl bg-white p-4 shadow-sm dark:bg-zinc-900 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
          <PencilRuler size={18} strokeWidth={2.5} className="text-sky-600 dark:text-sky-400" aria-hidden /> 실측 치수
        </h2>
        {photoUrl && (
          <div className="flex flex-wrap items-center gap-2">
            {arSupport === "supported" && (
              <button type="button" data-testid="ar-open" onClick={() => setArOpen(true)} className={cn(pickBtn, "bg-sky-600 text-white shadow-sm hover:bg-sky-500 dark:bg-sky-500")}>
                <ScanLine size={16} strokeWidth={2.5} aria-hidden /> AR 카메라로 재기 (Beta)
              </button>
            )}
            <button type="button" data-testid="draw-toggle" aria-pressed={draw} onClick={() => { setDraw((v) => !v); closeForm(); }} className={cn(pickBtn, draw ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700")}>
              <PencilRuler size={16} strokeWidth={2.5} aria-hidden /> {draw ? "선 긋는 중" : "선 긋기"}
            </button>
            <button type="button" data-testid="photo-replace" disabled={uploading} onClick={() => gallery.current?.click()} className={cn(pickBtn, "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700")}>
              {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ImageIcon size={16} strokeWidth={2.5} aria-hidden />} 사진 바꾸기
            </button>
          </div>
        )}
      </div>
      {pickers}
      {arOpen && <WebXrArMeasureModal onApply={applyAr} onClose={() => setArOpen(false)} />}

      {!photoUrl ? (
        <div data-testid="photo-empty" className="flex flex-col items-center gap-3 rounded-3xl bg-slate-50 px-4 py-10 text-center dark:bg-zinc-800/60">
          <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-sky-100 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300">
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
          </span>
          <p className="text-sm font-bold text-slate-800 dark:text-zinc-100">공간 사진을 올려 주세요</p>
          <p className="max-w-xs text-xs font-medium text-slate-500 dark:text-zinc-400">벽면과 바닥이 모두 보이게 정면에서 찍으면 치수를 재기 쉬워요. 사진은 우리 가족만 볼 수 있어요.</p>
          <div className="flex max-w-full flex-wrap justify-center gap-2">
            <button type="button" disabled={uploading} onClick={() => camera.current?.click()} className={cn(pickBtn, "bg-sky-600 text-white shadow-sm hover:bg-sky-500 dark:bg-sky-500")}>
              <Camera size={16} strokeWidth={2.5} aria-hidden /> 카메라로 찍기
            </button>
            <button type="button" disabled={uploading} onClick={() => gallery.current?.click()} className={cn(pickBtn, "bg-white text-slate-700 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-100")}>
              <ImageIcon size={16} strokeWidth={2.5} aria-hidden /> 갤러리에서 고르기
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
            {draw ? "사진 위에서 두 점을 드래그해 선을 그어 보세요. 끝점은 끌어서 옮길 수 있어요." : "‘선 긋기’를 켜면 벽·창문 같은 길이를 사진 위에 표시할 수 있어요."}
          </p>
          <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl bg-slate-100 dark:bg-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL of a private bucket */}
            <img data-testid="space-photo" src={photoUrl} alt="공간 사진" draggable={false} className="block h-auto max-h-[70vh] w-auto max-w-full select-none" />
            <div
              ref={overlay}
              data-testid="annotation-overlay"
              data-draw={draw}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className={cn("absolute inset-0", draw && !editing ? "cursor-crosshair touch-none" : "")}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                {shown.map((a) => (
                  <g key={a.id}>
                    <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="white" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9} />
                    <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.id === selectedId ? "#f59e0b" : "#0284c7"} strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
                {draft && (
                  <>
                    <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="white" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9} />
                    <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="#f59e0b" strokeWidth={3} strokeDasharray="8 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </>
                )}
              </svg>

              {shown.map((a) => (
                <div key={a.id} data-testid="annotation" data-id={a.id}>
                  {([1, 2] as const).map((end) => (
                    <button
                      key={end}
                      type="button"
                      aria-label={`${a.label} ${end === 1 ? "시작" : "끝"}점 옮기기`}
                      data-testid="annotation-handle"
                      onPointerDown={startHandle(a, end)}
                      onPointerMove={moveHandle}
                      onPointerUp={endHandle}
                      onPointerCancel={endHandle}
                      style={{ left: `${(end === 1 ? a.x1 : a.x2) * 100}%`, top: `${(end === 1 ? a.y1 : a.y2) * 100}%` }}
                      className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
                    >
                      <span className={cn("h-3.5 w-3.5 rounded-full border-2 border-white shadow", a.id === selectedId ? "bg-amber-500" : "bg-sky-600")} />
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="annotation-capsule"
                    onClick={() => select(a)}
                    style={{ left: `clamp(24%, ${((a.x1 + a.x2) / 2) * 100}%, 76%)`, top: `${((a.y1 + a.y2) / 2) * 100}%` }}
                    className={cn(
                      "absolute max-w-[62%] -translate-x-1/2 -translate-y-1/2 truncate rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums shadow-md",
                      a.id === selectedId ? "bg-amber-500 text-white" : "bg-sky-600 text-white dark:bg-sky-500",
                    )}
                  >
                    {a.label} {cmText(a.lengthCm)}cm
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {editing && (
        <form
          data-testid="annotation-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-zinc-800/60 sm:p-4"
        >
          <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-100">{editing === "new" ? "이 선의 실제 길이는요?" : "치수 수정"}</p>
          <div role="radiogroup" aria-label="축 구분" className="flex flex-wrap gap-1.5">
            {AXES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={form.axis === o.value}
                onClick={() => setForm((f) => ({ ...f, axis: o.value }))}
                className={cn("min-h-9 rounded-full px-3.5 text-xs font-bold transition-all active:scale-95", form.axis === o.value ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-[1fr_8rem]">
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">이름 {form.axis === "custom" ? "" : "(선택)"}</span>
              <input
                data-testid="annotation-name"
                value={form.name}
                maxLength={40}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예: 소파 벽면"
                className="flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">실제 길이 (cm)</span>
              <input
                ref={cmInput}
                data-testid="annotation-cm"
                inputMode="decimal"
                value={form.cm}
                onChange={(e) => setForm((f) => ({ ...f, cm: e.target.value }))}
                placeholder="240"
                className="flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-bold tabular-nums text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" data-testid="annotation-save" disabled={saving} className={cn(pickBtn, "bg-sky-600 text-white shadow-sm hover:bg-sky-500 dark:bg-sky-500")}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.5} aria-hidden />} 저장
            </button>
            <button type="button" onClick={closeForm} className={cn(pickBtn, "bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300")}>
              <X size={16} strokeWidth={2.5} aria-hidden /> 취소
            </button>
            {editing === "existing" && selectedId && (
              <button type="button" data-testid="annotation-delete" onClick={() => remove(selectedId)} className={cn(pickBtn, "ml-auto bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300")}>
                <Trash2 size={16} strokeWidth={2.5} aria-hidden /> 삭제
              </button>
            )}
          </div>
        </form>
      )}

      {message && (
        <p role="alert" data-testid="annotator-message" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {message}
        </p>
      )}

      {annotations.length > 0 && (
        <ul data-testid="annotation-list" className="space-y-1.5">
          {annotations.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 dark:bg-zinc-800/60">
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-zinc-100">{a.label}</span>
              <span className="shrink-0 text-sm font-extrabold tabular-nums text-sky-700 dark:text-sky-300">{cmText(a.lengthCm)}cm</span>
              <button type="button" aria-label={`${a.label} 수정`} onClick={() => select(a)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-700">
                <Pencil size={15} aria-hidden />
              </button>
              <button type="button" aria-label={`${a.label} 삭제`} onClick={() => remove(a.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
