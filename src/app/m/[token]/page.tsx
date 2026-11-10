import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Home } from "lucide-react";
import { MagicCompleteForm } from "@/features/magic-link/components/MagicCompleteForm";
import { getMagicLinkView, type MagicTaskInfo } from "@/features/magic-link/server/magic-link.queries";
import { DDayBadge } from "@/shared/components/ui/dday-badge";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { getApplianceVisual } from "@/shared/lib/appliance-icons";
import { toSeoulDate } from "@/shared/lib/recurrence";
import { cn } from "@/shared/lib/utils";

// Token pages must never be cached, indexed, or leak the token through the Referer header.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "가전 관리 링크",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TAG =
  "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-300";

function formatKst(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HouseholdBanner({ name }: { name: string }) {
  return (
    <header className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm ring-1 ring-inset ring-white/60 dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-900/60 dark:ring-white/5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900">
        <Home className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-slate-900 dark:text-zinc-50">{name} 가전 관리</p>
        <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">가족 공유 링크</p>
      </div>
    </header>
  );
}

function TaskCard({ info, today, muted = false }: { info: MagicTaskInfo; today: string; muted?: boolean }) {
  const { icon: Icon, tone } = getApplianceVisual(info.presetKey);
  return (
    <section
      aria-label="과업 정보"
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90",
        muted && "opacity-70",
      )}
    >
      <div className="flex items-center gap-4">
        <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl", tone)}>
          <Icon className="h-8 w-8" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50">{info.assetName ?? "가전"}</h1>
          {info.space && <span className={TAG}>{info.space}</span>}
        </div>
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-zinc-800">
        <div className="space-y-1">
          <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">수행할 과업</p>
          <p className="text-base font-semibold text-slate-900 dark:text-zinc-50">{info.taskTitle}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">원래 예정일</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-zinc-50">
              {info.dueDate.slice(0, 4)}.{info.dueDate.slice(5, 7)}.{info.dueDate.slice(8, 10)}
            </p>
          </div>
          {!muted && <DDayBadge dueDate={info.dueDate} today={today} size="lg" />}
        </div>
      </div>
    </section>
  );
}

export default async function MagicLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getMagicLinkView(token); // read-only: GET never consumes the token
  const today = toSeoulDate(new Date().toISOString());

  return (
    <main className="min-h-screen bg-slate-50/70 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
        {view.kind === "invalid" && (
          <EmptyState
            icon={AlertTriangle}
            title="유효하지 않거나 만료된 링크입니다"
            description="링크를 보내 준 가족에게 새 링크를 요청해 주세요."
          />
        )}

        {view.kind === "done" && (
          <>
            <HouseholdBanner name={view.info.householdName} />
            <TaskCard info={view.info} today={today} muted />
            <EmptyState
              icon={CheckCircle2}
              title="이미 완료 처리된 과업입니다"
              description={formatKst(view.completedAt) ? `${formatKst(view.completedAt)}에 완료되었어요.` : "이미 완료되었어요."}
            />
          </>
        )}

        {view.kind === "ready" && (
          <>
            <HouseholdBanner name={view.info.householdName} />
            <TaskCard info={view.info} today={today} />
            <MagicCompleteForm token={token} expiresLabel={formatKst(view.expiresAt)} />
          </>
        )}
      </div>
    </main>
  );
}
