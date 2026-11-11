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

function ChipLink({ c }: { c: Chip }) {
  const Icon = c.icon;
  return (
    <a
      href={kakaoSearchUrl(c.query)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="radar-chip"
      data-chip={c.id}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        c.urgent
          ? "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
          : "border-zinc-200 text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {c.label}
      <ExternalLink className="h-3 w-3 opacity-50" aria-hidden />
    </a>
  );
}

/**
 * 동네 생활 레이더: one-tap Kakao Map searches (new tab). Plain links, so they work without JavaScript and the page never
 * asks for — or stores — the visitor's location: Kakao's own map page asks for it when it needs to centre the results.
 * Pet shortcuts appear only for households with a pet.
 */
export function LocalLifeRadar({ petType }: { petType: PetType }) {
  return (
    <section aria-label="동네 생활 레이더" data-testid="local-radar" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">동네 생활 레이더</h2>
        <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">카카오맵에서 내 주변을 바로 찾아봐요.</p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" data-testid="radar-human">{HUMAN_CHIPS.map((c) => <ChipLink key={c.id} c={c} />)}</div>
        {petType !== "none" && <div className="flex flex-wrap gap-2" data-testid="radar-pet">{PET_CHIPS.map((c) => <ChipLink key={c.id} c={c} />)}</div>}
      </div>
    </section>
  );
}
