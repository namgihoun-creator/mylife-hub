"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Check, Loader2, PawPrint, Pencil, Snowflake, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { formatDotDate, formatWon } from "@/features/assets/utils/rental";
import { expiryInfo, isFossil, type ExpiryInfo } from "../rules/expiry";
import { isPetToxic } from "../rules/pet-safety";
import { STORAGE_LABEL, STORAGE_TYPES, type StorageType } from "../rules/shelf-life";
import type { KitchenItem, PetType } from "../schemas/kitchen.schema";
import { consumeKitchenItem, deleteKitchenItem, moveStorageKitchenItem } from "../server/kitchen.actions";

const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight";
const ACTION =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-transparent px-2.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100";

/** D-Day traffic-light pill: <=2 Rose, <=7 Amber, else Emerald; a date in the past is a filled Rose alert. */
export function DDayBadge({ info }: { info: ExpiryInfo }) {
  const tone = info.expired
    ? "border-transparent bg-rose-600 text-white dark:bg-rose-500 dark:text-black"
    : info.light === "red"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
      : info.light === "yellow"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  return (
    <span data-testid="dday-badge" data-light={info.expired ? "alert" : info.light} className={cn(PILL, "tabular-nums", tone)}>
      {info.expired ? `${info.label} 지남` : info.label}
    </span>
  );
}

export function KitchenItemCard({
  item,
  today,
  petType,
  onEdit,
  onFossil,
  onNotice,
}: {
  item: KitchenItem;
  today: string;
  petType: PetType;
  onEdit: (item: KitchenItem) => void;
  onFossil: (item: KitchenItem) => void;
  onNotice: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const info = expiryInfo(item.expire_date, today);
  const fossil = isFossil(item, today);
  const toxic = petType !== "none" && isPetToxic(item.name);

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      if (res.message) onNotice(res.message);
    });
  };

  return (
    <article
      data-testid="kitchen-card"
      data-name={item.name}
      data-storage={item.storage_type}
      data-light={info ? (info.expired ? "alert" : info.light) : "none"}
      aria-busy={pending}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-white p-4 transition-colors dark:bg-zinc-950",
        info?.expired ? "border-rose-300 dark:border-rose-900" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
        pending && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 data-testid="kitchen-card-name" className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {item.name}
          </h3>
          <p className="truncate text-xs font-normal text-zinc-500 dark:text-zinc-400">
            <span data-testid="kitchen-card-amount">{item.amount}</span>
            <span aria-hidden> · </span>
            {STORAGE_LABEL[item.storage_type]}
            {item.spot && <span data-testid="kitchen-card-spot"> · {item.spot}</span>}
          </p>
        </div>
        {info ? <DDayBadge info={info} /> : <span className={cn(PILL, "border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400")}>날짜 오류</span>}
      </div>

      <p className="text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">소비기한 {formatDotDate(item.expire_date)}</p>

      {(fossil || toxic || item.is_pet || item.memo) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {fossil && (
            <button
              type="button"
              data-testid="fossil-badge"
              onClick={() => onFossil(item)}
              aria-label={`${item.name} 냉동 30일 이상, 해동 가이드 보기`}
              className={cn(PILL, "border-cyan-200 bg-cyan-50 text-cyan-700 transition-colors hover:bg-cyan-100 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-950/70")}
            >
              <Snowflake className="h-3 w-3" aria-hidden /> 30일+ 냉동
            </button>
          )}
          {toxic && (
            <span data-testid="pet-badge" data-kind="toxic" className={cn(PILL, "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300")}>
              <PawPrint className="h-3 w-3" aria-hidden /> 반려동물 위험
            </span>
          )}
          {item.is_pet && (
            <span data-testid="pet-badge" data-kind="pet" className={cn(PILL, "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400")}>
              <PawPrint className="h-3 w-3" aria-hidden /> 펫 전용
            </span>
          )}
          {item.memo && <span className="min-w-0 max-w-full truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{item.memo}</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="consume-btn"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await consumeKitchenItem({ id: item.id });
              return r.ok ? { ok: true, message: r.savedWon > 0 ? `${item.name} 다 먹었어요! ${formatWon(r.savedWon)} 아꼈어요.` : `${item.name} 다 먹었어요!` } : r;
            })
          }
          className={ACTION}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} 다 먹었어요
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="move-btn" disabled={pending} aria-label={`${item.name} 보관 위치 이동`} className={ACTION}>
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden /> 이동
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {STORAGE_TYPES.filter((s) => s !== item.storage_type).map((s: StorageType) => (
              <DropdownMenuItem
                key={s}
                data-testid="move-option"
                data-to={s}
                onSelect={() =>
                  run(async () => {
                    const r = await moveStorageKitchenItem({ id: item.id, storageType: s });
                    return r.ok ? { ok: true, message: `${item.name}을(를) ${r.label}(으)로 옮겼어요.` } : r;
                  })
                }
              >
                {STORAGE_LABEL[s]}(으)로 이동
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button type="button" data-testid="edit-btn" disabled={pending} onClick={() => onEdit(item)} aria-label={`${item.name} 수정`} className={ACTION}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> 수정
        </button>

        {confirmDelete ? (
          <>
            <button
              type="button"
              data-testid="delete-confirm"
              disabled={pending}
              onClick={() => run(async () => { const r = await deleteKitchenItem({ id: item.id }); return r.ok ? { ok: true, message: `${item.name}을(를) 삭제했어요.` } : r; })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:text-black dark:hover:bg-rose-400"
            >
              삭제 확인
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={ACTION}>
              취소
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid="delete-btn"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            aria-label={`${item.name} 삭제`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}
