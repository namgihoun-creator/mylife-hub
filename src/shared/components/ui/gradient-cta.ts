// Trendy gradient call-to-action buttons (docs/DESIGN_SYSTEM.md v4): colour volume from a soft same-hue glow, 44px touch target,
// tactile press. Used for the main "add" actions (자산 가전 추가, 키친 재료 추가 / 찰칵 입고).
const BASE =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-5 py-2.5 text-sm font-bold tracking-tight text-white transition-all duration-200 active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950";

/** Primary: Sky → Blue. */
export const GRADIENT_CTA = `${BASE} bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-md shadow-sky-500/25 hover:shadow-lg hover:shadow-sky-500/35`;

/** Companion action next to a primary one (e.g. 찰칵 입고): Teal → Emerald, same shape and weight. */
export const GRADIENT_CTA_MINT = `${BASE} bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 shadow-md shadow-teal-500/25 hover:shadow-lg hover:shadow-teal-500/35`;
