"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { copyTextLazy } from "@/shared/lib/clipboard";
import { newIdempotencyKey } from "@/shared/lib/idempotency";
import { createMagicLink } from "../server/magic-link.actions";
import { getDDay } from "@/shared/lib/dday";
import { completeTask, skipTask, snoozeTask } from "../server/timeline.actions";
import type { TimelineActionResult, TimelineTask } from "../schemas/timeline.schema";
import { snoozeTargetDate } from "../utils/snooze";
import { TaskList } from "./TaskList";
import { TimelineSummaryBanner } from "./TimelineSummaryBanner";

type Optimistic =
  | { type: "complete" | "skip"; id: string }
  | { type: "snooze"; id: string; dueDate: string };

function reduce(state: TimelineTask[], a: Optimistic): TimelineTask[] {
  return state.map((t) => {
    if (t.id !== a.id) return t;
    if (a.type === "snooze") return { ...t, due_date: a.dueDate, status: "SNOOZED" as const };
    return { ...t, pending: a.type === "complete" ? ("done" as const) : ("skipped" as const) };
  });
}

/**
 * Client state for the timeline. `useOptimistic` shows the result instantly; when the server
 * action finishes (and revalidates /timeline) React swaps in the fresh server data, or reverts
 * automatically if the action failed.
 */
export function TimelineBoard({
  open,
  recent,
  today,
}: {
  open: TimelineTask[];
  recent: TimelineTask[];
  today: string;
}) {
  const [items, applyOptimistic] = useOptimistic(open, reduce);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);

  function showToast(text: string, tone: "ok" | "error" = "ok") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // Double-call guard (sync, survives re-renders) + one idempotency key per (action, task) attempt.
  const inflight = useRef(new Set<string>());
  const keys = useRef(new Map<string, string>());

  function run(
    task: TimelineTask,
    kind: string, // part of the idempotency-key slot: "snooze:3" and "snooze:7" must not share a key
    optimistic: Optimistic,
    call: (idempotencyKey: string) => Promise<TimelineActionResult>,
  ) {
    if (inflight.current.has(task.id)) return;
    inflight.current.add(task.id);
    setBusyIds(new Set(inflight.current));
    setError(null);

    const mapKey = `${kind}:${task.id}`;
    // A failed attempt retries with the SAME key, so a request that actually succeeded server-side is replayed, not repeated.
    const key = keys.current.get(mapKey) ?? newIdempotencyKey();
    keys.current.set(mapKey, key);

    startTransition(async () => {
      applyOptimistic(optimistic);
      try {
        const res = await call(key);
        if (res.ok) keys.current.delete(mapKey);
        else setError(res.error);
      } catch {
        setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      } finally {
        inflight.current.delete(task.id);
        setBusyIds(new Set(inflight.current));
      }
    });
  }

  // Issues a one-time family link and copies it. The clipboard write starts inside the click gesture
  // (copyTextLazy takes a promise), so it still works after the server round-trip.
  async function share(task: TimelineTask) {
    if (inflight.current.has(task.id)) return;
    inflight.current.add(task.id);
    setBusyIds(new Set(inflight.current));
    setError(null);
    try {
      const result = await copyTextLazy(async () => {
        const res = await createMagicLink(task.id);
        if (!res.ok) throw new Error(res.error);
        return res.url;
      });
      if (result.ok) showToast("공유 링크가 복사되었습니다!");
      else showToast("링크는 만들었지만 복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.", "error");
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : "링크를 만들지 못했습니다.", "error");
    } finally {
      inflight.current.delete(task.id);
      setBusyIds(new Set(inflight.current));
    }
  }

  const active = items.filter((t) => !t.pending);
  const overdueCount = active.filter((t) => t.due_date < today).length;
  const todayCount = active.filter((t) => t.due_date === today).length;
  const weekCount = active.filter((t) => {
    const d = getDDay(t.due_date, today).days;
    return d !== null && d > 0 && d <= 7;
  }).length;

  return (
    <div className="space-y-6">
      <TimelineSummaryBanner todayCount={todayCount} overdueCount={overdueCount} weekCount={weekCount} />

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
        >
          {error}
        </p>
      )}

      <TaskList
        items={items}
        recent={recent}
        today={today}
        busyIds={busyIds}
        onShare={share}
        onComplete={(t) => run(t, "complete", { type: "complete", id: t.id }, (k) => completeTask(t.id, k))}
        onSkip={(t) => run(t, "skip", { type: "skip", id: t.id }, (k) => skipTask(t.id, k))}
        onSnooze={(t, days) =>
          run(
            t,
            `snooze:${days}`,
            { type: "snooze", id: t.id, dueDate: snoozeTargetDate(t.due_date, today, days) },
            (k) => snoozeTask(t.id, days, k),
          )
        }
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full px-4 py-2 text-center text-xs font-medium shadow-lg md:bottom-6 ${
            toast.tone === "ok"
              ? "bg-sky-600 text-white dark:bg-sky-500 dark:text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
