import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { notificationHref } from "@/features/notifications/utils/notification-links";
import { configureVapid, sendPush } from "@/shared/lib/push/sender";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    // Scope a run to specific users (operations / tests); omitted = every pending notification.
    user_ids: z.array(z.uuid()).max(100).optional(),
  })
  .strict();

type Claimed = { id: string; user_id: string; type: string; title: string; body: string; task_id: string | null };
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** null = CRON_SECRET not configured (never "open"), false = wrong/missing credentials. Constant-time compare. */
function checkAuth(request: Request): boolean | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  const auth = checkAuth(request);
  if (auth === null) {
    return NextResponse.json({ ok: false, error: "NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (!auth) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } });
  }

  const vapidProblem = configureVapid();
  if (vapidProblem) {
    return NextResponse.json({ ok: false, error: "VAPID_NOT_CONFIGURED", message: vapidProblem }, { status: 503, headers: NO_STORE });
  }

  // POST may carry options; GET (e.g. a cron service) uses the defaults.
  let options: z.infer<typeof bodySchema> = {};
  if (request.method === "POST") {
    const text = await request.text();
    if (text.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      options = parsed.data;
    }
  }

  const admin = createAdminClient();

  // 1) Claim: stamps push_sent_at atomically (FOR UPDATE SKIP LOCKED) so overlapping runs never double-send.
  const { data: claimedData, error: claimError } = await admin.rpc("claim_unsent_notifications", {
    p_limit: options.limit ?? 100,
    p_user_ids: options.user_ids ?? null,
  });
  if (claimError) {
    return NextResponse.json({ ok: false, error: "CLAIM_FAILED", message: claimError.message }, { status: 500, headers: NO_STORE });
  }
  const claimed = (claimedData ?? []) as Claimed[];

  const stats = {
    claimed: claimed.length,
    notificationsDelivered: 0, // at least one push reached a push service
    pushesSent: 0,
    expiredSubscriptionsRemoved: 0, // 404 / 410 from the push service
    released: 0, // transient failure: handed back for the next run
    noSubscription: 0, // user has no subscribed device (nothing to send)
  };

  if (claimed.length > 0) {
    // 2) Subscriptions of every recipient, in one query.
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

    // 3) Send.
    for (const n of claimed) {
      const subs = (subsByUser.get(n.user_id) ?? []).filter((s) => !deadEndpoints.has(s.endpoint));
      if (subs.length === 0) {
        stats.noSubscription++;
        continue;
      }

      const payload = JSON.stringify({ title: n.title, body: n.body, url: notificationHref(n.type), tag: n.id });
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
          // 4) Clean-up: the push service says the subscription no longer exists (or it should never have been stored).
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
  }

  return NextResponse.json({ ok: true, ...stats }, { headers: NO_STORE });
}

export const POST = handle;
export const GET = handle;
