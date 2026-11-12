"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RotateCcw, ScanLine, X } from "lucide-react";
import { calculate3dDistanceCm, type Vec3 } from "@/shared/utils/webxr-ar";
import { composeLabel, type AxisChoice } from "@/shared/utils/space-planner";
import { cn } from "@/shared/lib/utils";

/* Minimal WebXR typings: no 3D library and no @types/webxr, only what the hit-test loop touches. */
type XrPose = { transform: { position: Vec3 } };
type XrFrame = { getHitTestResults(src: unknown): { getPose(space: unknown): XrPose | null }[] };
type XrSession = {
  end(): Promise<void>;
  requestReferenceSpace(type: string): Promise<unknown>;
  requestHitTestSource(opts: { space: unknown }): Promise<{ cancel(): void }>;
  requestAnimationFrame(cb: (t: number, f: XrFrame) => void): number;
  cancelAnimationFrame(id: number): void;
  updateRenderState(s: { baseLayer: unknown }): void;
  addEventListener(type: "end", cb: () => void): void;
};
type XrSystem = { requestSession(mode: string, init: Record<string, unknown>): Promise<XrSession> };

export type ArMeasurement = { axis: AxisChoice; name: string; lengthCm: number };
type Phase = "intro" | "starting" | "searching" | "ready" | "measuring" | "done";

const AXES: { value: AxisChoice; label: string }[] = [
  { value: "width", label: "가로" },
  { value: "depth", label: "깊이" },
  { value: "height", label: "높이" },
  { value: "custom", label: "직접 입력" },
];
const glass = "rounded-3xl bg-white/80 p-4 shadow-lg backdrop-blur-md dark:bg-zinc-900/80";
const btn = "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

/**
 * Android Chrome AR ruler: a WebXR `immersive-ar` session with `hit-test` (the viewer-centre ray finds the floor / wall) and a
 * `dom-overlay` for the UI. No 3D library: a throw-away WebGL context only feeds the session its required base layer; the aiming ring
 * is plain DOM. Everything (session, rAF, hit-test source, GL context) is released on close, unmount or when the OS ends the session.
 */
