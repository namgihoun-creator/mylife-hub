import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { pushNewNotifications } from "@/features/notifications/server/push-trigger";
import { clientIp, rateLimit } from "@/shared/lib/rate-limit";
import { sha256Hex } from "@/shared/lib/token";

// Brute-force guard: 10 requests / minute / IP (sliding window, in-memory — see shared/lib/rate-limit.ts).
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const bodySchema = z.object({
  token: z.string().min(16).max(512),
  idempotencyKey: z.string().min(8).max(128),
});

// RPC exception message -> HTTP status + user-facing message.
const ERRORS: Record<string, { status: number; message: string }> = {
  INVALID_TOKEN: { status: 404, message: "유효하지 않거나 만료된 링크입니다." },
  TOKEN_EXPIRED: { status: 410, message: "유효하지 않거나 만료된 링크입니다." },
  TOKEN_CONSUMED: { status: 409, message: "이미 완료 처리된 과업입니다." },
  TASK_NOT_FOUND: { status: 404, message: "과업을 찾을 수 없습니다." },
  TASK_NOT_ACTIONABLE: { status: 409, message: "더 이상 처리할 수 없는 과업입니다." },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: "요청이 충돌했습니다. 새로고침 후 다시 시도해 주세요." },
};

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Magic Link completion (POST only — the GET page never consumes the token).
 * Back-channel: the RPC is granted to service_role only, so it is called with the service-role client.
 */
export async function POST(request: Request) {
  // Checked before parsing/DB work so floods of bad tokens stay cheap.
  const limit = rateLimit(`magic-complete:${clientIp(request.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED", message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "잘못된 요청입니다." }, { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "잘못된 요청입니다." }, { status: 400, headers: NO_STORE });
  }
  const { token, idempotencyKey } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_via_magic_token", {
    p_token: token,
    p_idempotency_key: idempotencyKey,
    // Binds the idempotency key to this exact token + action.
    p_request_hash: await sha256Hex(`magic-complete:${token}`),
  });

  if (error) {
    const known = ERRORS[error.message];
    return NextResponse.json(
      { ok: false, error: known ? error.message : "INTERNAL", message: known?.message ?? "처리 중 오류가 발생했습니다." },
      { status: known?.status ?? 500, headers: NO_STORE },
    );
  }

  const result = (data ?? {}) as {
    task_id?: string;
    completed_at?: string | null;
    next_task_id?: string | null;
    already_completed?: boolean;
  };

  let nextDueDate: string | null = null;
  if (result.next_task_id) {
    const { data: next } = await admin.from("tasks").select("due_date").eq("id", result.next_task_id).maybeSingle();
    nextDueDate = (next?.due_date as string | undefined) ?? null;
  }

  revalidatePath("/timeline");
  revalidatePath("/assets");

  // Instant push for the owner/admins who just got the MAGIC_COMPLETED notification (after the response; never blocks it).
  if (result.task_id && !result.already_completed) {
    pushNewNotifications({ type: "MAGIC_COMPLETED", taskId: result.task_id });
  }

  return NextResponse.json(
    {
      ok: true,
      taskId: result.task_id ?? null,
      completedAt: result.completed_at ?? null,
      alreadyCompleted: Boolean(result.already_completed),
      nextTaskId: result.next_task_id ?? null,
      nextDueDate,
    },
    { headers: NO_STORE },
  );
}
