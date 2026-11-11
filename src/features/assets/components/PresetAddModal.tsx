"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { formatRecurrence } from "@/shared/lib/recurrence";
import { Collapse } from "@/shared/components/ui/collapse";
import { addAssetFromPreset } from "../server/asset.actions";
import type { OwnershipType } from "../schemas/asset.schema";
import { OwnershipToggle, RentalForm, emptyRentalForm, toRentalInput, type RentalFormState } from "./RentalForm";
import type { AppliancePreset } from "../schemas/asset.schema";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";

export const OPEN_PRESET_MODAL_EVENT = "mylife:open-preset-modal";

const PILL_BASE = "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors";
const PILL_ACTIVE = "bg-sky-600 text-white dark:bg-sky-500 dark:text-white";
const PILL_INACTIVE =
  "bg-white text-slate-600 hover:bg-slate-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function PresetAddModal({
  presets,
  triggerLabel = "가전 추가",
}: {
  presets: AppliancePreset[] | null;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("전체");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<OwnershipType>("OWNED");
  const [rental, setRental] = useState<RentalFormState>(emptyRentalForm);
  const [, startTransition] = useTransition();

  // The empty-state CTA lives elsewhere in the tree and opens this single instance via an event, so the
  // dialog is never remounted (and closed) when the page switches from the empty state to the asset grid.
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_PRESET_MODAL_EVENT, openIt);
    return () => window.removeEventListener(OPEN_PRESET_MODAL_EVENT, openIt);
  }, []);

  const categories = useMemo(
    () => ["전체", ...Array.from(new Set((presets ?? []).map((p) => p.category)))],
    [presets],
  );
  const filtered = useMemo(
    () =>
      (presets ?? []).filter(
        (p) =>
          (category === "전체" || p.category === category) &&
          p.name_ko.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [presets, category, query],
  );

  // 1 click = asset + recommended task_rules (+ first task of each rule). Same server action as before.
  function add(presetKey: string) {
    if (pendingKey) return;
    setError(null);

    // Rental: the details panel above applies to every appliance added while "렌탈·구독" is selected.
    let payload: Parameters<typeof addAssetFromPreset>[0] = { presetKey, visibility: "FAMILY", ownershipType: "OWNED" };
    if (ownership === "RENTAL") {
      const parsed = toRentalInput(rental);
      if (!parsed.ok) return setError(parsed.error);
      payload = { presetKey, visibility: "FAMILY", ownershipType: "RENTAL", rental: parsed.value };
    }

    setPendingKey(presetKey);
    startTransition(async () => {
      const res = await addAssetFromPreset(payload);
      setPendingKey(null);
      if (!res.ok) return setError(res.error);
      setAddedCount((prev) => ({ ...prev, [presetKey]: (prev[presetKey] ?? 0) + 1 }));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
        >
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl bg-white dark:bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-800 dark:text-zinc-200">
            생활가전 프리셋으로 추가
          </DialogTitle>
          <DialogDescription className="text-xs font-normal text-slate-500 dark:text-zinc-400">
            가전을 누르면 자산과 추천 소모품 관리 규칙이 한 번에 등록돼요.
          </DialogDescription>
        </DialogHeader>

        {presets === null ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-zinc-800 dark:text-zinc-400">
            프리셋 데이터가 없어요. Supabase SQL Editor에서 <code>supabase/seeds/01_appliance_presets.sql</code>을
            실행해 주세요.
          </p>
        ) : (
          <>
            <div>
              <OwnershipToggle
                value={ownership}
                onChange={(v) => {
                  setOwnership(v);
                  setError(null);
                }}
              />
              {/* Rental details expand only for "렌탈·구독" (height + opacity transition, inert while collapsed). */}
              <Collapse open={ownership === "RENTAL"}>
                <RentalForm value={rental} onChange={(patch) => setRental((prev) => ({ ...prev, ...patch }))} />
              </Collapse>
              {error && (
                <p role="alert" className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="가전 검색 (예: 정수기)"
                  aria-label="가전 검색"
                  className="h-10 w-full rounded-2xl bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-zinc-900 dark:placeholder:text-zinc-500 shadow-sm"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(PILL_BASE, category === c ? PILL_ACTIVE : PILL_INACTIVE)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <ul className="grid max-h-[45vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filtered.map((p) => {
                const count = addedCount[p.preset_key] ?? 0;
                const busy = pendingKey === p.preset_key;
                const { icon: Icon, tone } = getApplianceVisual(p.preset_key);
                return (
                  <li key={p.preset_key}>
                    <button
                      type="button"
                      onClick={() => add(p.preset_key)}
                      disabled={pendingKey !== null}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-3xl bg-white p-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800 shadow-sm",
                        count > 0 && "border-emerald-200 dark:border-emerald-900",
                      )}
                    >
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tone)}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-zinc-50">
                          {p.name_ko}
                        </span>
                        <span className="block text-[11px] font-normal text-slate-500 dark:text-zinc-400">
                          {p.default_space}
                        </span>
                        {p.default_tasks[0] && (
                          <span className="block truncate text-[11px] font-normal text-slate-500 dark:text-zinc-400">
                            {p.default_tasks[0].title} ·{" "}
                            {formatRecurrence(p.default_tasks[0].recurring_type, p.default_tasks[0].interval_n)}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-slate-400 dark:text-zinc-500">
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <Check className="h-3 w-3" />
                            {count}
                          </span>
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="col-span-full py-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                  검색 결과가 없어요.
                </li>
              )}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
