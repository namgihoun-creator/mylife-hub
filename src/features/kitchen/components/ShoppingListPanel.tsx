"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, Plus, ShoppingBasket, Trash2, X } from "lucide-react";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import { SOURCE_LABEL, type ShoppingItem } from "../schemas/shopping.schema";
import { addShoppingItem, clearCheckedShopping, deleteShoppingItem, getShoppingItems, stockCheckedShopping, toggleShoppingItem } from "../server/shopping.actions";

const SYNC_MS = 15_000;
const field = "flex min-h-11 w-full rounded-2xl bg-slate-50 px-4 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-50";
const sortItems = (rows: ShoppingItem[]) => [...rows].sort((a, b) => Number(a.is_checked) - Number(b.is_checked) || a.created_at.localeCompare(b.created_at));

/**
 * 부부 공동 장보기 리스트. The list is shared state of the dashboard (so the 보관함 cards and the tab badge stay in step); the
 * partner's changes arrive by polling every 15 s while the tab is visible and when it regains focus. Checked rows sink to the bottom.
 */
export function ShoppingListPanel({
  items,
  setItems,
  notReady,
  onNotice,
}: {
  items: ShoppingItem[];
  setItems: (next: ShoppingItem[] | ((prev: ShoppingItem[]) => ShoppingItem[])) => void;
  notReady: boolean;
  onNotice: (m: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulk, startBulk] = useTransition();
  const busyRef = useRef(false);
  busyRef.current = adding || bulk;
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (notReady) return;
    let alive = true;
    const sync = async () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      const res = await getShoppingItems();
      if (!alive || !res.ok) return;
      setItems((prev) => (JSON.stringify(prev) === JSON.stringify(res.items) ? prev : res.items));
    };
    const timer = setInterval(sync, SYNC_MS);
    const on = () => void sync();
    document.addEventListener("visibilitychange", on);
    window.addEventListener("focus", on);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", on);
      window.removeEventListener("focus", on);
    };
  }, [notReady, setItems]);

  const sorted = useMemo(() => sortItems(items), [items]);
  const checked = items.filter((i) => i.is_checked).length;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    setError(null);
    const res = await addShoppingItem({ name, quantity: qty });
    setAdding(false);
    if (!res.ok) return setError(res.error);
    setItems((prev) => (prev.some((p) => p.id === res.item.id) ? prev : sortItems([...prev, res.item])));
    if (res.duplicate) onNotice(`${res.item.name}은(는) 이미 리스트에 있어요.`);
    setName("");
    setQty("");
    nameRef.current?.focus();
  };

  const toggle = async (it: ShoppingItem) => {
    const next = !it.is_checked;
    setItems((prev) => sortItems(prev.map((p) => (p.id === it.id ? { ...p, is_checked: next } : p))));
    const res = await toggleShoppingItem({ id: it.id, checked: next });
    if (!res.ok) {
      setItems((prev) => sortItems(prev.map((p) => (p.id === it.id ? { ...p, is_checked: it.is_checked } : p))));
      setError(res.error);
    }
  };

  const remove = async (it: ShoppingItem) => {
    setItems((prev) => prev.filter((p) => p.id !== it.id));
    const res = await deleteShoppingItem({ id: it.id });
    if (!res.ok) {
      setItems((prev) => sortItems([...prev, it]));
      setError(res.error);
    }
  };

  const clearChecked = () =>
    startBulk(async () => {
      setError(null);
      const res = await clearCheckedShopping();
      if (!res.ok) return setError(res.error);
      setItems((prev) => prev.filter((p) => !p.is_checked));
      onNotice(`체크한 ${res.removed}개를 비웠어요.`);
    });

  const stock = () =>
    startBulk(async () => {
      setError(null);
      const res = await stockCheckedShopping();
      if (!res.ok) return setError(res.error);
      setItems((prev) => prev.filter((p) => !p.is_checked));
      const parts = [res.summary.FRIDGE && `냉장 ${res.summary.FRIDGE}`, res.summary.FREEZER && `냉동 ${res.summary.FREEZER}`, res.summary.ROOM_TEMP && `실온 ${res.summary.ROOM_TEMP}`].filter(Boolean).join(" · ");
      onNotice(`장본 ${res.stocked}개를 보관함에 입고했어요. (${parts})`);
      router.refresh();
    });

  if (notReady) {
    return (
      <div data-testid="shopping-not-ready">
        <EmptyState icon={ShoppingBasket} title="장보기 리스트를 준비하고 있어요" description="데이터베이스 업데이트가 끝나면 부부가 함께 쓰는 장보기 리스트가 열려요." />
      </div>
    );
  }

  const bar = (pos: "top" | "bottom") => (
    <div data-testid={`shopping-bulk-${pos}`} className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={`shopping-stock-${pos}`}
        disabled={checked === 0 || bulk}
        onClick={stock}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl bg-teal-600 px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-teal-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500"
      >
        {bulk ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <PackageCheck size={16} strokeWidth={2.5} aria-hidden />} 장본 품목 보관함으로 바로 입고
      </button>
      <button
        type="button"
        data-testid={`shopping-clear-${pos}`}
        disabled={checked === 0 || bulk}
        onClick={clearChecked}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl bg-slate-100 px-4 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200"
      >
        <Trash2 size={16} aria-hidden /> 체크된 항목 비우기
      </button>
    </div>
  );

  return (
    <section data-testid="shopping-panel" aria-label="부부 공동 장보기 리스트" className="space-y-4 rounded-3xl bg-white p-4 shadow-sm dark:bg-zinc-900 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
          <ShoppingBasket size={18} strokeWidth={2.5} className="text-sky-600 dark:text-sky-400" aria-hidden /> 우리 장보기
          <span data-testid="shopping-count" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold tabular-nums text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
            {checked}/{items.length}
          </span>
        </h2>
        <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">둘 중 누가 체크해도 서로의 화면에 곧 반영돼요.</p>
      </div>

      <form onSubmit={add} data-testid="shopping-form" className="grid grid-cols-[1fr_5.5rem_auto] gap-2 max-[420px]:grid-cols-[1fr_auto]">
        <input ref={nameRef} data-testid="shopping-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="품목 (예: 두부)" aria-label="품목 이름" className={cn(field, "max-[420px]:col-span-2")} />
        <input data-testid="shopping-qty" value={qty} maxLength={50} onChange={(e) => setQty(e.target.value)} placeholder="1개" aria-label="수량" className={field} />
        <button type="submit" data-testid="shopping-add" disabled={adding || !name.trim()} className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl bg-sky-600 px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-sky-500 active:scale-95 disabled:opacity-50 dark:bg-sky-500">
          {adding ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} strokeWidth={2.5} aria-hidden />} 추가
        </button>
      </form>

      {error && (
        <p role="alert" data-testid="shopping-error" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p data-testid="shopping-empty" className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          장볼 것이 없어요. 위에서 바로 추가하거나, 보관함 카드의 ‘+ 장보기’로 떨어져 가는 재료를 보내 보세요.
        </p>
      ) : (
        <>
          {checked > 0 && bar("top")}
          <ul data-testid="shopping-list" className="space-y-1.5">
            {sorted.map((it) => (
              <li key={it.id} data-testid="shopping-row" data-name={it.name} data-checked={it.is_checked} className={cn("flex min-w-0 items-center gap-2 rounded-2xl bg-slate-50 px-3 py-1.5 dark:bg-zinc-800/60", it.is_checked && "opacity-60")}>
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" data-testid="shopping-check" checked={it.is_checked} onChange={() => toggle(it)} aria-label={`${it.name} 장봤어요`} className="h-5 w-5 shrink-0 rounded accent-sky-600" />
                  <span className="min-w-0 flex-1">
                    <span data-testid="shopping-row-name" className={cn("block break-words text-sm font-extrabold text-slate-900 dark:text-zinc-50", it.is_checked && "line-through")}>{it.name}</span>
                    {it.source_type !== "MANUAL" && <span className="block text-[11px] font-bold text-teal-700 dark:text-teal-300">{SOURCE_LABEL[it.source_type]}에서 담음</span>}
                  </span>
                  <span className={cn("shrink-0 text-xs font-bold tabular-nums text-slate-500 dark:text-zinc-400", it.is_checked && "line-through")}>{it.quantity}</span>
                </label>
                <button type="button" data-testid="shopping-remove" aria-label={`${it.name} 지우기`} onClick={() => remove(it)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-500 dark:hover:bg-rose-950/40">
                  <X size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {bar("bottom")}
        </>
      )}
    </section>
  );
}
