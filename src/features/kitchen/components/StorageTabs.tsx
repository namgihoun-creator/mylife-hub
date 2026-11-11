"use client";

import { cn } from "@/shared/lib/utils";
import { STORAGE_LABEL, STORAGE_TYPES, type StorageType } from "../rules/shelf-life";

export type StorageFilter = "ALL" | StorageType;

/** [전체 | 냉장 | 냉동 | 실온] big round chips (44px touch targets) that swipe sideways on small screens. */
export function StorageTabs({ value, onChange, counts }: { value: StorageFilter; onChange: (v: StorageFilter) => void; counts: Record<StorageFilter, number> }) {
  const tabs: { key: StorageFilter; label: string }[] = [{ key: "ALL", label: "전체" }, ...STORAGE_TYPES.map((s) => ({ key: s, label: STORAGE_LABEL[s] }))];
  return (
    <div role="radiogroup" aria-label="보관 장소" data-testid="storage-tabs" className="flex max-w-full snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid="storage-tab"
            data-tab={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full px-5 text-sm font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 motion-reduce:transform-none",
              active
                ? "bg-sky-600 text-white shadow-md dark:bg-sky-500 dark:text-white"
                : "bg-white text-slate-600 shadow-sm hover:bg-sky-50 hover:text-sky-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400")}>{counts[t.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
