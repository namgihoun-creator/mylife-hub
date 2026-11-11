"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { inviteSignupSchema, loginSchema, signupSchema } from "../schemas/auth.schema";
import { bootstrapHousehold } from "../utils/household";
import { readPendingInvite } from "@/features/household/utils/pending-invite";

type Mode = "login" | "signup";

/**
 * `inviteCode` (already validated by the page) switches the form to the invite flow: no household is
 * created; after login/sign-up the user continues at /invite/<code> where they join as a member.
 */
export function AuthForm({ inviteCode }: { inviteCode?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const afterAuth = inviteCode ? `/invite/${inviteCode}` : "/assets";

  // An invite link opened earlier in this browser: offer to continue with it instead of starting a second household.
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  useEffect(() => {
    if (!inviteCode) setPendingInvite(readPendingInvite());
  }, [inviteCode]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(e.currentTarget);
    const raw = Object.fromEntries(form) as Record<string, string>;

    startTransition(async () => {
      const supabase = createClient();

      if (mode === "login") {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return setError(parsed.error.issues[0].message);
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) return setError("이메일 또는 비밀번호가 올바르지 않습니다.");
        router.replace(afterAuth);
        router.refresh();
        return;
      }

      let email: string;
      let password: string;
      let displayName: string;
      let householdName: string | undefined;
      if (inviteCode) {
        const parsed = inviteSignupSchema.safeParse(raw);
        if (!parsed.success) return setError(parsed.error.issues[0].message);
        ({ email, password, displayName } = parsed.data);
      } else {
        const parsed = signupSchema.safeParse(raw);
        if (!parsed.success) return setError(parsed.error.issues[0].message);
        ({ email, password, displayName, householdName } = parsed.data);
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Kept so the next step can still complete after e-mail confirmation.
        options: { data: inviteCode ? { display_name: displayName, invite_code: inviteCode } : { household_name: householdName, display_name: displayName } },
      });
      if (error) return setError(error.message);

      if (!data.session) {
        setNotice(
          inviteCode
            ? "확인 메일을 보냈습니다. 메일 인증 후 로그인하면 초대 수락 화면으로 이동해요."
            : "확인 메일을 보냈습니다. 메일 인증 후 로그인하면 가구 설정이 이어집니다.",
        );
        setMode("login");
        return;
      }

      if (!inviteCode && householdName) {
        // Session exists (e-mail confirmation off): bootstrap household + ADMIN profile now.
        // On failure the dashboard shows the household setup form, so we still continue.
        await bootstrapHousehold(supabase, { householdName, displayName });
      }
      router.replace(afterAuth);
      router.refresh();
    });
  }

  const isSignup = mode === "signup";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">MyLife Hub</CardTitle>
        <CardDescription>
          {inviteCode
            ? isSignup
              ? "계정을 만들고 초대받은 가구에 참여해요."
              : "로그인하면 초대받은 가구에 참여할 수 있어요."
            : isSignup
              ? "새 가구를 만들고 관리자로 시작합니다."
              : "로그인하여 우리 집 생활 관리를 이어가세요."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          {!inviteCode && pendingInvite && (
            <div data-testid="pending-invite" className="space-y-2 rounded-2xl bg-sky-50 p-4 dark:bg-sky-950/30">
              <p className="text-sm font-bold text-sky-800 dark:text-sky-200">초대받은 가구가 있어요</p>
              <p className="text-xs font-medium text-sky-700 dark:text-sky-300">새 가구를 만들지 말고, 받은 초대로 가족 가구에 참여하세요.</p>
              <Link data-testid="pending-invite-link" href={`/login?invite=${pendingInvite}`} className="inline-flex min-h-10 items-center rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400">
                초대받은 가구에 참여하기
              </Link>
            </div>
          )}
          {isSignup && !inviteCode && (
            <p data-testid="new-household-warning" className="rounded-2xl bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              가족에게 초대받으셨다면 이 화면에서 가입하지 마세요. ‘새 가구 만들기’는 가족과 <strong className="font-extrabold">따로 쓰는 새 가구</strong>를 만들어요. 받은 초대 링크를 열어 가입해 주세요.
            </p>
          )}
          {isSignup && (
            <>
              {!inviteCode && (
                <Field label="가구명" name="householdName" placeholder="예: 김씨네 집" autoComplete="off" />
              )}
              <Field label="표시 이름" name="displayName" placeholder="예: 아빠" autoComplete="nickname" />
            </>
          )}
          <Field label="이메일" name="email" type="email" placeholder="you@example.com" autoComplete="email" />
          <Field
            label="비밀번호"
            name="password"
            type="password"
            placeholder="8자 이상"
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "처리 중…" : isSignup ? (inviteCode ? "가입하고 계속하기" : "가입하고 시작하기") : "로그인"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(null);
              setNotice(null);
            }}
          >
            {isSignup ? "이미 계정이 있나요? 로그인" : inviteCode ? "처음이신가요? 계정 만들기" : "처음이신가요? 새 가구 만들기"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function Field({ label, name, ...props }: { label: string; name: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}
