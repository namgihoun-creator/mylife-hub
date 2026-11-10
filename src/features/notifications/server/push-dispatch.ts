import "server-only";
import { configureVapid, sendPush } from "@/shared/lib/push/sender";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { notificationHref } from "../utils/notification-links";

type Claimed = { id: string; user_id: string; type: string; title: string; body: string; task_id: string | null; asset_id: string | null };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

export type DispatchStats = {
  claimed: number;
  notificationsDelivered: number; // at least one push reached a push service
  pushesSent: number;
  expiredSubscriptionsRemoved: number; // 404 / 410 from the push service
  released: number; // transient failure: handed back for the next run
  noSubscription: number; // user has no subscribed device (nothing to send)
};

export type DispatchResult = { ok: true; stats: DispatchStats } | { ok: false; error: "VAPID_NOT_CONFIGURED" | "CLAIM_FAILED"; message: string };

/**
 * Claim -> send -> clean up, for pending notifications (optionally only those of `userIds`).
 * Shared by the cron/manual route (/api/push/dispatch) and by the instant triggers (push-trigger.ts).
 * Claiming stamps push_sent_at atomically (FOR UPDATE SKIP LOCKED), so any number of overlapping runs —
 * cron, instant triggers, manual — never push the same notification twice.
 */
export async function runPushDispatch(options: { limit?: number; userIds?: string[] } = {}): Promise<DispatchResult> {
  const vapidProblem = configureVapid();
  if (vapidProblem) return { ok: false, error: "VAPID_NOT_CONFIGURED", message: vapidProblem };

  const admin = createAdminClient();

  const { data: claimedData, error: claimError } = await admin.rpc("claim_unsent_notifications", {
    p_limit: options.limit ?? 100,
    p_user_ids: options.userIds ?? null,
  });
  if (claimError) return { ok: false, error: "CLAIM_FAILED", message: claimError.message };
  const claimed = (claimedData ?? []) as Claimed[];

  const stats: DispatchStats = {
    claimed: claimed.length,
    notificationsDelivered: 0,
    pushesSent: 0,
    expiredSubscriptionsRemoved: 0,
    released: 0,
    noSubscription: 0,
  };
  if (claimed.length === 0) return { ok: true, stats };

  // Subscriptions of every recipient, in one query.
  const userIds = [...new Set(claimed.map((n) => n.user_id))];
  const { data: subRows } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  const subsByUser = new Map<string, Sub[]>();
  for (const s of (subRows ?? []) as Sub[]) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

  const deadEndpoints = new Set<string>();
  const okSubIds = new Set<string>();
  const toRelease: string[] = [];

  for (const n of claimed) {
    const subs = (subsByUser.get(n.user_id) ?? []).filter((s) => !deadEndpoints.has(s.endpoint));
    if (subs.length === 0) {
      stats.noSubscription++;
      continue;
    }

    const payload = JSON.stringify({ title: n.title, body: n.body, url: notificationHref(n.type, n.asset_id), tag: n.id });
    const results = await Promise.all(subs.map((s) => sendPush(s, payload)));

    let delivered = 0;
    let transient = 0;
    for (const [i, r] of results.entries()) {
      const sub = subs[i];
      if (r.kind === "ok") {
        delivered++;
        stats.pushesSent++;
        okSubIds.add(sub.id);
      } else if (r.kind === "gone" || r.kind === "rejected") {
        // The push service says the subscription no longer exists (or it should never have been stored).
        deadEndpoints.add(sub.endpoint);
        const { data: removed } = await admin.rpc("delete_expired_subscription", { p_endpoint: sub.endpoint });
        if (removed) stats.expiredSubscriptionsRemoved++;
      } else {
        transient++;
      }
    }

    if (delivered > 0) stats.notificationsDelivered++;
    else if (transient > 0) toRelease.push(n.id);
  }

  if (toRelease.length > 0) {
    await admin.rpc("release_notification_push", { p_ids: toRelease });
    stats.released = toRelease.length;
  }
  if (okSubIds.size > 0) {
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", [...okSubIds]);
  }

  return { ok: true, stats };
}
