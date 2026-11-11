"use client";

import { useState } from "react";
import { ExternalLink, ShieldAlert, Siren } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import type { KitchenDashboardData, PetType } from "../schemas/kitchen.schema";
import { PET_TYPE_LABEL } from "../schemas/kitchen.schema";

const VET_SEARCH = `https://map.naver.com/p/search/${encodeURIComponent("24시 동물병원")}`;

/** What can hurt a pet in the kitchen. General household guidance — not veterinary advice. */
const TOXINS: { foods: string; why: string }[] = [
  { foods: "양파 · 대파 · 쪽파 · 마늘 · 부추", why: "적혈구를 손상시켜 빈혈을 일으킬 수 있어요. 익히거나 가루여도 위험해요." },
  { foods: "초콜릿 · 코코아 · 커피", why: "구토·떨림·심장 두근거림을 일으킬 수 있어요. 카카오 함량이 높을수록 위험해요." },
  { foods: "포도 · 건포도", why: "급성 신장 손상 위험이 있어요. 소량도 위험할 수 있어요." },
  { foods: "자일리톨 (무설탕 껌·사탕)", why: "급격한 저혈당과 간 손상을 일으킬 수 있어요." },
  { foods: "아보카도 · 마카다미아 · 술", why: "구토·설사, 떨림, 중추신경 억제를 일으킬 수 있어요." },
];

function EmergencyDialog({ open, onOpenChange, foods, pet }: { open: boolean; onOpenChange: (v: boolean) => void; foods: string[]; pet: PetType }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pet-emergency-dialog" className="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <Siren className="h-5 w-5" aria-hidden /> 24시 응급 대처법
          </DialogTitle>
          <DialogDescription>
            {PET_TYPE_LABEL[pet]}이(가) 위험한 음식을 먹었을 수 있다면 지금 바로 아래 순서로 움직이세요.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
          {[
            "더 먹지 못하게 치우고, 입 안에 남은 음식이 있으면 조심해서 빼 주세요.",
            "무엇을, 얼마나, 몇 시쯤 먹었는지와 체중을 메모하고 포장지·남은 음식을 챙기세요.",
            "증상이 없어도 바로 24시 동물병원에 전화해 상담하세요. 증상은 몇 시간 뒤에 나타나기도 해요.",
            "수의사가 시키지 않았다면 억지로 토하게 하거나 사람 약·소금물을 먹이지 마세요.",
          ].map((t, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-rose-200 text-[11px] font-semibold tabular-nums text-rose-700 dark:border-rose-900 dark:text-rose-300">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        <a
          href={VET_SEARCH}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="vet-search-link"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 dark:bg-rose-500 dark:text-black dark:hover:bg-rose-400"
        >
          24시 동물병원 찾기 <ExternalLink className="h-4 w-4" aria-hidden />
        </a>

        {foods.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/60 dark:bg-rose-950/30">
            <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">지금 우리 집 냉장고에 있는 위험 재료</p>
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{foods.join(" · ")}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">대표적인 위험 음식</p>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {TOXINS.map((t) => (
              <li key={t.foods} className="space-y-0.5 px-3 py-2">
                <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{t.foods}</p>
                <p className="text-[11px] font-normal text-zinc-600 dark:text-zinc-400">{t.why}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">일반적인 안내이며 수의학적 진단이나 치료를 대신하지 않아요. 의심되면 지체 없이 동물병원에 문의하세요.</p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rose, high-contrast alert shown ONLY when the household has a pet AND something toxic to pets is in the kitchen.
 * Renders nothing otherwise. The button opens the 24-hour emergency dialog.
 */
export function PetToxicAlertBanner({ petType, toxicItems }: { petType: PetType; toxicItems: KitchenDashboardData["toxicItems"] }) {
  const [open, setOpen] = useState(false);
  if (petType === "none" || toxicItems.length === 0) return null;

  const names = [...new Set(toxicItems.map((t) => t.name))];
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` 외 ${names.length - 3}개` : "");

  return (
    <>
      <div
        role="alert"
        data-testid="pet-toxic-banner"
        className="flex flex-col gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white dark:bg-rose-500 dark:text-black">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{PET_TYPE_LABEL[petType]}에게 위험한 재료가 있어요</p>
            <p data-testid="pet-toxic-names" className="mt-0.5 break-words text-xs font-medium text-rose-700 dark:text-rose-300">
              {shown} — 반려동물이 닿지 않는 곳에 보관하세요.
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="pet-emergency-open"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 dark:bg-rose-500 dark:text-black dark:hover:bg-rose-400"
        >
          <Siren className="h-4 w-4" aria-hidden /> 응급 대처법
        </button>
      </div>
      <EmergencyDialog open={open} onOpenChange={setOpen} foods={names} pet={petType} />
    </>
  );
}
