"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { formatDotDate, formatWon } from "@/features/assets/utils/rental";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "../rules/kitchen-budget";
import { EXPENSE_CATEGORY_LABEL } from "../schemas/kitchen.schema";
import { addKitchenExpense, deleteKitchenExpense, updateKitchenBudgetSettings, type KitchenBudgetData } from "../server/kitchen-budget.actions";

const LABEL = "text-xs font-medium text-zinc-700 dark:text-zinc-300";
const TONE: Record<ExpenseCategory, string> = {
  human_groceries: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  human_delivery: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  pet_care: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300",
};
export const CategoryChip = ({ category }: { category: ExpenseCategory }) => (
  <span data-testid="expense-category" data-category={category} className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight", TONE[category])}>
    {EXPENSE_CATEGORY_LABEL[category]}
  </span>
);

const toWon = (s: string): number | null => {
  const t = s.replace(/[,\s원]/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
};

function AddForm({ today, onDone }: { today: string; onDone: (m: string) => void }) {
  const [category, setCategory] = useState<ExpenseCategory>("human_groceries");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const won = toWon(amount);
    if (won === null) return setError("금액을 숫자로 입력해 주세요.");
    startTransition(async () => {
      const res = await addKitchenExpense({ amount: won, category, memo: memo || null, expenseDate: date || undefined });
      if (!res.ok) return setError(res.error);
      setAmount("");
      setMemo("");
      onDone(`${EXPENSE_CATEGORY_LABEL[category]} ${formatWon(won)}을(를) 기록했어요.`);
    });
  }

  return (
    <form onSubmit={submit} data-testid="expense-form" className="space-y-3" noValidate>
      <div role="radiogroup" aria-label="지출 분류" className="grid grid-cols-3 gap-2">
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            data-testid="expense-cat-option"
            data-category={c}
            onClick={() => setCategory(c)}
            className={cn(
              "h-9 rounded-lg border px-1 text-xs font-medium transition-colors",
              category === c ? "border-zinc-900 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:text-zinc-50 dark:ring-zinc-100" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700",
            )}
          >
            {EXPENSE_CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="expense-amount" className={LABEL}>금액 (원)</label>
          <Input id="expense-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 22000" className="tabular-nums" />
        </div>
        <div className="space-y-1">
          <label htmlFor="expense-date" className={LABEL}>날짜</label>
          <Input id="expense-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="expense-memo" className={LABEL}>메모 (선택)</label>
        <Input id="expense-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={40} placeholder="예: 치킨, 사료" />
      </div>
      {error && <p role="alert" data-testid="expense-error" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      <button type="submit" data-testid="expense-submit" disabled={pending} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} 지출 등록
      </button>
    </form>
  );
}

function ExpenseRow({ e }: { e: KitchenBudgetData["expenses"][number] }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <li data-testid="expense-row" data-id={e.id} className={cn("flex items-center gap-2 py-2.5", pending && "opacity-50")}>
      <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{formatDotDate(e.expense_date).slice(5)}</span>
      <CategoryChip category={e.category} />
      <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{e.memo ?? ""}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatWon(e.amount)}</span>
      {confirm ? (
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" data-testid="expense-delete-confirm" disabled={pending} onClick={() => startTransition(async () => { const r = await deleteKitchenExpense({ id: e.id }); if (!r.ok) setError(r.error); })} className="h-7 rounded-md bg-rose-600 px-2 text-[11px] font-semibold text-white dark:bg-rose-500 dark:text-black">삭제 확인</button>
          <button type="button" onClick={() => setConfirm(false)} className="h-7 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">취소</button>
        </span>
      ) : (
        <button type="button" data-testid="expense-delete" aria-label={`${e.memo ?? EXPENSE_CATEGORY_LABEL[e.category]} ${formatWon(e.amount)} 삭제`} onClick={() => setConfirm(true)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400">
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {error && <span role="alert" className="sr-only">{error}</span>}
    </li>
  );
}

function BudgetForm({ settings, onDone }: { settings: KitchenBudgetData["settings"]; onDone: (m: string) => void }) {
  const [human, setHuman] = useState(String(settings.human_monthly_budget));
  const [pet, setPet] = useState(String(settings.pet_monthly_budget));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const h = toWon(human), p = toWon(pet);
    if (h === null || p === null) return setError("예산을 숫자로 입력해 주세요. (0원 이상)");
    startTransition(async () => {
      const res = await updateKitchenBudgetSettings({ humanMonthly: h, petMonthly: p });
      if (!res.ok) return setError(res.error);
      onDone("월 예산을 바꿨어요.");
    });
  }
  return (
    <form onSubmit={save} data-testid="budget-form" className="space-y-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="budget-human" className={LABEL}>사람 식비 (월)</label>
          <Input id="budget-human" inputMode="numeric" value={human} onChange={(e) => setHuman(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-1">
          <label htmlFor="budget-pet" className={LABEL}>댕냥이 케어비 (월)</label>
          <Input id="budget-pet" inputMode="numeric" value={pet} onChange={(e) => setPet(e.target.value)} className="tabular-nums" />
        </div>
      </div>
      {error && <p role="alert" data-testid="budget-error" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      <button type="submit" data-testid="budget-save" disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} 예산 저장
      </button>
    </form>
  );
}

/** Quick expense entry + this month's full ledger + monthly budget settings. */
export function ExpenseDialog({ open, onClose, data, onNotice }: { open: boolean; onClose: () => void; data: KitchenBudgetData; onNotice: (m: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="expense-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>머니로그</DialogTitle>
          <DialogDescription>{data.month.replace("-", "년 ")}월 지출을 기록하고 확인해요.</DialogDescription>
        </DialogHeader>
        {open && <AddForm today={data.today} onDone={onNotice} />}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">이번 달 지출 <span data-testid="expense-count" className="font-normal tabular-nums text-zinc-500 dark:text-zinc-400">{data.expenses.length}건</span></p>
          {data.expenses.length === 0 ? (
            <p data-testid="expense-empty" className="rounded-lg border border-dashed border-zinc-200 px-3 py-5 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">아직 이번 달 지출이 없어요.</p>
          ) : (
            <ul data-testid="expense-list" className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-3 dark:divide-zinc-800 dark:border-zinc-800">
              {data.expenses.map((e) => <ExpenseRow key={e.id} e={e} />)}
            </ul>
          )}
        </div>

        <details className="group rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <summary data-testid="budget-settings-toggle" className="cursor-pointer text-xs font-semibold text-zinc-900 dark:text-zinc-50">월 예산 설정</summary>
          <div className="mt-3">{open && <BudgetForm settings={data.settings} onDone={onNotice} />}</div>
        </details>
      </DialogContent>
    </Dialog>
  );
}
