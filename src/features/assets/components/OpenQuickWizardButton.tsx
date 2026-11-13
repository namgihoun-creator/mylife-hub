"use client";

import { Zap } from "lucide-react";
import { OPEN_QUICK_WIZARD_EVENT } from "./QuickApplianceWizardModal";

/** Empty-state CTA: opens the page's single QuickApplianceWizardModal instance. */
export function OpenQuickWizardButton() {
  return (
    <button
      type="button"
      data-testid="quick-wizard-empty-cta"
      onClick={() => window.dispatchEvent(new Event(OPEN_QUICK_WIZARD_EVENT))}
      className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-50 px-5 text-sm font-bold text-sky-700 shadow-sm transition-all hover:bg-sky-100 active:scale-95 dark:bg-sky-950/40 dark:text-sky-300"
    >
      <Zap size={16} strokeWidth={2.5} aria-hidden /> 기본 가전 1분 세팅
    </button>
  );
}
