"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { acceptInvite } from "../server/household.actions";

/** Logged-in user without a household: pick a display name and join (single-use invite). */
export function InviteAcceptForm({ code, defaultName }: { code: string; defaultName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const name = String(new FormData(e.currentTarget).get("displayName") ?? "");
    startTransition(async () => {
      const res = await acceptInvite(code, name);
      if (!res.ok) return setError(res.error);
      router.replace("/assets");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="displayName" className="text-sm font-medium text-slate-800 dark:text-zinc-200">
          표시 이름
        </label>
        <Input id="displayName" name="displayName" defaultValue={defaultName} placeholder="예: 엄마" maxLength={50} className="rounded-lg" />
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-base font-semibold text-white transition-all hover:bg-sky-700 active:scale-[0.98] disabled:opacity-70 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
      >
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
        {pending ? "참여하는 중…" : "가구에 참여하기"}
      </button>
    </form>
  );
}
