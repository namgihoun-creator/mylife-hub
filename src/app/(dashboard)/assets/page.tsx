import type { Metadata } from "next";
import { getSessionProfile } from "@/features/auth/server/session";
import { getAssets, getPresets } from "@/features/assets/server/asset.queries";
import { AssetList } from "@/features/assets/components/AssetList";
import { AssetSummaryBanner } from "@/features/assets/components/AssetSummaryBanner";
import { OpenPresetModalButton } from "@/features/assets/components/OpenPresetModalButton";
import { PresetAddModal } from "@/features/assets/components/PresetAddModal";
import { summarizeAssets } from "@/features/assets/utils/asset-summary";
import { toSeoulDate } from "@/shared/lib/recurrence";

export const metadata: Metadata = { title: "자산 관리" };

export default async function AssetsPage() {
  const [{ profile }, assets, presets] = await Promise.all([getSessionProfile(), getAssets(), getPresets()]);
  const today = toSeoulDate(new Date().toISOString());
  const isAdmin = profile?.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">자산 관리</h1>
          <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">
            우리 집 가전과 소모품 교체 주기를 한눈에 확인해요.
          </p>
        </div>
        {/* Always rendered at this position: one stable modal instance for both empty and filled states. */}
        {isAdmin && <PresetAddModal presets={presets} />}
      </div>

      {assets.length > 0 && <AssetSummaryBanner summary={summarizeAssets(assets, today)} />}
      <AssetList assets={assets} today={today} canEdit={isAdmin} emptyAction={isAdmin ? <OpenPresetModalButton /> : null} />
    </div>
  );
}
