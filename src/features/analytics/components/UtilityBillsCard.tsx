"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ReceiptText, Scan, Trash2 } from "lucide-react";
import { formatWon } from "@/features/assets/utils/rental";
import { cn } from "@/shared/lib/utils";
import { BILL_LABEL, type UtilityBill } from "../schemas/bill.schema";
import { deleteBill } from "../server/bills.actions";
import { diffText, summarizeBills } from "../utils/bills";
import { monthLabel } from "../utils/month";
import { BillScanDialog } from "./BillScanDialog";
import { ReportSection } from "./ReportSection";

/**
 * 공과금·관리비 for the chosen month: total, change against last month, split by type, the bills themselves and [고지서 찰칵 등록].
 * `notReady` (migration 19 missing) swaps the whole card for a friendly note — nothing else on /analytics is affected.
 */
export function UtilityBillsCard({ month, bills, notReady }: { month: string; bills: UtilityBill[]; notReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const summary = useMemo(() => summarizeBills(bills, month), [bills, month]);
  const mine = bills.filter((b) => b.billing_month === month);

  const flash = (m: string) => {
    setNotice(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  };

  if (notReady) {
    return (
      <ReportSection testId="bills-card" title="공과금·관리비" description="고지서를 찍어 두면 월별 합계와 전월 대비를 보여 드려요.">
        <p data-testid="bills-not-ready" className="flex items-start gap-2 rounded-2xl bg-sky-50 px-4 py-4 text-sm font-bold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          공과금 기록 기능을 준비하고 있어요. 데이터베이스 업데이트가 끝나면 이곳에서 고지서를 찍어 등록할 수 있어요.
        </p>
      </ReportSection>
    );
  }

  const remove = (b: UtilityBill) => {
    if (confirmId !== b.id) return setConfirmId(b.id);
    setConfirmId(null);
    setPendingId(b.id);
    startTransition(async () => {
      const res = await deleteBill({ id: b.id });
      setPendingId(null);
      if (!res.ok) return setError(res.error);
      flash("고지서를 지웠어요.");
      router.refresh();
    });
  };

  const up = summary.diff !== null && summary.diff > 0;
  return (
    <ReportSection
      testId="bills-card"
      title="공과금·관리비"
      description={`${monthLabel(month)} 고지서 합계와 전월 대비예요.`}
      action={
        <button type="button" data-testid="bill-open" onClick={() => setOpen(true)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-600 px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-sky-500 active:scale-95 dark:bg-sky-500">
          <Scan size={16} strokeWidth={2.5} aria-hidden /> 고지서 찰칵 등록
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-2xl bg-slate-50 p-4 dark:bg-zinc-800/60">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">{monthLabel(month)} 합계 ({summary.count}건)</p>
            <p data-testid="bills-total" className="break-words text-2xl font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-zinc-50">{formatWon(summary.total)}</p>
          </div>
          <p data-testid="bills-diff" data-dir={summary.diff === null ? "none" : up ? "up" : summary.diff < 0 ? "down" : "same"} className={cn("text-sm font-bold tabular-nums", summary.diff === null ? "text-slate-500 dark:text-zinc-400" : up ? "text-rose-600 dark:text-rose-300" : "text-teal-700 dark:text-teal-300")}>
            {diffText(summary)}
          </p>
        </div>

        {summary.byType.length > 0 && (
          <ul data-testid="bills-by-type" className="flex flex-wrap gap-1.5">
            {summary.byType.map((t) => (
              <li key={t.type} className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold tabular-nums text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {BILL_LABEL[t.type]} {formatWon(t.total)}
              </li>
            ))}
          </ul>
        )}

        {notice && <p role="status" data-testid="bills-notice" className="rounded-2xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{notice}</p>}
        {error && <p role="alert" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

        {mine.length === 0 ? (
          <p data-testid="bills-empty" className="rounded-2xl bg-slate-50 px-3 py-6 text-center text-xs font-medium text-slate-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            이 달에 등록한 고지서가 없어요. ‘고지서 찰칵 등록’으로 첫 고지서를 추가해 보세요.
          </p>
        ) : (
          <ul data-testid="bills-list" className="space-y-1.5">
            {mine.map((b) => (
              <li key={b.id} data-testid="bill-row" data-type={b.bill_type} className="flex min-w-0 items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 dark:bg-zinc-800/60">
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-sky-700 shadow-sm dark:bg-zinc-900 dark:text-sky-300">{BILL_LABEL[b.bill_type]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800 dark:text-zinc-100">{b.provider_name ?? "청구 기관 미입력"}</span>
                  {(b.due_date || b.memo) && <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-zinc-400">{[b.due_date ? `납부기한 ${b.due_date}` : null, b.memo].filter(Boolean).join(" · ")}</span>}
                </span>
                <span className="shrink-0 text-sm font-extrabold tabular-nums text-slate-900 dark:text-zinc-50">{formatWon(b.amount)}</span>
                <button type="button" data-testid="bill-delete" aria-label={`${BILL_LABEL[b.bill_type]} 고지서 삭제`} disabled={pendingId === b.id} onClick={() => remove(b)} onBlur={() => setConfirmId(null)} className={cn("flex h-9 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all active:scale-95", confirmId === b.id ? "bg-rose-600 px-3 text-white dark:bg-rose-500" : "w-9 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-500 dark:hover:bg-rose-950/40")}>
                  {pendingId === b.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : confirmId === b.id ? "삭제 확인" : <Trash2 size={15} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BillScanDialog open={open} month={month} onClose={() => setOpen(false)} onSaved={flash} />
    </ReportSection>
  );
}
