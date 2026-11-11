"use client";

import { useState, useTransition } from "react";
import { Camera, ImageIcon, Info, Loader2, ScanLine } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { formatWon } from "@/features/assets/utils/rental";
import { STORAGE_LABEL, STORAGE_TYPES, defaultExpireDate, type StorageType } from "../rules/shelf-life";
import { compressImage } from "../utils/image-compressor";
import { analyzeKitchenImageAction, batchCreateKitchenItems } from "../server/kitchen-zerotyping.actions";

type Row = { key: number; name: string; amount: string; storage: StorageType; isPet: boolean; on: boolean };
type Phase = { kind: "pick" } | { kind: "working"; step: string } | { kind: "unavailable"; note: string } | { kind: "review"; total: number };

const PICK_BTN =
  "flex h-24 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus-within:ring-1 focus-within:ring-zinc-900 dark:border-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-within:ring-zinc-100";

function SnapFlow({ today, onClose, onNotice }: { today: string; onClose: () => void; onNotice: (m: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [rows, setRows] = useState<Row[]>([]);
  const [recordTotal, setRecordTotal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhase({ kind: "working", step: "사진을 줄이는 중…" });
      const img = await compressImage(file); // long side <= 1024px, JPEG 0.75 -> light base64 (Vercel's 4.5MB limit is never an issue)
      setPhase({ kind: "working", step: "AI가 사진을 읽는 중…" });
      const res = await analyzeKitchenImageAction({ imageBase64: img.base64, mimeType: img.mimeType });
      if (!res.ok) {
        setError(res.error);
        return setPhase({ kind: "pick" });
      }
      const a = res.analysis;
      if (a.source === "unavailable") return setPhase({ kind: "unavailable", note: a.note });
      if (a.items.length === 0) {
        setError("사진에서 식재료를 찾지 못했어요. 더 가까이서 밝게 찍어 보세요.");
        return setPhase({ kind: "pick" });
      }
      setRows(a.items.map((it, i) => ({ key: i, name: it.name, amount: it.amount, storage: it.storageType, isPet: it.isPet, on: true })));
      setRecordTotal(true);
      setPhase({ kind: "review", total: a.totalPrice });
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 처리하지 못했어요.");
      setPhase({ kind: "pick" });
    }
  }

  const picked = rows.filter((r) => r.on);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function submit() {
    if (phase.kind !== "review") return;
    setError(null);
    const total = phase.total;
    startTransition(async () => {
      const res = await batchCreateKitchenItems({
        items: picked.map((r) => ({ name: r.name, amount: r.amount, storageType: r.storage, isPet: r.isPet })),
        receiptTotal: total > 0 ? total : null,
        recordTotal: recordTotal && total > 0,
      });
      if (!res.ok) return setError(res.error);
      onNotice(`${res.created}개를 입고했어요.${res.expenseRecorded ? ` 결제 ${formatWon(total)}도 지출에 기록했어요.` : ""}${res.warning ? ` ${res.warning}` : ""}`);
      onClose();
    });
  }

  return (
    <div data-testid="snap-flow" className="space-y-4">
      {(phase.kind === "pick" || phase.kind === "unavailable") && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <label className={PICK_BTN}>
              <Camera className="h-6 w-6" aria-hidden />
              카메라로 찍기
              <input data-testid="snap-camera-input" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <label className={PICK_BTN}>
              <ImageIcon className="h-6 w-6" aria-hidden />
              갤러리에서 고르기
              <input data-testid="snap-gallery-input" type="file" accept="image/*" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            영수증이나 장 본 식재료를 찍으면 품목·수량·보관 장소를 읽어 드려요. 사진은 분석을 위해 Google Gemini로만 전송되고 저장되지 않아요.
          </p>
        </div>
      )}

      {phase.kind === "unavailable" && (
        <div data-testid="snap-unavailable" role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          {phase.note}
          <span className="mt-1 block font-normal text-amber-700 dark:text-amber-400">그동안은 ‘재료 추가’로 직접 넣거나 ‘말로 정리’를 써 보세요.</span>
        </div>
      )}

      {phase.kind === "working" && (
        <div data-testid="snap-working" role="status" className="flex flex-col items-center gap-3 py-10 text-sm text-zinc-600 dark:text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span data-testid="snap-status">{phase.step}</span>
        </div>
      )}

      {phase.kind === "review" && (
        <div className="space-y-3">
          <ul data-testid="snap-list" className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rows.map((r) => {
              const d = defaultExpireDate(r.name, today, r.storage);
              return (
                <li key={r.key} data-testid="snap-row" data-name={r.name} className={cn("space-y-2 p-3", !r.on && "opacity-50")}>
                  <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                    <input type="checkbox" data-testid="snap-row-check" checked={r.on} onChange={(e) => patch(r.key, { on: e.target.checked })} className="h-4 w-4 shrink-0 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100" aria-label={`${r.name} 입고`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{r.name}</span>
                    {r.isPet && <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">펫 전용</span>}
                  </label>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2 pl-6 sm:grid-cols-[8rem_1fr_auto]">
                    <Input data-testid="snap-row-amount" value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} maxLength={50} aria-label={`${r.name} 수량`} disabled={!r.on} className="h-8 text-xs sm:col-start-1" />
                    <div role="radiogroup" aria-label={`${r.name} 보관 장소`} className="flex gap-1 sm:col-start-2">
                      {STORAGE_TYPES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={r.storage === s}
                          data-testid="snap-row-storage"
                          data-storage={s}
                          disabled={!r.on}
                          onClick={() => patch(r.key, { storage: s })}
                          className={cn(
                            "h-8 rounded-lg border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
                            r.storage === s ? "border-zinc-900 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:text-zinc-50 dark:ring-zinc-100" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400",
                          )}
                        >
                          {STORAGE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                    <span data-testid="snap-row-expire" className="col-span-2 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 sm:col-span-1 sm:col-start-3">
                      {d.days}일 · ~{d.expireDate.slice(5).replace("-", ".")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {phase.total > 0 && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200 p-3 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
              <input type="checkbox" data-testid="snap-total-check" checked={recordTotal} onChange={(e) => setRecordTotal(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100" />
              <span className="min-w-0 flex-1">
                결제 총액 <strong data-testid="snap-total" className="font-semibold tabular-nums">{formatWon(phase.total)}</strong> 지출 기록
              </span>
              <span className="shrink-0 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">장보기 가계부</span>
            </label>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {phase.kind === "review" && (
        <div className="flex gap-2">
          <button type="button" onClick={() => { setPhase({ kind: "pick" }); setRows([]); }} className="h-11 shrink-0 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">
            다시 찍기
          </button>
          <button
            type="button"
            data-testid="snap-submit"
            disabled={pending || picked.length === 0}
            onClick={submit}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-black px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ScanLine className="h-4 w-4" aria-hidden />}
            {picked.length}개 품목 한 번에 입고
          </button>
        </div>
      )}
    </div>
  );
}

/** 📷 찰칵 입고: take or pick a photo (receipt / groceries) -> review the detected items -> one-tap intake. */
export function SnapIngestDialog({ open, today, onClose, onNotice }: { open: boolean; today: string; onClose: () => void; onNotice: (m: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="snap-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>찰칵 입고</DialogTitle>
          <DialogDescription>영수증이나 장 본 재료를 찍으면 한 번에 냉장고에 넣어 드려요.</DialogDescription>
        </DialogHeader>
        {open && <SnapFlow today={today} onClose={onClose} onNotice={onNotice} />}
      </DialogContent>
    </Dialog>
  );
}
