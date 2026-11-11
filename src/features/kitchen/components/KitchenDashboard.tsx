"use client";

import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, PawPrint, Plus, Refrigerator } from "lucide-react";
import { GRADIENT_CTA, GRADIENT_CTA_MINT } from "@/shared/components/ui/gradient-cta";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import { PET_TYPES, PET_TYPE_LABEL, type KitchenDashboardData, type KitchenItem, type PetType } from "../schemas/kitchen.schema";
import type { KitchenBudgetData } from "../server/kitchen-budget.actions";
import { setKitchenPetType } from "../server/kitchen.actions";
import { DefrostGuideDialog } from "./DefrostGuideDialog";
import { AiChefSection } from "./AiChefSection";
import { KitchenBudgetCard } from "./KitchenBudgetCard";
import { KitchenItemCard } from "./KitchenItemCard";
import { KitchenItemFormDialog, type KitchenFormTarget } from "./KitchenItemFormDialog";
import { KitchenPulse } from "./KitchenPulse";
import { LocalLifeRadar } from "./LocalLifeRadar";
import { PetToxicAlertBanner } from "./PetToxicAlertBanner";
import { SmartCheckoutBar } from "./SmartCheckoutBar";
import { SmartCheckoutDialog } from "./SmartCheckoutDialog";
import { SnapIngestDialog } from "./SnapIngestDialog";
import { StorageTabs, type StorageFilter } from "./StorageTabs";

/** Household pet setting: it switches the toxic-food banner and per-card warnings on. */
function PetTypeSelect({ value }: { value: PetType }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="pet-setting">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        <PawPrint className="h-3.5 w-3.5" aria-hidden /> 반려동물
      </span>
      <div role="radiogroup" aria-label="반려동물 종류" className="flex flex-wrap gap-1.5">
        {PET_TYPES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            disabled={pending}
            data-pet={p}
            onClick={() => startTransition(async () => { await setKitchenPetType({ petType: p }); })}
            className={cn(
              "h-7 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-60",
              value === p
                ? "border-zinc-900 text-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:text-zinc-50 dark:ring-zinc-100"
                : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700",
            )}
          >
            {PET_TYPE_LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function KitchenDashboard({ data, budget }: { data: KitchenDashboardData; budget: KitchenBudgetData | null }) {
  const { today, profile, items, stats, toxicItems } = data;
  const [tab, setTab] = useState<StorageFilter>("ALL");
  const [form, setForm] = useState<KitchenFormTarget | null>(null);
  const [fossilItem, setFossilItem] = useState<KitchenItem | null>(null);
  const [snapOpen, setSnapOpen] = useState(false);
  const [checkoutText, setCheckoutText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const showNotice = (m: string) => {
    setNotice(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  };

  const counts = useMemo(
    () => ({ ALL: items.length, FRIDGE: items.filter((i) => i.storage_type === "FRIDGE").length, FREEZER: items.filter((i) => i.storage_type === "FREEZER").length, ROOM_TEMP: items.filter((i) => i.storage_type === "ROOM_TEMP").length }),
    [items],
  );
  const shown = tab === "ALL" ? items : items.filter((i) => i.storage_type === tab);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">키친</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-400">냉장고 속 재료를 기한 전에 먹고, 아낀 돈을 모아요.</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <ContextHelpButton topic="zero_typing" />
          <button
            type="button"
            data-testid="snap-open"
            onClick={() => setSnapOpen(true)}
            className={GRADIENT_CTA_MINT}
          >
            <Camera size={18} strokeWidth={2.5} aria-hidden /> 찰칵 입고
          </button>
          <button
            type="button"
            data-testid="add-item"
            onClick={() => setForm({ mode: "create" })}
            className={GRADIENT_CTA}
          >
            <Plus size={18} strokeWidth={2.5} aria-hidden /> 재료 추가
          </button>
        </div>
      </div>

      <SmartCheckoutBar onSubmit={setCheckoutText} />

      <PetToxicAlertBanner petType={profile.pet_type} toxicItems={toxicItems} />
      <KitchenPulse stats={stats} profile={profile} />
      {budget && <KitchenBudgetCard data={budget} onNotice={showNotice} />}
      <AiChefSection petType={profile.pet_type} itemCount={items.length} onNotice={showNotice} />

      {notice && (
        <p role="status" data-testid="kitchen-notice" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <StorageTabs value={tab} onChange={setTab} counts={counts} />
          </div>
          <ContextHelpButton topic="smart_stock" />
        </div>
        <PetTypeSelect value={profile.pet_type} />
      </div>

      {items.length === 0 ? (
        <div data-testid="kitchen-empty">
          <EmptyState icon={Refrigerator} title="냉장고가 비어 있어요" description="재료를 추가하면 소비기한에 맞춰 먼저 먹을 순서를 알려드려요." />
        </div>
      ) : shown.length === 0 ? (
        <p data-testid="tab-empty" className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-xs font-normal text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          이 보관 장소에는 재료가 없어요.
        </p>
      ) : (
        <ul data-testid="kitchen-list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((it) => (
            <li key={it.id} className="min-w-0">
              <KitchenItemCard item={it} today={today} petType={profile.pet_type} onEdit={(i) => setForm({ mode: "edit", item: i })} onFossil={setFossilItem} onNotice={showNotice} />
            </li>
          ))}
        </ul>
      )}

      <LocalLifeRadar petType={profile.pet_type} />

      <KitchenItemFormDialog target={form} today={today} petType={profile.pet_type} onClose={() => setForm(null)} onNotice={showNotice} />
      <DefrostGuideDialog item={fossilItem} today={today} onClose={() => setFossilItem(null)} />
      <SnapIngestDialog open={snapOpen} today={today} onClose={() => setSnapOpen(false)} onNotice={showNotice} />
      <SmartCheckoutDialog text={checkoutText} onClose={() => setCheckoutText(null)} onNotice={showNotice} />
    </div>
  );
}
