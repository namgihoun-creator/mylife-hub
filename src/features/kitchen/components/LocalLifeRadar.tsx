import { ExternalLink, PawPrint, ShoppingCart, Siren, Stethoscope, Store, Sprout } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { PetType } from "../schemas/kitchen.schema";

const KAKAO_SEARCH = "https://m.map.kakao.com/actions/searchView?q=";
export const kakaoSearchUrl = (query: string) => `${KAKAO_SEARCH}${encodeURIComponent(query)}`;

type Chip = { id: string; label: string; query: string; icon: LucideIcon; urgent?: boolean };
export const HUMAN_CHIPS: readonly Chip[] = [
  { id: "mart", label: "대형마트", query: "대형마트", icon: ShoppingCart },
  { id: "market", label: "전통시장", query: "전통시장", icon: Sprout },
  { id: "cvs", label: "24시 편의점", query: "24시 편의점", icon: Store },
];
export const PET_CHIPS: readonly Chip[] = [
  { id: "vet24", label: "24시 동물병원", query: "24시 동물병원", icon: Siren, urgent: true },
  { id: "vet", label: "동네 동물병원", query: "동물병원", icon: Stethoscope },
  { id: "petshop", label: "펫용품점", query: "반려동물용품", icon: PawPrint },
];

function ChipLink({ c, tone }: { c: Chip; tone: "mint" | "coral" }) {
  const Icon = c.icon;
  return (
    <a
      href={kakaoSearchUrl(c.query)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="radar-chip"
      data-chip={c.id}
      className={cn(
        "inline-flex min-h-12 shrink-0 snap-start items-center gap-2 rounded-2xl px-4 text-sm font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 motion-reduce:transform-none",
        c.urgent
          ? "bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
          : tone === "coral"
            ? "bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-950/70"
            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden /> {c.label}
      <ExternalLink className="h-3.5 w-3.5 opacity-50" aria-hidden />
    </a>
  );
}

/**
 * 동네 생활 레이더: one-tap Kakao Map searches (new tab). Plain links, so they work without JavaScript and the page never
 * asks for — or stores — the visitor's location: Kakao's own map page asks for it when it needs to centre the results.
 * Big round chips swipe sideways on phones. Pet shortcuts appear only for households with a pet.
 */
export function LocalLifeRadar({ petType }: { petType: PetType }) {
  const row = "flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden";
  return (
    <section aria-label="동네 생활 레이더" data-testid="local-radar" className="space-y-4 rounded-3xl bg-white p-5 shadow-sm dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-base font-extrabold text-slate-900 dark:text-zinc-50">동네 생활 레이더</h2>
        <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">카카오맵에서 내 주변을 바로 찾아봐요.</p>
      </div>
      <div className="space-y-2.5">
        <div className={row} data-testid="radar-human">{HUMAN_CHIPS.map((c) => <ChipLink key={c.id} c={c} tone="mint" />)}</div>
        {petType !== "none" && <div className={row} data-testid="radar-pet">{PET_CHIPS.map((c) => <ChipLink key={c.id} c={c} tone="coral" />)}</div>}
      </div>
    </section>
  );
}
