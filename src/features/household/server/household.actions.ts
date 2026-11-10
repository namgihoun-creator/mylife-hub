"use server";

import { revalidatePath } from "next/cache";
import { pushNewNotifications } from "@/features/notifications/server/push-trigger";
import { createClient } from "@/shared/lib/supabase/server";
import { getBaseUrl } from "@/shared/lib/base-url";
import { generateRawToken, sha256Hex } from "@/shared/lib/token";
import { displayNameSchema, inviteCodeSchema } from "../schemas/household.schema";

const INVITE_TTL_DAYS = 7;

const ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NOT_AUTHORIZED: "관리자만 할 수 있는 작업입니다.",
  TOO_MANY_INVITES: "사용 중인 초대 링크가 너무 많아요. 기존 링크가 만료되거나 사용된 뒤에 다시 만들어 주세요.",
  ALREADY_MEMBER: "이미 가구에 속해 있어요.",
  INVALID_INVITE: "유효하지 않거나 만료된 초대 링크입니다.",
  INVITE_EXPIRED: "유효하지 않거나 만료된 초대 링크입니다.",
  INVITE_USED: "이미 사용된 초대 링크입니다.",
  INVALID_DISPLAY_NAME: "표시 이름을 1~50자로 입력해 주세요.",
};

export type CreateInviteResult = { ok: true; url: string; expiresAt: string } | { ok: false; error: string };
export type AcceptInviteResult = { ok: true } | { ok: false; error: string };

/**
 * Admin: issues a single-use, 7-day invite link. Only the SHA-256 hash is stored; the raw code
 * exists only in the returned URL (create_household_invite verifies the caller is an ADMIN).
 */
export async function createInvite(): Promise<CreateInviteResult> {
  const code = generateRawToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_household_invite", {
    p_code_hash: await sha256Hex(code),
    p_expires_at: expiresAt,
  });
  if (error) return { ok: false, error: ERRORS[error.message] ?? "초대 링크를 만들지 못했습니다." };

  return { ok: true, url: `${await getBaseUrl()}/invite/${code}`, expiresAt };
}

/** Logged-in user without a household joins as MEMBER (accept_household_invite: single-use, row-locked). */
export async function acceptInvite(code: unknown, displayName: unknown): Promise<AcceptInviteResult> {
  const c = inviteCodeSchema.safeParse(code);
  const n = displayNameSchema.safeParse(displayName);
  if (!c.success) return { ok: false, error: ERRORS.INVALID_INVITE };
  if (!n.success) return { ok: false, error: ERRORS.INVALID_DISPLAY_NAME };

  const supabase = await createClient();
  const { data: householdId, error } = await supabase.rpc("accept_household_invite", {
    p_code_hash: await sha256Hex(c.data),
    p_display_name: n.data,
  });
  if (error) return { ok: false, error: ERRORS[error.message] ?? "초대를 수락하지 못했습니다." };

  revalidatePath("/", "layout");

  // Instant push to the household admins who just got INVITE_ACCEPTED (after the response; never blocks it).
  if (typeof householdId === "string") pushNewNotifications({ type: "INVITE_ACCEPTED", householdId });
  return { ok: true };
}
