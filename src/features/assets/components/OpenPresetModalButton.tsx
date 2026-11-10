"use client";

import { Plus } from "lucide-react";
import { OPEN_PRESET_MODAL_EVENT } from "./PresetAddModal";

/** Primary CTA for the empty state: opens the page's single PresetAddModal instance. */
export function OpenPresetModalButton({ label = "가전 추가" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PRESET_MODAL_EVENT))}
      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}
