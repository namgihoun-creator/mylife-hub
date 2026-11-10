import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/AuthForm";
import { inviteCodeSchema } from "@/features/household/schemas/household.schema";

export const metadata: Metadata = { title: "로그인", referrer: "no-referrer" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  // Strictly validated: the code ends up in a redirect path (/invite/<code>).
  const parsed = inviteCodeSchema.safeParse((await searchParams).invite);
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <AuthForm inviteCode={parsed.success ? parsed.data : undefined} />
    </main>
  );
}
