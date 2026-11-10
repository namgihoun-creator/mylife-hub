"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Collapse } from "@/shared/components/ui/collapse";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { SPACES, type Asset, type OwnershipType, type RentalInput } from "../schemas/asset.schema";
import { updateAsset } from "../server/asset.actions";
import { OwnershipToggle, RentalForm, emptyRentalForm, toRentalInput, type RentalFormState } from "./RentalForm";

const LABEL = "text-xs font-medium text-slate-700 dark:text-zinc-300";
const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function rentalStateFrom(a: Asset): RentalFormState {
  return {
    provider: str(a.rental_provider),
    monthlyFee: str(a.monthly_fee),
    billingDay: str(a.billing_day),
    contractStartDate: str(a.contract_start_date),
    obligationEndDate: str(a.obligation_end_date),
    ownershipTransferDate: str(a.ownership_transfer_date),
    careType: a.care_type ?? "NONE",
    paymentCardNote: str(a.payment_card_note),
  };
}

/** Mounted only while the dialog is open, so every opening starts from the asset's current (server) values. */
function EditForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [name, setName] = useState(asset.name);
  const [space, setSpace] = useState(asset.space ?? "");
  const [category, setCategory] = useState(asset.category ?? "");
  const [note, setNote] = useState(asset.note ?? "");
  const [ownership, setOwnership] = useState<OwnershipType>(asset.ownership_type === "RENTAL" ? "RENTAL" : "OWNED");
  const [rental, setRental] = useState<RentalFormState>(asset.ownership_type === "RENTAL" ? rentalStateFrom(asset) : emptyRentalForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The current place may be a custom value (not in SPACES): keep it selectable.
  const spaceOptions = space && !(SPACES as readonly string[]).includes(space) ? [space, ...SPACES] : [...SPACES];
  const wasRental = asset.ownership_type === "RENTAL";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    let rentalInput: RentalInput | undefined;
    if (ownership === "RENTAL") {
      const parsed = toRentalInput(rental);
      if (!parsed.ok) return setError(parsed.error);
      rentalInput = parsed.value;
    }

    startTransition(async () => {
      const res = await updateAsset({
        assetId: asset.id,
        name,
        space: space || null,
        category: category || null,
        note: note || null,
        ownershipType: ownership,
        rental: rentalInput,
      });
      if (!res.ok) return setError(res.error);
      onClose();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="edit-name" className={LABEL}>
          이름 <span className="text-rose-500">*</span>
        </label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-10 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="edit-space" className={LABEL}>
            위치
          </label>
          <select id="edit-space" value={space} onChange={(e) => setSpace(e.target.value)} className={`${CONTROL} h-10`}>
            <option value="">미지정</option>
            {spaceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-category" className={LABEL}>
            카테고리
          </label>
          <Input id="edit-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={50} className="h-10 rounded-lg" />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="edit-note" className={LABEL}>
          메모
        </label>
        <textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={`${CONTROL} py-2`} />
      </div>

      <div className="space-y-2">
        <span className={LABEL}>소유 형태</span>
        <OwnershipToggle value={ownership} onChange={setOwnership} />
        {wasRental && ownership === "OWNED" && (
          <p role="note" className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            직접 구매로 바꾸면 저장된 렌탈 정보(렌탈사, 월 렌탈료, 약정일 등)가 삭제돼요.
          </p>
        )}
        <Collapse open={ownership === "RENTAL"}>
          <RentalForm value={rental} onChange={(patch) => setRental((prev) => ({ ...prev, ...patch }))} />
        </Collapse>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-w-20 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          저장
        </button>
      </div>
    </form>
  );
}

export function AssetEditModal({ asset, open, onOpenChange }: { asset: Asset; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-semibold text-slate-800 dark:text-zinc-200">자산 정보 수정</DialogTitle>
          <DialogDescription className="text-xs font-normal text-slate-500 dark:text-zinc-400">
            이름, 위치, 메모와 렌탈 정보를 고칠 수 있어요. 등록된 관리 규칙은 그대로 유지돼요.
          </DialogDescription>
        </DialogHeader>
        <EditForm asset={asset} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
