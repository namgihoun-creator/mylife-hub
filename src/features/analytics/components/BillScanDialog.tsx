"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ImageIcon, Info, Loader2, PenLine, ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { compressImage } from "@/features/kitchen/utils/image-compressor";
import { BILL_LABEL, BILL_TYPES, type BillType } from "../schemas/bill.schema";
import { createBill } from "../server/bills.actions";

type Form = { type: BillType; month: string; amount: string; due: string; provider: string; memo: string };
type Phase = { kind: "choose" } | { kind: "working"; step: string } | { kind: "form"; fromAi: boolean; missing: string[] };

const field = "flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-50";
const pick = "flex h-24 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl bg-white text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-sky-50 active:scale-95 focus-within:ring-2 focus-within:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-100";

const emptyForm = (month: string): Form => ({ type: "ELECTRICITY", month, amount: "", due: "", provider: "", memo: "" });

/** [고지서 찰칵 등록]: photo (or manual entry) -> the AI's reading to check and correct -> save to the household's utility bills. */
export function BillScanDialog({ open, month, onClose, onSaved }: { open: boolean; month: string; onClose: () => void; onSaved: (m: string) => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [form, setForm] = useState<Form>(emptyForm(month));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const reset = () => {
    setPhase({ kind: "choose" });
    setForm(emptyForm(month));
    setError(null);
    setSaving(false);
  };
  const close = () => {
    if (busy.current) return;
    onClose();
    reset();
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    busy.current = true;
    setError(null);
    try {
      setPhase({ kind: "working", step: "사진을 줄이는 중…" });
      const img = await compressImage(file);
      setPhase({ kind: "working", step: "AI가 고지서를 읽는 중…" });
      const res = await fetch("/api/bills/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: img.base64, mimeType: img.mimeType }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setError(j?.message ?? "고지서를 읽지 못했어요. 직접 입력해 주세요.");
        return setPhase({ kind: "choose" });
      }
      const b = j.bill as { billType: BillType; billingMonth: string | null; amount: number | null; dueDate: string | null; providerName: string | null };
      const missing = [b.billingMonth ? null : "청구 월", b.amount === null ? "금액" : null].filter((x): x is string => !!x);
      setForm({ type: b.billType, month: b.billingMonth ?? month, amount: b.amount === null ? "" : String(b.amount), due: b.dueDate ?? "", provider: b.providerName ?? "", memo: "" });
      setPhase({ kind: "form", fromAi: true, missing });
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 처리하지 못했어요.");
      setPhase({ kind: "choose" });
    } finally {
      busy.current = false;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount.replace(/[,\s원]/g, ""));
    if (!form.amount.trim() || !Number.isFinite(amount)) return setError("금액을 숫자로 적어 주세요.");
    setSaving(true);
    busy.current = true;
    setError(null);
    const res = await createBill({ billType: form.type, billingMonth: form.month, amount, dueDate: form.due, providerName: form.provider, memo: form.memo });
    busy.current = false;
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onSaved(`${BILL_LABEL[form.type]} ${amount.toLocaleString("ko-KR")}원(${form.month})을 저장했어요.`);
    onClose();
    reset();
    router.refresh();
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="bill-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl border-0 bg-slate-50 shadow-xl dark:bg-zinc-900">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-extrabold tracking-tight">고지서 찰칵 등록</DialogTitle>
          <DialogDescription>전기·가스·수도·관리비·통신비 고지서를 찍으면 금액과 납부기한을 읽어 드려요.</DialogDescription>
        </DialogHeader>

        {phase.kind === "choose" && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <label className={pick}>
                <Camera className="h-6 w-6 text-sky-600 dark:text-sky-300" aria-hidden /> 카메라로 찍기
                <input data-testid="bill-camera-input" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <label className={pick}>
                <ImageIcon className="h-6 w-6 text-sky-600 dark:text-sky-300" aria-hidden /> 갤러리에서 고르기
                <input data-testid="bill-gallery-input" type="file" accept="image/*" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
            <button type="button" data-testid="bill-manual" onClick={() => setPhase({ kind: "form", fromAi: false, missing: [] })} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-100 active:scale-95 dark:bg-zinc-800 dark:text-zinc-100">
              <PenLine size={16} aria-hidden /> 사진 없이 직접 입력
            </button>
            <p className="flex items-start gap-1.5 text-[11px] font-medium text-slate-500 dark:text-zinc-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> 사진은 읽기 위해 Google Gemini로만 전송되고 저장되지 않아요. 결과는 저장하기 전에 꼭 확인해 주세요.
            </p>
          </div>
        )}

        {phase.kind === "working" && (
          <div data-testid="bill-working" role="status" className="flex flex-col items-center gap-3 py-10 text-sm font-medium text-slate-600 dark:text-zinc-300">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <span>{phase.step}</span>
          </div>
        )}

        {phase.kind === "form" && (
          <form data-testid="bill-form" onSubmit={save} className="space-y-3">
            {phase.fromAi && (
              <p data-testid="bill-ai-note" className={cn("flex items-start gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold", phase.missing.length ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300")}>
                <ReceiptText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {phase.missing.length ? `${phase.missing.join("·")}은(는) 읽지 못했어요. 직접 채워 주세요.` : "AI가 읽은 내용이에요. 맞는지 확인하고 저장해 주세요."}
              </p>
            )}
            <div role="radiogroup" aria-label="고지서 종류" className="flex flex-wrap gap-1.5">
              {BILL_TYPES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.type === t} data-bill-type={t} onClick={() => setForm((f) => ({ ...f, type: t }))} className={cn("min-h-9 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition-all active:scale-95", form.type === t ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300")}>
                  {BILL_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">청구 월</span>
                <input data-testid="bill-month" type="month" required value={form.month} onChange={set("month")} className={field} />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">청구 금액 (원)</span>
                <input data-testid="bill-amount" inputMode="numeric" required value={form.amount} onChange={set("amount")} placeholder="48230" className={cn(field, "tabular-nums")} />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">납부 기한 (선택)</span>
                <input data-testid="bill-due" type="date" value={form.due} onChange={set("due")} className={field} />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">청구 기관 (선택)</span>
                <input data-testid="bill-provider" maxLength={50} value={form.provider} onChange={set("provider")} placeholder="예: 한국전력" className={field} />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">메모 (선택)</span>
              <input data-testid="bill-memo" maxLength={200} value={form.memo} onChange={set("memo")} className={field} />
            </label>
            {error && <p role="alert" data-testid="bill-error" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" data-testid="bill-save" disabled={saving} className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-sky-600 px-5 text-sm font-bold text-white shadow-sm transition-all hover:bg-sky-500 active:scale-95 disabled:opacity-60 dark:bg-sky-500">
                {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.5} aria-hidden />} 저장
              </button>
              <button type="button" onClick={() => { setPhase({ kind: "choose" }); setError(null); }} className="inline-flex min-h-11 items-center rounded-2xl bg-white px-4 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300">
                다시 찍기
              </button>
            </div>
          </form>
        )}

        {phase.kind === "choose" && error && (
          <p role="alert" data-testid="bill-choose-error" className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
