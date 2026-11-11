"use client";

import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { CelebrationArt } from "@/shared/components/ui/celebration-art";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { newIdempotencyKey } from "@/shared/lib/idempotency";

type Phase = "idle" | "pending" | "done";

// Full date with year: a recurring task's next due date can be months away.
const fullDate = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;

/**
 * The only mutating piece of the Magic Link page: POST /api/tasks/magic-complete.
 * One idempotency key per page view; a failed attempt retries with the SAME key.
 */
export function MagicCompleteForm({ token, expiresLabel }: { token: string; expiresLabel: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const lockRef = useRef(false);

  async function complete() {
    if (lockRef.current) return; // double-tap guard
    lockRef.current = true;
    setError(null);
    setPhase("pending");
    keyRef.current ??= newIdempotencyKey();

    try {
      const res = await fetch("/api/tasks/magic-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, idempotencyKey: keyRef.current }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; nextDueDate: string | null }
        | { ok: false; message?: string }
        | null;

      if (res.ok && body?.ok) {
        setNextDue(body.nextDueDate);
        setPhase("done");
        return;
      }
      // Terminal states (consumed/expired/invalid) will not recover by retrying.
      setError((body && !body.ok && body.message) || "처리 중 오류가 발생했습니다. 다시 시도해 주세요.");
      setPhase("idle");
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      setPhase("idle");
    } finally {
      lockRef.current = false;
    }
  }

  if (phase === "done") {
    return (
      <EmptyState
        art={<CelebrationArt />}
        title="완료 처리되었어요!"
        description={
          nextDue ? `수고하셨어요. 다음 관리 일정은 ${fullDate(nextDue)}이에요.` : "수고하셨어요. 가족 모두가 알 수 있도록 기록됐어요."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-center text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={complete}
        disabled={phase === "pending"}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-base font-semibold text-white transition-all hover:bg-sky-700 active:scale-[0.98] disabled:opacity-70 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
      >
        {phase === "pending" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={3} />}
        {phase === "pending" ? "처리 중…" : "이 과업 완료하기"}
      </button>
      {expiresLabel && (
        <p className="text-center text-[11px] font-normal text-slate-500 dark:text-zinc-400">
          이 링크는 한 번만 사용할 수 있어요 · {expiresLabel}까지 유효
        </p>
      )}
    </div>
  );
}
