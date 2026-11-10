import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { NotificationType } from "../schemas/notification.schema";
import { runPushDispatch } from "./push-dispatch";

/** Only look at notifications created moments ago, so an instant trigger never drags in old backlog. */
const FRESH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Instant push for events that just created notifications (Magic Link completion, invite acceptance):
 * after the HTTP response has been sent (`after()`: fire-and-forget, never delays or fails the request),
 * find who just received an unsent notification of this kind and run the SAME dispatch pipeline the cron
 * uses, scoped to those users. The 09:00 cron stays the safety net for anything missed here.
 *
 * Failures are logged and swallowed: a push problem must never turn a successful completion into an error.
 */
export function pushNewNotifications(filter: { type: NotificationType; taskId?: string; householdId?: string }): void {
  after(async () => {
    try {
      const admin = createAdminClient();
      let query = admin
        .from("notifications")
        .select("user_id")
        .eq("type", filter.type)
        .is("push_sent_at", null)
        .gte("created_at", new Date(Date.now() - FRESH_WINDOW_MS).toISOString())
        .limit(200);
      if (filter.taskId) query = query.eq("task_id", filter.taskId);
      if (filter.householdId) query = query.eq("household_id", filter.householdId);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
      if (userIds.length === 0) return;

      const result = await runPushDispatch({ userIds });
      if (!result.ok) console.error(`[push-trigger] ${filter.type}: ${result.error} ${result.message}`);
    } catch (e) {
      console.error(`[push-trigger] ${filter.type} failed:`, e instanceof Error ? e.message : e);
    }
  });
}
