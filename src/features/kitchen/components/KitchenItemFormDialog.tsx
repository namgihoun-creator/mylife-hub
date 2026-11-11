"use client";

import { useMemo, useState, useTransition } from "react";
import { Lightbulb, Loader2, PawPrint } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { formatDotDate } from "@/features/assets/utils/rental";
import { defaultExpireDate, STORAGE_LABEL, STORAGE_TYPES, type StorageType } from "../rules/shelf-life";
import { toxicMatch } from "../rules/pet-safety";
import type { KitchenItem, PetType } from "../schemas/kitchen.schema";
import { createKitchenItem, updateKitchenItem } from "../server/kitchen.actions";

const LABEL = "text-xs font-medium text-zinc-700 dark:text-zinc-300";
const HINT = "text-[11px] font-normal text-zinc-500 dark:text-zinc-400";

export type KitchenFormTarget = { mode: "create" } | { mode: "edit"; item: KitchenItem };

function ItemForm({ target, today, petType, onClose, onNotice }: { target: KitchenFormTarget; today: string; petType: PetType; onClose: () => void; onNotice: (m: string) => void }) {
  const editing = target.mode === "edit" ? target.item : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [amount, setAmount] = useState(editing?.amount ?? "1개");
  const [storagePick, setStoragePick] = useState<StorageType | null>(null); // null = follow the name (auto)
  const [spot, setSpot] = useState(editing?.spot ?? "");
  const [expirePick, setExpirePick] = useState<string | null>(editing?.expire_date ?? null); // null = follow the suggestion
  const [isPet, setIsPet] = useState(editing?.is_pet ?? false);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Live suggestion from the 50-ingredient shelf-life dictionary (create only).
  const suggestion = useMemo(() => (name.trim() ? defaultExpireDate(name.trim(), today, storagePick ?? undefined) : null), [name, today, storagePick]);
  const storage: StorageType = editing ? editing.storage_type : (storagePick ?? suggestion?.storage ?? "FRIDGE");
  const expire = expirePick ?? suggestion?.expireDate ?? "";
  const toxic = petType !== "none" ? toxicMatch(name) : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (editing) {
        const res = await updateKitchenItem({ id: editing.id, amount, spot: spot || null, expireDate: expire || undefined, memo: memo || null });
        if (!res.ok) return setError(res.error);
        onNotice(`${editing.name}을(를) 수정했어요.`);
      } else {
        const res = await createKitchenItem({ name, amount, storageType: storage, spot: spot || null, expireDate: expire || undefined, isPet, memo: memo || null });
        if (!res.ok) return setError(res.error);
        onNotice(`${res.item.name}을(를) ${STORAGE_LABEL[res.item.storage_type]}에 넣었어요.`);
      }
      onClose();
    });
  }

  return (
    <form onSubmit={onSubmit} data-testid="kitchen-form" className="space-y-4" noValidate>
      {editing ? (
        <div className="space-y-1">
          <span className={LABEL}>재료</span>
          <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-medium text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-50">
            {editing.name} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {STORAGE_LABEL[editing.storage_type]}</span>
          </p>
          <p className={HINT}>보관 장소(냉장·냉동·실온)는 카드의 ‘이동’에서 바꿔요.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="kitchen-name" className={LABEL}>
            재료 이름 <span className="text-rose-500">*</span>
          </label>
          <Input id="kitchen-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="예: 계란, 두부, 삼겹살" autoFocus />
          {toxic && (
            <p data-testid="form-toxic-warning" role="status" className="flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              <PawPrint className="h-3 w-3" aria-hidden /> {toxic}은(는) 반려동물에게 위험해요. 닿지 않는 곳에 보관하세요.
            </p>
          )}
        </div>
      )}

      {!editing && (
        <div className="space-y-1">
          <span className={LABEL} id="kitchen-storage-label">보관 장소</span>
          <div role="radiogroup" aria-labelledby="kitchen-storage-label" className="grid grid-cols-3 gap-2">
            {STORAGE_TYPES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={storage === s}
                data-testid="form-storage"
                data-storage={s}
                onClick={() => setStoragePick(s)}
                className={cn(
                  "h-9 rounded-lg border text-xs font-medium transition-colors",
                  storage === s
                    ? "border-zinc-900 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:text-zinc-50 dark:ring-zinc-100"
                    : "text-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-700",
                )}
              >
                {STORAGE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="kitchen-amount" className={LABEL}>수량</label>
          <Input id="kitchen-amount" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={50} placeholder="예: 1모, 300g" />
        </div>
        <div className="space-y-1">
          <label htmlFor="kitchen-spot" className={LABEL}>위치 메모</label>
          <Input id="kitchen-spot" value={spot} onChange={(e) => setSpot(e.target.value)} maxLength={30} placeholder="예: 선반 앞" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="kitchen-expire" className={LABEL}>소비기한</label>
        <Input id="kitchen-expire" type="date" value={expire} onChange={(e) => setExpirePick(e.target.value || null)} />
        {!editing && suggestion && (
          <div data-testid="shelf-suggestion" data-source={suggestion.source} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="min-w-0 flex-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              {suggestion.source === "dictionary" ? "권장 소비기한" : "기본 소비기한"}{" "}
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                {STORAGE_LABEL[suggestion.storage]} {suggestion.days}일 · {formatDotDate(suggestion.expireDate)}
              </strong>
            </p>
            {expire !== suggestion.expireDate && (
              <button type="button" data-testid="apply-suggestion" onClick={() => setExpirePick(null)} className="shrink-0 text-[11px] font-semibold text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                적용
              </button>
            )}
          </div>
        )}
        {!editing && !suggestion && <p className={HINT}>이름을 입력하면 권장 소비기한을 계산해 드려요.</p>}
      </div>

      {!editing && (
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={isPet} onChange={(e) => setIsPet(e.target.checked)} className="h-4 w-4 rounded accent-zinc-900 dark:accent-zinc-100" />
          반려동물 전용 (간식·사료·캔)
        </label>
      )}

      <div className="space-y-1">
        <label htmlFor="kitchen-memo" className={LABEL}>메모 (선택)</label>
        <Input id="kitchen-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} placeholder="예: 개봉함" />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {editing ? "저장" : "재료 추가"}
        </button>
      </div>
    </form>
  );
}

/** Add / edit dialog. The form is mounted only while open, so every opening starts from fresh state. */
export function KitchenItemFormDialog({ target, today, petType, onClose, onNotice }: { target: KitchenFormTarget | null; today: string; petType: PetType; onClose: () => void; onNotice: (m: string) => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>{target?.mode === "edit" ? "재료 수정" : "재료 추가"}</DialogTitle>
          <DialogDescription>{target?.mode === "edit" ? "수량, 위치 메모, 소비기한을 바꿀 수 있어요." : "이름만 넣어도 권장 소비기한을 채워 드려요."}</DialogDescription>
        </DialogHeader>
        {target && <ItemForm target={target} today={today} petType={petType} onClose={onClose} onNotice={onNotice} />}
      </DialogContent>
    </Dialog>
  );
}
