import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Home } from "lucide-react";
import { getSessionProfile } from "@/features/auth/server/session";
import { InviteAcceptForm } from "@/features/household/components/InviteAcceptForm";
import { getInvitePreview } from "@/features/household/server/household.queries";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { isPlausibleToken } from "@/shared/lib/token";
import { AmbientBackground } from "@/shared/components/ui/ambient-background";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";

// The code in the URL is a secret: never cache/index the page, never leak it through Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "가구 초대",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const CTA =
  "flex h-14 w-full items-center justify-center rounded-xl bg-slate-900 text-base font-semibold text-white transition-all hover:bg-slate-800 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";
const SMALL_CTA =
  "inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const preview = isPlausibleToken(code) ? await getInvitePreview(code) : { status: "INVALID" as const, householdName: null };
  const { user, profile } = await getSessionProfile();

  return (
    <main className="relative isolate min-h-screen overflow-x-clip bg-white dark:bg-black">
      <AmbientBackground />
      <ThemeToggle className="absolute right-4 top-4 z-10" />
      <div className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
        {preview.status !== "ACTIVE" && (
          <EmptyState
            icon={AlertTriangle}
            title={preview.status === "USED" ? "이미 사용된 초대 링크예요" : "유효하지 않거나 만료된 초대 링크예요"}
            description="초대한 가족에게 새 초대 링크를 요청해 주세요."
            action={
              <Link href={user ? "/assets" : "/login"} className={SMALL_CTA}>
                {user ? "내 가구로 이동" : "로그인 화면으로"}
              </Link>
            }
          />
        )}

        {preview.status === "ACTIVE" && (
          <>
            <header className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-gradient-to-br from-white to-slate-50 p-4 ring-1 ring-inset ring-white/60 dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-900/60 dark:ring-white/5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Home className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900 dark:text-zinc-50">{preview.householdName}</p>
                <p className="text-xs font-normal text-slate-500 dark:text-zinc-400">가구에 초대받았어요</p>
              </div>
            </header>

            {!user && (
              <>
                <p className="text-center text-xs font-normal text-slate-500 dark:text-zinc-400">
                  로그인하거나 계정을 만들면 구성원으로 참여할 수 있어요.
                </p>
                <Link href={`/login?invite=${code}`} className={CTA}>
                  로그인 / 가입하고 참여하기
                </Link>
              </>
            )}

            {user && profile && (
              <EmptyState
                icon={CheckCircle2}
                title="이미 가구에 속해 있어요"
                description="한 계정은 하나의 가구에만 참여할 수 있어요."
                action={
                  <Link href="/assets" className={SMALL_CTA}>
                    내 가구로 이동
                  </Link>
                }
              />
            )}

            {user && !profile && (
              <InviteAcceptForm
                code={code}
                defaultName={String((user.user_metadata as { display_name?: string }).display_name ?? "")}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
