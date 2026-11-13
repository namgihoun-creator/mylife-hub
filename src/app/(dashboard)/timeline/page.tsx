import type { Metadata } from "next";
import { getSessionProfile } from "@/features/auth/server/session";
import { TimelineBoard } from "@/features/timeline/components/TimelineBoard";
import { getTimelineData } from "@/features/timeline/utils/timeline-query";
import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";
import { toSeoulDate } from "@/shared/lib/recurrence";

export const metadata: Metadata = { title: "생활 타임라인" };

export default async function TimelinePage() {
  const { profile } = await getSessionProfile();
  if (!profile) return null; // the dashboard layout renders the household setup form instead

  const today = toSeoulDate(new Date().toISOString());
  const { open, recent } = await getTimelineData(profile.householdId);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">생활 타임라인</h1>
          <ContextHelpButton topic="timeline_actions" />
        </div>
        <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">
          오늘 해야 할 집안일과 다가오는 관리 일정을 한눈에 확인해요.
        </p>
      </div>
      <TimelineBoard open={open} recent={recent} today={today} />
    </div>
  );
}
