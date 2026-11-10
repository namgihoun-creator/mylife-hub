import {
  AirVent,
  BedDouble,
  BellRing,
  Bot,
  Coffee,
  CookingPot,
  Droplet,
  Droplets,
  Fan,
  Flame,
  Heater,
  KeyRound,
  Microwave,
  Package,
  Refrigerator,
  ShowerHead,
  Shirt,
  Sparkles,
  Tv,
  Utensils,
  WashingMachine,
  Wind,
  type LucideIcon,
} from "lucide-react";

export type ApplianceVisual = { icon: LucideIcon; tone: string };

// Complete class strings (Tailwind JIT) — pastel icon-box tones from docs/DESIGN_SYSTEM.md.
const TONE = {
  sky: "bg-sky-50 text-sky-500 ring-1 ring-inset ring-sky-100 shadow-sm dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-900/50",
  amber: "bg-amber-50 text-amber-500 ring-1 ring-inset ring-amber-100 shadow-sm dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/50",
  rose: "bg-rose-50 text-rose-500 ring-1 ring-inset ring-rose-100 shadow-sm dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-900/50",
  emerald: "bg-emerald-50 text-emerald-500 ring-1 ring-inset ring-emerald-100 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900/50",
  violet: "bg-violet-50 text-violet-500 ring-1 ring-inset ring-violet-100 shadow-sm dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-900/50",
  orange: "bg-orange-50 text-orange-500 ring-1 ring-inset ring-orange-100 shadow-sm dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-900/50",
  cyan: "bg-cyan-50 text-cyan-500 ring-1 ring-inset ring-cyan-100 shadow-sm dark:bg-cyan-950/40 dark:text-cyan-400 dark:ring-cyan-900/50",
  slate: "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200/70 shadow-sm dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700/60",
} as const;

/** Single source of truth: preset_key -> icon + tone. Unknown keys fall back to Package/slate. */
const MAP: Record<string, ApplianceVisual> = {
  // 주방가전
  refrigerator: { icon: Refrigerator, tone: TONE.sky },
  kimchi_refrigerator: { icon: Refrigerator, tone: TONE.rose },
  dishwasher: { icon: Utensils, tone: TONE.cyan },
  induction: { icon: CookingPot, tone: TONE.orange },
  water_purifier: { icon: Droplets, tone: TONE.sky },
  microwave: { icon: Microwave, tone: TONE.amber },
  rice_cooker: { icon: CookingPot, tone: TONE.amber },
  coffee_machine: { icon: Coffee, tone: TONE.orange },
  air_fryer: { icon: Flame, tone: TONE.orange },
  range_hood: { icon: AirVent, tone: TONE.slate },
  electric_kettle: { icon: Coffee, tone: TONE.amber },
  gas_range: { icon: Flame, tone: TONE.rose },
  // 생활·환경가전
  washer: { icon: WashingMachine, tone: TONE.sky },
  dryer: { icon: Wind, tone: TONE.violet },
  aircon: { icon: AirVent, tone: TONE.cyan },
  air_purifier: { icon: Wind, tone: TONE.emerald },
  dehumidifier: { icon: Droplets, tone: TONE.cyan },
  humidifier: { icon: Droplet, tone: TONE.sky },
  robot_vacuum: { icon: Bot, tone: TONE.violet },
  cordless_vacuum: { icon: Sparkles, tone: TONE.violet },
  styler: { icon: Shirt, tone: TONE.rose },
  boiler: { icon: Flame, tone: TONE.orange },
  bidet: { icon: ShowerHead, tone: TONE.cyan },
  tv: { icon: Tv, tone: TONE.slate },
  // 계절·기타가전
  electric_fan: { icon: Fan, tone: TONE.emerald },
  air_circulator: { icon: Fan, tone: TONE.cyan },
  electric_heater: { icon: Heater, tone: TONE.orange },
  electric_blanket: { icon: BedDouble, tone: TONE.rose },
  door_lock: { icon: KeyRound, tone: TONE.slate },
  smoke_detector: { icon: BellRing, tone: TONE.amber },
};

const FALLBACK: ApplianceVisual = { icon: Package, tone: TONE.slate };

export function getApplianceVisual(presetKey: string | null | undefined): ApplianceVisual {
  return (presetKey && MAP[presetKey]) || FALLBACK;
}
