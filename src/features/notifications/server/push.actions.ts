"use server";

import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { isAllowedPushEndpoint } from "@/shared/lib/push/endpoints";

const base64url = /^[A-Za-z0-9_-]+$/;

// Shape of PushSubscription.toJSON(). p256dh = 65-byte uncompressed P-256 point (87 chars), auth = 16 bytes (22 chars).
const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine(isAllowedPushEndpoint, "지원하지 않는 푸시 서비스 주소입니다."),
  keys: z.object({
    p256dh: z.string().min(80).max(100).regex(base64url),
    auth: z.string().min(20).max(30).regex(base64url),
  }),
});

export type PushActionResult = { ok: true } | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NO_HOUSEHOLD: "가구 설정이 필요합니다.",
  TOO_MANY_SUBSCRIPTIONS: "푸시를 받는 기기가 너무 많아요. 사용하지 않는 기기에서 먼저 끄고 다시 시도해 주세요.",
  INVALID_SUBSCRIPTION: "구독 정보가 올바르지 않아요.",
};

/**
 * Stores this browser's push subscription for the signed-in user (upsert_push_subscription RPC).
 * The endpoint is validated against the known push-service hosts: the server will POST to it later (SSRF guard).
 */
export async function savePushSubscription(subscription: unknown, userAgent?: unknown): Promise<PushActionResult> {
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) {
    const endpointIssue = parsed.error.issues.some((i) => i.path[0] === "endpoint");
    return { ok: false, error: endpointIssue ? "지원하지 않는 푸시 서비스 주소입니다." : "구독 정보가 올바르지 않아요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: typeof userAgent === "string" ? userAgent.slice(0, 400) : null,
  });
  if (error) return { ok: false, error: RPC_ERRORS[error.message] ?? "푸시 구독을 저장하지 못했어요." };
  return { ok: true };
}

/** Removes this browser's subscription (RLS: only the owner's row can be deleted). */
export async function removePushSubscription(endpoint: unknown): Promise<PushActionResult> {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return error ? { ok: false, error: "푸시 구독을 해지하지 못했어요." } : { ok: true };
}

/** True when this endpoint is registered for the CURRENT user (a different account on the same browser counts as off). */
export async function hasPushSubscription(endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  return !!data;
}
