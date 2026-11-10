"use client";

import { useState, useTransition } from "react";
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
import { householdSetupSchema } from "../schemas/auth.schema";
import { bootstrapHousehold } from "../utils/household";

/** Shown when a user is signed in but has no profile yet (e.g. confirmed e-mail later). */
export function HouseholdSetup({
  defaultHouseholdName = "",
  defaultDisplayName = "",
  inviteCode,
}: {
  defaultHouseholdName?: string;
  defaultDisplayName?: string;
  /** Present when the user signed up through an invite link (e-mail-confirmation case). */
  inviteCode?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = householdSetupSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setError(parsed.error.issues[0].message);

    startTransition(async () => {
      const message = await bootstrapHousehold(createClient(), parsed.data);
      if (message) return setError(message);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>가구 만들기</CardTitle>
          <CardDescription>처음 한 번만 설정합니다. 만든 사람이 관리자가 됩니다.</CardDescription>
          {inviteCode && (
            <p className="pt-2 text-sm">
              초대받은 가구에 참여하려면{" "}
              <a href={`/invite/${inviteCode}`} className="font-semibold underline underline-offset-4">
                초대 링크 다시 열기
              </a>
            </p>
          )}
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="householdName" className="text-sm font-medium">가구명</label>
              <Input id="householdName" name="householdName" defaultValue={defaultHouseholdName} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="displayName" className="text-sm font-medium">표시 이름</label>
              <Input id="displayName" name="displayName" defaultValue={defaultDisplayName} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "만드는 중…" : "시작하기"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
