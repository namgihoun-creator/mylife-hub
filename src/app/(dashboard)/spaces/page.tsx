import type { Metadata } from "next";
import { AlertTriangle, Sofa } from "lucide-react";
import { getSessionProfile } from "@/features/auth/server/session";
import { NewSpaceDialog } from "@/features/spaces/components/NewSpaceDialog";
import { SpaceCard } from "@/features/spaces/components/SpaceCard";
import { getSpacesList } from "@/features/spaces/server/space.actions";
import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";
import { EmptyState } from "@/shared/components/ui/empty-state";

export const metadata: Metadata = { title: "공간 플래너" };

// Auth is enforced by (dashboard)/layout.tsx and the middleware; RLS limits every query to this household.
export default async function SpacesPage() {
  const [{ profile }, res] = await Promise.all([getSessionProfile(), getSpacesList()]);
  const householdId = profile?.householdId ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">공간 플래너</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-400">우리 집 공간을 재고, 딱 맞는 가구를 부부가 함께 골라요.</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <ContextHelpButton topic="space_planner" />
          <NewSpaceDialog householdId={householdId} />
        </div>
      </div>

      {!res.ok ? (
        <EmptyState icon={AlertTriangle} title="공간 목록을 불러오지 못했어요" description={res.error} />
      ) : res.spaces.length === 0 ? (
        <EmptyState
          icon={Sofa}
          title="아직 등록한 공간이 없어요"
          description="거실 소파 자리, 안방 창가처럼 가구를 놓고 싶은 공간을 등록하고 사진 위에 치수를 재 보세요."
        />
      ) : (
        <ul data-testid="space-grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.spaces.map((s) => (
            <SpaceCard key={s.id} space={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
