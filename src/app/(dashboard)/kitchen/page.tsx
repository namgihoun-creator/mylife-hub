import type { Metadata } from "next";
import { KitchenDashboard } from "@/features/kitchen/components/KitchenDashboard";
import { getKitchenDashboardData } from "@/features/kitchen/server/kitchen.actions";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "키친" };

// Auth is enforced by (dashboard)/layout.tsx and the middleware; RLS limits every query to this household.
export default async function KitchenPage() {
  const res = await getKitchenDashboardData();
  if (!res.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">키친</h1>
        <EmptyState icon={AlertTriangle} title="키친 정보를 불러오지 못했어요" description={res.error} />
      </div>
    );
  }
  return <KitchenDashboard data={res.data} />;
}
