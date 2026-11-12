import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { SpaceWorkspace } from "@/features/spaces/components/SpaceWorkspace";
import { getSpaceDetail } from "@/features/spaces/server/space.actions";
import { EmptyState } from "@/shared/components/ui/empty-state";

export const metadata: Metadata = { title: "공간 플래너" };

export default async function SpaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getSpaceDetail(id);
  if (!res.ok) {
    if (res.error === "공간을 찾을 수 없어요.") notFound();
    return <EmptyState icon={AlertTriangle} title="공간을 불러오지 못했어요" description={res.error} />;
  }
  return <SpaceWorkspace detail={res.detail} />;
}
