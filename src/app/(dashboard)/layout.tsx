import Link from "next/link";
import { redirect } from "next/navigation";
import { Home, LogOut, Users } from "lucide-react";
import { getSessionProfile } from "@/features/auth/server/session";
import { signOut } from "@/features/auth/server/auth.actions";
import { HouseholdSetup } from "@/features/auth/components/HouseholdSetup";
import { HouseholdSettingsModal } from "@/features/household/components/HouseholdSettingsModal";
import { inviteCodeSchema } from "@/features/household/schemas/household.schema";
import { getMembers } from "@/features/household/server/household.queries";
import { MainNav } from "@/shared/components/layout/MainNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  // Signed in but no household yet (e.g. e-mail confirmed after sign-up).
  if (!profile) {
    const meta = user.user_metadata as { household_name?: string; display_name?: string; invite_code?: string };
    const invite = inviteCodeSchema.safeParse(meta.invite_code);
    return (
      <HouseholdSetup
        defaultHouseholdName={meta.household_name ?? ""}
        defaultDisplayName={meta.display_name ?? ""}
        inviteCode={invite.success ? invite.data : undefined}
      />
    );
  }

  const initial = profile.displayName.trim().charAt(0).toUpperCase() || "?";
  const members = await getMembers();

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-zinc-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/assets" className="flex items-center gap-2" aria-label="MyLife Hub 홈">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900">
              <Home className="h-4 w-4" />
            </span>
            <span className="hidden text-sm font-bold tracking-tight text-slate-900 dark:text-zinc-50 sm:inline">
              MyLife Hub
            </span>
          </Link>

          <span className="inline-flex max-w-[40vw] items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300">
            <Users className="h-3 w-3 shrink-0" />
            <span className="truncate">{profile.householdName}</span>
          </span>

          <div className="flex flex-1 justify-center">
            <MainNav variant="top" />
          </div>

          <div className="flex items-center gap-2">
            <HouseholdSettingsModal members={members} role={profile.role} householdName={profile.householdName} />
            <span
              title={profile.displayName}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700/60"
            >
              {initial}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="로그아웃"
                title="로그아웃"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 sm:px-6 md:pb-8">{children}</main>
      <MainNav variant="bottom" />
    </div>
  );
}
