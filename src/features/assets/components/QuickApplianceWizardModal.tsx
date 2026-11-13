"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { GRADIENT_CTA } from "@/shared/components/ui/gradient-cta";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";
import { cn } from "@/shared/lib/utils";
import { QUICK_APPLIANCES } from "../constants/quick-appliances";
import { addQuickAppliances } from "../server/asset.actions";

export const OPEN_QUICK_WIZARD_EVENT = "mylife:open-quick-wizard";

type Own = "OWNED" | "RENTAL";

/**
 * "기본 가전 1분 세팅": tick the standard appliances, flip each between 자가/렌탈, register all of them (plus their basic care task)
 * in one go. One instance lives in the /assets header; the empty-state CTA opens it through an event. Already registered
 * appliances (same preset_key) are shown as done and cannot be picked twice.
 */
export function QuickApplianceWizardModal({ registeredKeys }: { registeredKeys: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, Own>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_QUICK_WIZARD_EVENT, openIt);
    return () => window.removeEventListener(OPEN_QUICK_WIZARD_EVENT, openIt);
  }, []);

  const done = new Set(registeredKeys);
  const count = Object.keys(picked).length;
  const toggle = (key: string) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[key]) delete n[key];
      else n[key] = "OWNED";
      return n;
    });
  const setOwn = (key: string, o: Own) => setPicked((p) => ({ ...p, [key]: o }));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await addQuickAppliances({ items: Object.entries(picked).map(([key, ownership]) => ({ key, ownership })) });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      setPicked({});
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        data-testid="quick-wizard-open"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-50 px-4 text-sm font-bold text-sky-700 shadow-sm transition-all hover:bg-sky-100 active:scale-95 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60"
      >
        <Zap size={16} strokeWidth={2.5} aria-hidden /> 기본 가전 1분 세팅
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent data-testid="quick-wizard" className="flex max-h-[90vh] max-w-lg flex-col gap-3 rounded-3xl border-0 bg-slate-50 p-4 shadow-xl dark:bg-zinc-900 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold tracking-tight">우리 집 기본 가전 1분 세팅</DialogTitle>
            <DialogDescription>있는 가전만 골라 주세요. 기본 청소·소모품 주기까지 한 번에 등록돼요.</DialogDescription>
          </DialogHeader>
          <ul className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto min-[420px]:grid-cols-2">
            {QUICK_APPLIANCES.map((a) => {
              const on = !!picked[a.key];
              const registered = done.has(a.key);
              const v = getApplianceVisual(a.key);
              const Icon = v.icon;
              const own = picked[a.key] ?? "OWNED";
              return (
                <li key={a.key} data-testid="quick-item" data-key={a.key} className="min-w-0">
                  <div className={cn("flex h-full flex-col gap-2 rounded-3xl bg-white p-3 shadow-sm transition-all dark:bg-zinc-800", on && "ring-2 ring-sky-400", registered && "opacity-60")}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${a.name} 선택`}
                      disabled={registered}
                      onClick={() => toggle(a.key)}
                      className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", v.tone)}>
                        <Icon size={20} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold text-slate-900 dark:text-zinc-50">{a.name}</span>
                        <span className="block truncate text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                          {a.space} · {a.tasks[0].days}일마다
                        </span>
                      </span>
                      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", on ? "bg-sky-600 text-white dark:bg-sky-500" : "bg-slate-100 text-transparent dark:bg-zinc-700")}>
                        <Check size={14} strokeWidth={3} aria-hidden />
                      </span>
                    </button>
                    {registered ? (
                      <p className="text-center text-[11px] font-bold text-teal-700 dark:text-teal-300">이미 등록됨</p>
                    ) : (
                      <div role="radiogroup" aria-label={`${a.name} 소유 형태`} className={cn("grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 dark:bg-zinc-900", !on && "pointer-events-none opacity-40")}>
                        {(["OWNED", "RENTAL"] as const).map((o) => (
                          <button
                            key={o}
                            type="button"
                            role="radio"
                            aria-checked={own === o}
                            onClick={() => setOwn(a.key, o)}
                            className={cn("min-h-9 rounded-full text-xs font-bold transition-all", own === o ? "bg-white text-sky-700 shadow-sm dark:bg-zinc-700 dark:text-sky-300" : "text-slate-500 dark:text-zinc-400")}
                          >
                            {o === "OWNED" ? "자가" : "렌탈"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {error && (
            <p role="alert" data-testid="quick-error" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          )}
          <button type="button" data-testid="quick-submit" disabled={pending || count === 0} onClick={submit} className={cn(GRADIENT_CTA, "w-full disabled:cursor-not-allowed disabled:opacity-60")}>
            {pending && <Loader2 size={18} className="animate-spin" aria-hidden />}
            {pending ? "등록하는 중…" : count === 0 ? "가전을 골라 주세요" : `선택한 ${count}개 가전 한 번에 등록`}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