export function WebXrArMeasureModal({ onApply, onClose }: { onApply: (m: ArMeasurement) => void; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<XrSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const sourceRef = useRef<{ cancel(): void } | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const hitRef = useRef<Vec3 | null>(null); // latest aiming point (metres), null while no surface
  const startRef = useRef<Vec3 | null>(null);
  const phaseRef = useRef<Phase>("intro");
  const closedRef = useRef(false);

  const [phase, setPhaseState] = useState<Phase>("intro");
  const [liveCm, setLiveCm] = useState<number | null>(null);
  const [finalCm, setFinalCm] = useState<number | null>(null);
  const [axis, setAxis] = useState<AxisChoice>("width");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const release = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (rafRef.current !== null && s) {
      try {
        s.cancelAnimationFrame(rafRef.current);
      } catch {
        /* session already gone */
      }
    }
    rafRef.current = null;
    try {
      sourceRef.current?.cancel();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;
    glRef.current?.getExtension("WEBGL_lose_context")?.loseContext();
    glRef.current = null;
    if (s) void s.end().catch(() => undefined);
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    release();
    onClose();
  }, [release, onClose]);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      release();
    };
  }, [release]);

  const start = async () => {
    setError(null);
    setPhase("starting");
    try {
      const xr = (navigator as unknown as { xr?: XrSystem }).xr;
      if (!xr || !overlayRef.current) throw new Error("no-xr");
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl", { xrCompatible: true }) as (WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> }) | null;
      if (!gl) throw new Error("no-webgl");
      glRef.current = gl;
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      const session = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: overlayRef.current },
      });
      sessionRef.current = session;
      session.addEventListener("end", () => {
        sessionRef.current = null; // the OS/user ended it: just tidy up and close
        close();
      });
      const Layer = (window as unknown as { XRWebGLLayer: new (s: XrSession, g: WebGLRenderingContext) => unknown }).XRWebGLLayer;
      session.updateRenderState({ baseLayer: new Layer(session, gl) });
      const viewer = await session.requestReferenceSpace("viewer");
      const local = await session.requestReferenceSpace("local");
      sourceRef.current = await session.requestHitTestSource({ space: viewer });
      setPhase("searching");

      const frame = (_t: number, f: XrFrame) => {
        if (sessionRef.current !== session) return;
        rafRef.current = session.requestAnimationFrame(frame);
        const hit = sourceRef.current ? f.getHitTestResults(sourceRef.current)[0] : undefined;
        const pos = hit?.getPose(local)?.transform.position;
        hitRef.current = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
        const p = phaseRef.current;
        if (p === "searching" && hitRef.current) setPhase("ready");
        else if (p === "ready" && !hitRef.current) setPhase("searching");
        else if (p === "measuring") {
          const cm = hitRef.current && startRef.current ? calculate3dDistanceCm(startRef.current, hitRef.current) : null;
          setLiveCm((prev) => (prev === cm ? prev : cm));
        }
      };
      rafRef.current = session.requestAnimationFrame(frame);
    } catch {
      release();
      setPhase("intro");
      setError("이 기기에서는 AR 실측을 시작하지 못했어요. 사진 위에 선을 그어 직접 입력해 주세요.");
    }
  };

  const placeStart = () => {
    if (!hitRef.current) return;
    startRef.current = { ...hitRef.current };
    setLiveCm(0);
    setPhase("measuring");
  };
  const placeEnd = () => {
    if (!hitRef.current || !startRef.current) return;
    const cm = calculate3dDistanceCm(startRef.current, hitRef.current);
    if (cm < 1) return;
    setFinalCm(cm);
    setPhase("done");
  };
  const retry = () => {
    startRef.current = null;
    setLiveCm(null);
    setFinalCm(null);
    setPhase(hitRef.current ? "ready" : "searching");
  };

  const label = composeLabel(axis, name);
  const apply = () => {
    if (finalCm === null || !label) return;
    onApply({ axis, name: name.trim(), lengthCm: finalCm });
    close();
  };

  const inSession = phase !== "intro" && phase !== "starting";
  const aimed = phase === "ready" || phase === "measuring";

  return (
    <div
      ref={overlayRef}
      data-testid="ar-modal"
      role="dialog"
      aria-modal="true"
      aria-label="AR 카메라 실측"
      className={cn("fixed inset-0 z-[70] flex flex-col justify-between overflow-y-auto p-4", inSession ? "bg-transparent" : "bg-slate-900/60 backdrop-blur-sm")}
    >
      <div className="flex justify-end">
        <button type="button" data-testid="ar-close" aria-label="AR 실측 닫기" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/80 text-slate-700 shadow-md backdrop-blur-md dark:bg-zinc-900/80 dark:text-zinc-100">
          <X size={20} aria-hidden />
        </button>
      </div>

      {inSession && (
        <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-4">
          <span
            data-testid="ar-reticle"
            data-aimed={aimed}
            className={cn("h-16 w-16 rounded-full border-4 transition-colors", aimed ? "border-teal-400 bg-teal-400/20" : "border-white/70 border-dashed")}
            aria-hidden
          />
          {phase === "measuring" && (
            <p data-testid="ar-live" className="rounded-3xl bg-white/80 px-5 py-2 text-4xl font-extrabold tabular-nums text-sky-700 shadow-lg backdrop-blur-md dark:bg-zinc-900/80 dark:text-sky-300">
              {liveCm === null ? "— cm" : `${liveCm} cm`}
            </p>
          )}
        </div>
      )}

      <div className="mx-auto w-full max-w-md space-y-2">
        {phase === "intro" && (
          <div className={cn(glass, "space-y-3")}>
            <p className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-zinc-50">
              <ScanLine size={18} className="text-sky-600 dark:text-sky-400" aria-hidden /> AR 카메라로 재기 (Beta)
            </p>
            <p className="text-xs font-medium text-slate-600 dark:text-zinc-300">카메라로 바닥이나 벽면을 비추고, 시작점과 끝점을 차례로 찍으면 길이가 cm로 나와요.</p>
            {error && <p role="alert" data-testid="ar-error" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            <button type="button" data-testid="ar-start" onClick={start} className={cn(btn, "w-full bg-sky-600 text-white shadow-sm hover:bg-sky-500 dark:bg-sky-500")}>
              <Camera size={16} strokeWidth={2.5} aria-hidden /> 카메라 켜고 재기
            </button>
          </div>
        )}
        {phase === "starting" && (
          <div className={cn(glass, "flex items-center justify-center gap-2 text-sm font-bold text-slate-700 dark:text-zinc-200")}>
            <Loader2 size={16} className="animate-spin" aria-hidden /> AR 카메라를 준비하고 있어요…
          </div>
        )}
        {phase === "searching" && (
          <p data-testid="ar-hint" className={cn(glass, "text-center text-sm font-bold text-slate-800 dark:text-zinc-100")}>바닥이나 벽면을 천천히 비춰 표면을 인식시켜 주세요</p>
        )}
        {phase === "ready" && (
          <div className={cn(glass, "space-y-2")}>
            <p className="text-center text-xs font-bold text-slate-600 dark:text-zinc-300">재고 싶은 곳의 한쪽 끝에 링을 맞추세요</p>
            <button type="button" data-testid="ar-place-start" onClick={placeStart} className={cn(btn, "w-full bg-sky-600 text-white shadow-sm dark:bg-sky-500")}>점 찍기</button>
          </div>
        )}
        {phase === "measuring" && (
          <div className={cn(glass, "space-y-2")}>
            <p className="text-center text-xs font-bold text-slate-600 dark:text-zinc-300">반대쪽 끝으로 천천히 이동하세요</p>
            <div className="flex gap-2">
              <button type="button" onClick={retry} className={cn(btn, "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200")}>
                <RotateCcw size={16} aria-hidden /> 취소
              </button>
              <button type="button" data-testid="ar-place-end" disabled={liveCm === null || liveCm < 1} onClick={placeEnd} className={cn(btn, "flex-1 bg-sky-600 text-white shadow-sm disabled:opacity-60 dark:bg-sky-500")}>끝점 찍기</button>
            </div>
          </div>
        )}
        {phase === "done" && finalCm !== null && (
          <div className={cn(glass, "space-y-3")}>
            <p className="text-center text-xs font-bold text-slate-600 dark:text-zinc-300">측정 결과</p>
            <p data-testid="ar-result" className="text-center text-4xl font-extrabold tabular-nums text-sky-700 dark:text-sky-300">{finalCm} cm</p>
            <div role="radiogroup" aria-label="축 구분" className="flex flex-wrap justify-center gap-1.5">
              {AXES.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={axis === o.value} onClick={() => setAxis(o.value)} className={cn("min-h-9 rounded-full px-3.5 text-xs font-bold transition-all active:scale-95", axis === o.value ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-white text-slate-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300")}>
                  {o.label}
                </button>
              ))}
            </div>
            {axis === "custom" && (
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 창문 폭)" aria-label="치수 이름" className="flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-50" />
            )}
            <div className="flex gap-2">
              <button type="button" data-testid="ar-retry" onClick={retry} className={cn(btn, "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200")}>
                <RotateCcw size={16} aria-hidden /> 다시 재기
              </button>
              <button type="button" data-testid="ar-apply" disabled={!label} onClick={apply} className={cn(btn, "flex-1 bg-sky-600 text-white shadow-sm disabled:opacity-60 dark:bg-sky-500")}>
                <Check size={16} strokeWidth={2.5} aria-hidden /> 이 치수 적용하기
              </button>
            </div>
          </div>
        )}
        <p data-testid="ar-disclaimer" className="text-center text-[11px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">조명이나 흰 벽 상태에 따라 2~5cm 오차가 있을 수 있어요</p>
      </div>
    </div>
  );
}
