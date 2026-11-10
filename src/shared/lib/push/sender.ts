import "server-only";
// web-push 4.x is ESM-only with named exports (no default export).
import { sendNotification, setVapidDetails } from "web-push";
import { isAllowedPushEndpoint } from "./endpoints";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** ok = delivered to the push service · gone = subscription is dead (404/410) · transient = retry later · rejected = never send */
export type SendResult = { kind: "ok" | "gone" | "transient" | "rejected"; status: number };

let configured = false;

/** Returns null when VAPID is configured, otherwise a description of what is missing. */
export function configureVapid(): string | null {
  if (configured) return null;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT missing";
  setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return null;
}

/**
 * Test hook (never active in production): with PUSH_TEST_MODE=1 the push service is simulated from a marker in
 * the endpoint path, so the claim / cleanup / retry logic can be verified without network or real subscriptions.
 *   …/e2e-ok… → 201 · …/e2e-gone… → 410 · …/e2e-notfound… → 404 · …/e2e-fail… → 500
 */
function simulate(endpoint: string): SendResult | null {
  if (process.env.NODE_ENV === "production" || process.env.PUSH_TEST_MODE !== "1") return null;
  const path = new URL(endpoint).pathname;
  if (path.includes("e2e-gone")) return { kind: "gone", status: 410 };
  if (path.includes("e2e-notfound")) return { kind: "gone", status: 404 };
  if (path.includes("e2e-fail")) return { kind: "transient", status: 500 };
  if (path.includes("e2e-ok")) return { kind: "ok", status: 201 };
  return null;
}

export async function sendPush(target: PushTarget, payload: string): Promise<SendResult> {
  // Re-checked at send time: the allowlist may have changed since the row was stored.
  if (!isAllowedPushEndpoint(target.endpoint)) return { kind: "rejected", status: 0 };

  const simulated = simulate(target.endpoint);
  if (simulated) return simulated;

  try {
    const res = await sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      { TTL: 60 * 60 * 24, urgency: "normal", timeout: 10_000 },
    );
    return { kind: "ok", status: res.statusCode };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    if (status === 404 || status === 410) return { kind: "gone", status };
    // 400/401/403 = malformed subscription or VAPID problem: retrying will not help, but the subscription is
    // not provably dead either — treat as transient (the notification is released, never spun on forever: 24h window).
    return { kind: "transient", status };
  }
}
