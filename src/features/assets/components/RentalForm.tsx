"use client";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import {
  CARE_LABEL,
  CARE_TYPES,
  OWNERSHIP_LABEL,
  OWNERSHIP_TYPES,
  type CareType,
  type OwnershipType,
  type RentalInput,
} from "../schemas/asset.schema";

export type RentalFormState = {
  provider: string;
  monthlyFee: string;
  billingDay: string;
  contractStartDate: string;
  obligationEndDate: string;
  ownershipTransferDate: string;
  careType: CareType;
  paymentCardNote: string;
};

export const emptyRentalForm: RentalFormState = {
  provider: "",
  monthlyFee: "",
  billingDay: "",
  contractStartDate: "",
  obligationEndDate: "",
  ownershipTransferDate: "",
  careType: "NONE",
  paymentCardNote: "",
};

/** Form strings -> action input. Returns an error message for what only the browser can catch (non-numbers). */
export function toRentalInput(f: RentalFormState): { ok: true; value: RentalInput } | { ok: false; error: string } {
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));
  const fee = num(f.monthlyFee);
  const day = num(f.billingDay);
  if (fee !== null && !Number.isFinite(fee)) return { ok: false, error: "월 렌탈료는 숫자로 입력해 주세요." };
  if (day !== null && !Number.isFinite(day)) return { ok: false, error: "결제일은 숫자로 입력해 주세요." };
  if (!f.provider.trim()) return { ok: false, error: "렌탈사명을 입력해 주세요." };
  return {
    ok: true,
    value: {
      provider: f.provider,
      monthlyFee: fee,
      billingDay: day,
      contractStartDate: f.contractStartDate || null,
      obligationEndDate: f.obligationEndDate || null,
      ownershipTransferDate: f.ownershipTransferDate || null,
      careType: f.careType,
      paymentCardNote: f.paymentCardNote || null,
    },
  };
}

const FIELD_INPUT = "h-9 rounded-xl text-sm";
const LABEL = "text-xs font-medium text-slate-700 dark:text-zinc-300";

function Field({ label, htmlFor, required, className, children }: { label: string; htmlFor: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

/** [직접 구매] / [렌탈·구독] switch shown at the top of the add-asset modal (docs/DESIGN_SYSTEM.md §J). */
export function OwnershipToggle({ value, onChange }: { value: OwnershipType; onChange: (v: OwnershipType) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="소유 형태"
      className="grid grid-cols-2 gap-1 rounded-full border border-slate-200/80 bg-slate-100/60 p-1 dark:border-zinc-800 dark:bg-zinc-800/40"
    >
      {OWNERSHIP_TYPES.map((t) => {
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? cn("bg-white shadow-sm dark:bg-zinc-800", t === "RENTAL" ? "text-violet-600 dark:text-violet-400" : "text-slate-900 dark:text-zinc-50")
                : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-50",
            )}
          >
            {OWNERSHIP_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

/** Rental detail inputs (only rendered inside the animated <Collapse>, i.e. visible when RENTAL is chosen). */
export function RentalForm({ value, onChange }: { value: RentalFormState; onChange: (patch: Partial<RentalFormState>) => void }) {
  const set = (k: keyof RentalFormState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [k]: e.target.value });

  return (
    <fieldset className="mt-3 grid grid-cols-1 gap-3 rounded-2xl border border-violet-200/70 bg-violet-50/40 p-4 sm:grid-cols-2 dark:border-violet-900/50 dark:bg-violet-950/20">
      <legend className="sr-only">렌탈 정보</legend>

      <Field label="렌탈사명" htmlFor="rental-provider" required className="sm:col-span-2">
        <Input id="rental-provider" value={value.provider} onChange={set("provider")} placeholder="예: 코웨이, SK매직, LG" maxLength={50} className={FIELD_INPUT} />
      </Field>

      <Field label="월 렌탈료 (원)" htmlFor="rental-fee">
        <Input id="rental-fee" value={value.monthlyFee} onChange={set("monthlyFee")} inputMode="numeric" placeholder="예: 32900" className={FIELD_INPUT} />
      </Field>
      <Field label="결제일 (매월)" htmlFor="rental-billing-day">
        <Input id="rental-billing-day" value={value.billingDay} onChange={set("billingDay")} inputMode="numeric" placeholder="1~31" className={FIELD_INPUT} />
      </Field>

      <Field label="계약 시작일" htmlFor="rental-contract-start">
        <Input id="rental-contract-start" type="date" value={value.contractStartDate} onChange={set("contractStartDate")} className={FIELD_INPUT} />
      </Field>
      <Field label="약정 만료일" htmlFor="rental-obligation-end">
        <Input id="rental-obligation-end" type="date" value={value.obligationEndDate} onChange={set("obligationEndDate")} className={FIELD_INPUT} />
      </Field>

      <Field label="소유권 이전 만료일" htmlFor="rental-transfer" className="sm:col-span-2">
        <Input id="rental-transfer" type="date" value={value.ownershipTransferDate} onChange={set("ownershipTransferDate")} className={cn(FIELD_INPUT, "sm:max-w-[calc(50%-0.375rem)]")} />
      </Field>

      <div className="space-y-1 sm:col-span-2">
        <span id="rental-care-label" className={LABEL}>
          케어 방식
        </span>
        <div role="radiogroup" aria-labelledby="rental-care-label" className="flex flex-wrap gap-2">
          {CARE_TYPES.map((c) => {
            const active = value.careType === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ careType: c })}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                {CARE_LABEL[c]}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="제휴카드 메모" htmlFor="rental-card-note" className="sm:col-span-2">
        <Input id="rental-card-note" value={value.paymentCardNote} onChange={set("paymentCardNote")} placeholder="예: KB국민 30만원 실적 시 월 1만원 할인" maxLength={200} className={FIELD_INPUT} />
      </Field>
    </fieldset>
  );
}
