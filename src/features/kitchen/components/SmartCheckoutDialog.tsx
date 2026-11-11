"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowRightLeft, Check, CircleHelp, Loader2, Trash2, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { SAVED_WON_PER_RESCUE } from "../rules/storage-move";
import type { CheckoutPlanRow } from "../rules/smart-checkout-rules";
import { executeSmartCheckoutBatch, parseSmartCheckoutAction, type CheckoutSummary } from "../server/kitchen-zerotyping.actions";

type Parsed = { source: "gemini" | "rules"; note: string; rows: CheckoutPlanRow[]; previews: { text: string; ok: boolean }[] };
type Phase =
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; parsed: Parsed; on: boolean[] }
  | { kind: "done"; summary: CheckoutSummary; results: { ok: boolean; text: string }[] };

const ICON: Record<string, LucideIcon> = { consume: Check, move: ArrowRightLeft, discard: Trash2, expense: Wallet };
const TONE: Record<string, string> = {
  consume: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  move: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  discard: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
  expense: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
};

function Flow({ text, onClose, onNotice }: { text: string; onClose: () => void; onNotice: (m: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "parsing" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await parseSmartCheckoutAction({ text });
      if (cancelled) return;
      if (!res.ok) return setPhase({ kind: "error", message: res.error });
      if (res.rows.length === 0) return setPhase({ kind: "empty" });
      setPhase({ kind: "ready", parsed: { source: res.source, note: res.note, rows: res.rows, previews: res.previews }, on: res.rows.map((_, i) => res.previews[i].ok) });
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  function run() {
    if (phase.kind !== "ready") return;
    const rows = phase.parsed.rows.filter((_, i) => phase.on[i] && phase.parsed.previews[i].ok);
    setError(null);
    startTransition(async () => {
      const res = await executeSmartCheckoutBatch({
        rows: rows.map((r) => ({ action: r.action, itemId: r.itemId, name: r.name, amount: r.amount, target: r.target, won: r.won, category: r.category })),
      });
      if (!res.ok) return setError(res.error);
      const s = res.summary;
      const parts = [s.consumed + s.reduced > 0 && `소진·차감 ${s.consumed + s.reduced}`, s.moved > 0 && `이동 ${s.moved}`, s.discarded > 0 && `폐기 ${s.discarded}`, s.expenses > 0 && `지출 ${s.expenses}`].filter(Boolean);
      onNotice(`반영 완료: ${parts.join(" · ") || "변경 없음"}${s.savedWon > 0 ? ` (+${s.savedWon.toLocaleString("ko-KR")}원 절약)` : ""}${s.failed ? ` · ${s.failed}건 실패` : ""}`);
      if (s.failed > 0) setPhase({ kind: "done", summary: s, results: res.results });
      else onClose();
    });
  }

  const picked = phase.kind === "ready" ? phase.parsed.rows.filter((_, i) => phase.on[i] && phase.parsed.previews[i].ok).length : 0;

  return (
    <div data-testid="checkout-flow" className="space-y-4">
      <p data-testid="checkout-sentence" className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
        “{text}”
      </p>

      {phase.kind === "parsing" && (
        <div role="status" data-testid="checkout-parsing" className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-600 dark:text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> 문장을 읽는 중…
        </div>
      )}
      {phase.kind === "error" && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{phase.message}</p>}
      {phase.kind === "empty" && (
        <p data-testid="checkout-empty" className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          알아듣지 못했어요. ‘대파 1대 썼어’, ‘우유 버렸어’, ‘소고기 냉동실로 옮겼어’, ‘치킨 22000원 배달’처럼 적어 보세요.
        </p>
      )}

      {phase.kind === "ready" && (
        <>
          <p data-testid="checkout-source" data-source={phase.parsed.source} className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            {phase.parsed.source === "gemini" ? "AI가 읽었어요." : `글자 규칙으로 읽었어요${phase.parsed.note ? ` (${phase.parsed.note})` : ""}.`} 아래 내용이 맞는지 확인해 주세요.
          </p>
          <ul className="space-y-2" aria-label="실행할 동작">
            {phase.parsed.rows.map((r, i) => {
              const pv = phase.parsed.previews[i];
              const Icon = pv.ok ? ICON[r.action] : CircleHelp;
              return (
                <li
                  key={i}
                  data-testid="checkout-row"
                  data-action={r.action}
                  data-ok={pv.ok}
                  className={cn("flex items-center gap-3 rounded-xl border p-3", pv.ok ? "" : "border-dashed border-zinc-300 opacity-70 dark:border-zinc-700")}
                >
                  <input
                    type="checkbox"
                    data-testid="checkout-row-check"
                    checked={pv.ok && phase.on[i]}
                    disabled={!pv.ok}
                    onChange={(e) => setPhase({ ...phase, on: phase.on.map((v, j) => (j === i ? e.target.checked : v)) })}
                    aria-label={`${pv.text} 반영`}
                    className="h-4 w-4 shrink-0 rounded accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", pv.ok ? TONE[r.action] : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400")}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span data-testid="checkout-row-text" className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {pv.text}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">다 먹은 재료는 1건당 {SAVED_WON_PER_RESCUE.toLocaleString("ko-KR")}원씩 절약액에 쌓여요. 수량을 말했다면 그만큼만 차감해요.</p>
        </>
      )}

      {phase.kind === "done" && (
        <ul data-testid="checkout-results" className="space-y-1.5">
          {phase.results.map((r, i) => (
            <li key={i} className={cn("flex items-center gap-2 text-xs", r.ok ? "text-zinc-700 dark:text-zinc-300" : "font-medium text-rose-600 dark:text-rose-400")}>
              {r.ok ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />} {r.text}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">
          {phase.kind === "done" ? "닫기" : "취소"}
        </button>
        {phase.kind === "ready" && (
          <button
            type="button"
            data-testid="checkout-run"
            disabled={pending || picked === 0}
            onClick={run}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {picked}건 일괄 실행
          </button>
        )}
      </div>
    </div>
  );
}

/** Preview of what the sentence means (consume / move / discard / expense cards) — nothing changes until [일괄 실행]. */
export function SmartCheckoutDialog({ text, onClose, onNotice }: { text: string | null; onClose: () => void; onNotice: (m: string) => void }) {
  return (
    <Dialog open={text !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="checkout-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>말로 정리</DialogTitle>
          <DialogDescription>읽은 내용을 확인하고 한 번에 반영해요.</DialogDescription>
        </DialogHeader>
        {text !== null && <Flow key={text} text={text} onClose={onClose} onNotice={onNotice} />}
      </DialogContent>
    </Dialog>
  );
}
