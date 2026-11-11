"use client";

import { Plus } from "lucide-react";
import { GRADIENT_CTA } from "@/shared/components/ui/gradient-cta";
import { OPEN_PRESET_MODAL_EVENT } from "./PresetAddModal";

/** Primary CTA for the empty state: opens the page's single PresetAddModal instance. */
export function OpenPresetModalButton({ label = "가전 추가" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PRESET_MODAL_EVENT))}
      className={GRADIENT_CTA}
    >
      <Plus size={18} strokeWidth={2.5} aria-hidden />
      {label}
    </button>
  );
}
