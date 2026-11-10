import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/AuthForm";
import { inviteCodeSchema } from "@/features/household/schemas/household.schema";
import { AmbientBackground } from "@/shared/components/ui/ambient-background";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";

export const metadata: Metadata = { title: "로그인", referrer: "no-referrer" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  // Strictly validated: the code ends up in a redirect path (/invite/<code>).
  const parsed = inviteCodeSchema.safeParse((await searchParams).invite);
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-x-clip bg-white px-4 py-10 dark:bg-black">
      <AmbientBackground />
      <ThemeToggle className="absolute right-4 top-4 z-10" />
      <AuthForm inviteCode={parsed.success ? parsed.data : undefined} />
    </main>
  );
}
