"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { getBaseUrl } from "@/shared/lib/base-url";
import { generateRawToken, sha256Hex } from "@/shared/lib/token";
import { taskIdSchema } from "../schemas/timeline.schema";

const TTL_DAYS = 7;

export type CreateMagicLinkResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NOT_AUTHORIZED: "이 과업의 링크를 만들 권한이 없습니다.",
  TASK_NOT_ACTIONABLE: "이미 완료되었거나 건너뛴 과업은 공유할 수 없습니다.",
};

/**
 * Issues a one-time family link for a task via the create_magic_token RPC.
 * The RPC runs with the caller's own JWT (no service role): it verifies household membership +
 * task visibility, retires the task's still-active unconsumed tokens and inserts the new one in one
 * transaction. Only the SHA-256 hash is stored, so an old token can't be re-shown — a new link replaces it.
 */
export async function createMagicLink(taskId: string): Promise<CreateMagicLinkResult> {
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "잘못된 요청입니다." };

  const rawToken = generateRawToken(64);
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_magic_token", {
    p_task_id: id.data,
    p_token_hash: await sha256Hex(rawToken),
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: RPC_ERRORS[error.message] ?? "링크를 만들지 못했습니다." };

  return { ok: true, url: `${await getBaseUrl()}/m/${rawToken}`, expiresAt };
}
