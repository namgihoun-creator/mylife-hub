"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import {
  idempotencyKeySchema,
  snoozeDaysSchema,
  taskIdSchema,
  type TimelineActionResult,
} from "../schemas/timeline.schema";

// RPC exception messages (Phase 1-2 / 2-1) -> user-facing Korean.
const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NO_HOUSEHOLD: "가구 설정이 필요합니다.",
  NOT_AUTHORIZED: "이 과업을 변경할 권한이 없습니다.",
  INVALID_TASK_STATUS: "이미 완료되었거나 건너뛴 과업은 연기할 수 없습니다.",
  INVALID_DAYS: "연기 일수가 올바르지 않습니다.",
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
 * Snooze via the snooze_task RPC (SECURITY DEFINER): due_date moves `days` later — counted from today
 * when already overdue — and status becomes SNOOZED; an event-log row is written. Unlike a plain table
 * update, any household member may snooze a FAMILY task (RLS alone only allows owner / ADMIN).
 * The idempotency key (generated in the browser with Web Crypto) is bound to (task, days) inside the RPC.
 */
export async function snoozeTask(
  taskId: string,
  days: number,
  idempotencyKey: string,
): Promise<TimelineActionResult> {
  const id = taskIdSchema.safeParse(taskId);
  const d = snoozeDaysSchema.safeParse(days);
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!id.success || !d.success || !key.success) return { ok: false, error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("snooze_task", {
    p_task_id: id.data,
    p_days: d.data,
    p_idempotency_key: key.data,
  });
  if (error) return { ok: false, error: rpcError(error.message) };

  revalidate();
  return { ok: true };
}
