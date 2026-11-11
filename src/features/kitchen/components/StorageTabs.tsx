"use client";

import { cn } from "@/shared/lib/utils";
import { STORAGE_LABEL, STORAGE_TYPES, type StorageType } from "../rules/shelf-life";

export type StorageFilter = "ALL" | StorageType;

/** [전체 | 냉장 | 냉동 | 실온] 1px-border segmented control with per-tab counts. */
export function StorageTabs({ value, onChange, counts }: { value: StorageFilter; onChange: (v: StorageFilter) => void; counts: Record<StorageFilter, number> }) {
  const tabs: { key: StorageFilter; label: string }[] = [{ key: "ALL", label: "전체" }, ...STORAGE_TYPES.map((s) => ({ key: s, label: STORAGE_LABEL[s] }))];
  return (
    <div role="radiogroup" aria-label="보관 장소" data-testid="storage-tabs" className="inline-flex max-w-full rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
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
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
              active
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
            )}
          >
            {t.label}
            <span className={cn("tabular-nums", active ? "text-white/70 dark:text-black/60" : "text-zinc-400 dark:text-zinc-500")}>{counts[t.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
