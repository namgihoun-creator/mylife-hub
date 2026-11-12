"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  CalendarClock, Camera, CheckCircle2, ChefHat, CircleDollarSign, Lock, Mic, PawPrint, Plus, Receipt, Refrigerator, Ruler, ShieldCheck, Sofa, Sparkles, Timer, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { GRADIENT_CTA } from "@/shared/components/ui/gradient-cta";
import type { HelpEntry, HelpIconKey } from "@/shared/constants/help-content";
import { cn } from "@/shared/lib/utils";

const ICONS: Record<HelpIconKey, LucideIcon> = {
  plus: Plus, calendar: CalendarClock, check: CheckCircle2, camera: Camera, fridge: Refrigerator, wallet: Wallet, ring: CircleDollarSign, receipt: Receipt,
  chef: ChefHat, paw: PawPrint, sparkles: Sparkles, users: Users, lock: Lock, mic: Mic, timer: Timer, shield: ShieldCheck, ruler: Ruler, sofa: Sofa,
};

const SWIPE_PX = 40;

/** 좌우로 넘기는 3단계 사용 가이드. 버튼 · 키보드 ←/→ · 터치 스와이프로 이동한다. */
export function SlideTutorialModal({ open, onOpenChange, entry }: { open: boolean; onOpenChange: (o: boolean) => void; entry: HelpEntry }) {
  const [idx, setIdx] = useState(0);
  const startX = useRef<number | null>(null);
  const total = entry.steps.length;
  const last = idx === total - 1;

  useEffect(() => {
    if (open) setIdx(0); // 열 때마다 1단계부터
  }, [open]);

  const go = (n: number) => setIdx(Math.min(total - 1, Math.max(0, n)));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(idx + 1);
    else if (e.key === "ArrowLeft") go(idx - 1);
  };
  const onDown = (e: PointerEvent) => { startX.current = e.clientX; };
  const onUp = (e: PointerEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(idx + (dx < 0 ? 1 : -1));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="help-dialog"
        onKeyDown={onKey}
        className="w-[calc(100%-2rem)] max-w-sm gap-4 overflow-hidden rounded-3xl bg-slate-50 p-5 dark:bg-zinc-900"
      >
        <DialogHeader className="space-y-2 pr-6 text-left">
          <div className="flex items-center gap-2">
            <span data-testid="help-counter" className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
              Step {idx + 1} / {total}
            </span>
            <div className="flex flex-1 gap-1" role="presentation">
              {entry.steps.map((s, i) => (
                <span key={s.step} data-testid="help-progress" data-active={i <= idx} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i <= idx ? "bg-gradient-to-r from-sky-500 to-teal-400" : "bg-slate-200 dark:bg-zinc-700")} />
              ))}
            </div>
          </div>
          <DialogTitle className="text-sm font-bold text-slate-500 dark:text-zinc-400">{entry.title}</DialogTitle>
          <DialogDescription className="sr-only">좌우로 넘기거나 이전·다음 버튼으로 3단계 사용 방법을 확인해요.</DialogDescription>
        </DialogHeader>

        {/* 슬라이드 트랙: 가로로 이어 붙이고 translateX로 이동. touch-pan-y = 세로 스크롤은 살리고 가로 제스처만 가져온다 */}
        <div className="touch-pan-y overflow-hidden" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { startX.current = null; }}>
          <div className="flex transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${idx * 100}%)` }}>
            {entry.steps.map((s, i) => {
              const Icon = ICONS[s.icon];
              return (
                <div key={s.step} data-testid="help-slide" aria-hidden={i !== idx} inert={i !== idx} className="w-full shrink-0 space-y-3.5">
                  <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-teal-100 dark:from-sky-950/60 dark:via-zinc-900 dark:to-teal-950/50">
                    <span aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/60 dark:bg-white/5" />
                    <span aria-hidden className="absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-teal-200/50 dark:bg-teal-400/10" />
                    <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-md dark:bg-zinc-800 dark:text-sky-300">
                      <Icon className="h-8 w-8" strokeWidth={2.2} aria-hidden />
                    </span>
                    <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-teal-700 shadow-sm dark:bg-zinc-800/90 dark:text-teal-300">{s.badge}</span>
                  </div>
                  <h3 className="text-base font-extrabold leading-snug text-slate-900 dark:text-zinc-50">{s.title}</h3>
                  <p className="min-h-[3.75rem] text-sm font-medium leading-relaxed text-slate-600 dark:text-zinc-300">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="help-prev"
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-white px-4 text-sm font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-100 disabled:invisible dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            이전
          </button>
          {last ? (
            <button type="button" data-testid="help-done" onClick={() => onOpenChange(false)} className={cn(GRADIENT_CTA, "flex-[1.6]")}>
              직접 해보기 🚀
            </button>
          ) : (
            <button
              type="button"
              data-testid="help-next"
              onClick={() => go(idx + 1)}
              className="inline-flex min-h-11 flex-[1.6] items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-bold text-white transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              다음
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
