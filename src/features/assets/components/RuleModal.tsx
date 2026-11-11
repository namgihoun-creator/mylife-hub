"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { toSeoulDate } from "@/shared/lib/recurrence";
import { RULE_RECURRING, RULE_RECURRING_LABEL, type RuleRecurring } from "../schemas/rule.schema";
import type { Asset, AssetRule } from "../schemas/asset.schema";
import { createTaskRule, updateRuleConsumable } from "../server/rule.actions";

const LABEL = "text-xs font-medium text-zinc-700 dark:text-zinc-300";
const HINT = "text-[11px] font-normal text-zinc-500 dark:text-zinc-400";
const SELECT =
  "h-10 w-full rounded-2xl bg-white px-3 text-sm text-zinc-900 focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:bg-black dark:text-zinc-50 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100 shadow-sm";

export type RuleModalTarget = { mode: "create" } | { mode: "edit"; rule: AssetRule };

function RuleForm({ asset, target, onClose }: { asset: Asset; target: RuleModalTarget; onClose: () => void }) {
  const editing = target.mode === "edit" ? target.rule : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [recurring, setRecurring] = useState<RuleRecurring>("MONTHLY");
  const [interval, setInterval] = useState("1");
  const [firstDue, setFirstDue] = useState(() => toSeoulDate(new Date().toISOString()));
  const [name, setName] = useState(editing?.consumable_name ?? "");
  const [model, setModel] = useState(editing?.consumable_model ?? "");
  const [url, setUrl] = useState(editing?.custom_purchase_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const consumable = { consumableName: name || null, consumableModel: model || null, customPurchaseUrl: url || null };
      const res = editing
        ? await updateRuleConsumable({ ruleId: editing.id, ...consumable })
        : await createTaskRule({ assetId: asset.id, title, recurringType: recurring, intervalN: Number(interval), firstDueDate: firstDue, ...consumable });
      if (!res.ok) return setError(res.error);
      onClose();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {editing ? (
        <div className="space-y-1">
          <span className={LABEL}>규칙</span>
          <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-medium text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-50">{editing.title}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor="rule-title" className={LABEL}>
              규칙 이름 <span className="text-rose-500">*</span>
            </label>
            <Input id="rule-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="예: 필터 교체" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="rule-interval" className={LABEL}>
                반복 주기
              </label>
              <div className="flex gap-2">
                <Input id="rule-interval" type="number" inputMode="numeric" min={1} max={120} value={interval} onChange={(e) => setInterval(e.target.value)} className="w-16 shrink-0 px-2" />
                <select aria-label="반복 단위" value={recurring} onChange={(e) => setRecurring(e.target.value as RuleRecurring)} className={SELECT}>
                  {RULE_RECURRING.map((r) => (
                    <option key={r} value={r}>
                      {RULE_RECURRING_LABEL[r]}마다
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="rule-first-due" className={LABEL}>
                첫 예정일
              </label>
              <Input id="rule-first-due" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <fieldset className="space-y-3 rounded-xl p-3 bg-slate-100 dark:bg-zinc-800">
        <legend className="px-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          소모품 정보 <span className="font-normal text-zinc-500 dark:text-zinc-400">(선택)</span>
        </legend>
        <div className="space-y-1">
          <label htmlFor="rule-consumable-name" className={LABEL}>
            소모품 이름
          </label>
          <Input id="rule-consumable-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="예: 복합 일체형 필터" />
        </div>
        <div className="space-y-1">
          <label htmlFor="rule-consumable-model" className={LABEL}>
            모델명 · 규격
          </label>
          <Input id="rule-consumable-model" value={model} onChange={(e) => setModel(e.target.value)} maxLength={100} placeholder="예: CFX-G100D" className="font-mono" />
        </div>
        <div className="space-y-1">
          <label htmlFor="rule-purchase-url" className={LABEL}>
            구매 링크
          </label>
          <Input id="rule-purchase-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} placeholder="https://" />
          <p className={HINT}>비워 두면 모델명으로 네이버 쇼핑·다나와 최저가를 검색해요.</p>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-xl px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-slate-200 dark:text-zinc-100 dark:hover:bg-zinc-700 bg-slate-100 dark:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? "저장" : "규칙 추가"}
        </button>
      </div>
    </form>
  );
}

/** 규칙 생성 / 소모품 수정 모달. Mounted form = fresh state on every opening. */
export function RuleModal({ asset, target, onClose }: { asset: Asset; target: RuleModalTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>{target?.mode === "edit" ? "소모품 정보 수정" : "관리 규칙 추가"}</DialogTitle>
          <DialogDescription>
            {asset.name}
            {target?.mode === "edit" ? " · 아직 끝내지 않은 과업에도 함께 반영돼요." : " · 첫 과업이 함께 만들어져요."}
          </DialogDescription>
        </DialogHeader>
        {target && <RuleForm asset={asset} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
