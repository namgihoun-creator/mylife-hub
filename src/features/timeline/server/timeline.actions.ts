"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { toSeoulDate } from "@/shared/lib/recurrence";
import {
  idempotencyKeySchema,
  snoozeDaysSchema,
  taskIdSchema,
  type TimelineActionResult,
} from "../schemas/timeline.schema";
import { snoozeTargetDate } from "../utils/snooze";

// RPC exception messages (Phase 1-2) -> user-facing Korean.
const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NO_HOUSEHOLD: "가구 설정이 필요합니다.",
  TASK_NOT_FOUND: "과업을 찾을 수 없습니다.",
  TASK_NOT_ACTIONABLE: "이미 건너뛰었거나 취소된 과업입니다.",
  TASK_NOT_RECURRING: "반복 과업만 건너뛸 수 있습니다.",
  IDEMPOTENCY_KEY_REUSED: "요청이 충돌했습니다. 새로고침 후 다시 시도해 주세요.",
};

function rpcError(message: string): string {
  return RPC_ERRORS[message] ?? "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

/** The request hash binds an idempotency key to one (action, task) pair. */
function requestHash(action: "complete" | "skip", taskId: string) {
  return createHash("sha256").update(`${action}:${taskId}`).digest("hex");
}

function revalidate() {
  revalidatePath("/timeline");
  revalidatePath("/assets");
}

async function callRpc(
  fn: "complete_task_and_generate_next" | "skip_task_and_generate_next",
  action: "complete" | "skip",
  taskId: unknown,
  idempotencyKey: unknown,
): Promise<TimelineActionResult> {
  const id = taskIdSchema.safeParse(taskId);
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!id.success || !key.success) return { ok: false, error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, {
    p_task_id: id.data,
    p_idempotency_key: key.data,
    p_request_hash: requestHash(action, id.data),
  });
  if (error) return { ok: false, error: rpcError(error.message) };

  revalidate();
  const res = (data ?? {}) as { next_task_id?: string | null; already_completed?: boolean; already_skipped?: boolean };
  return {
    ok: true,
    nextTaskId: res.next_task_id ?? null,
    alreadyDone: Boolean(res.already_completed || res.already_skipped),
  };
}

/** Atomic complete + log + next iteration (RPC, idempotent). */
export async function completeTask(taskId: string, idempotencyKey: string): Promise<TimelineActionResult> {
  return callRpc("complete_task_and_generate_next", "complete", taskId, idempotencyKey);
}

/** Atomic skip + log + next iteration from the original due date (RPC, idempotent). Recurring tasks only. */
export async function skipTask(taskId: string, idempotencyKey: string): Promise<TimelineActionResult> {
  return callRpc("skip_task_and_generate_next", "skip", taskId, idempotencyKey);
}

/**
 * Plain snooze: due_date moves `days` later (from today if already overdue) and status -> SNOOZED.
 * Guarded by the previously read due_date + open status, so a concurrent completion/snooze
 * is never overwritten. Runs under the caller's JWT: RLS decides who may update (owner / ADMIN for FAMILY).
 */
export async function snoozeTask(taskId: string, days: number): Promise<TimelineActionResult> {
  const id = taskIdSchema.safeParse(taskId);
  const d = snoozeDaysSchema.safeParse(days);
  if (!id.success || !d.success) return { ok: false, error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { data: task, error: readError } = await supabase
    .from("tasks")
    .select("due_date, status")
    .eq("id", id.data)
    .maybeSingle();
  if (readError || !task) return { ok: false, error: "과업을 찾을 수 없습니다." };
  if (task.status !== "PENDING" && task.status !== "SNOOZED") {
    return { ok: false, error: "이미 완료되었거나 건너뛴 과업입니다." };
  }

  const today = toSeoulDate(new Date().toISOString());
  const newDue = snoozeTargetDate(task.due_date as string, today, d.data);

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({ status: "SNOOZED", due_date: newDue, snoozed_until: newDue })
    .eq("id", id.data)
    .eq("due_date", task.due_date)
    .in("status", ["PENDING", "SNOOZED"])
    .select("id");
  if (error) return { ok: false, error: "연기 처리 중 오류가 발생했습니다." };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "다른 곳에서 먼저 변경되었거나 연기 권한이 없습니다." };
  }

  revalidate();
  return { ok: true };
}
