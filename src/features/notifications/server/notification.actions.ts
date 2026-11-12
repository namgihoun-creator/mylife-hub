"use server";

import { createClient } from "@/shared/lib/supabase/server";
import {
  limitSchema,
  notificationIdSchema,
  type AppNotification,
  type MarkResult,
} from "../schemas/notification.schema";

// All reads go through the caller's JWT: RLS (user_id = auth.uid()) guarantees nobody sees another user's rows.

/** Unread count for the header badge (0 when signed out or on error — the badge is non-critical). */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return error ? 0 : (count ?? 0);
}

/** Newest notifications first. */
export async function getRecentNotifications(limit = 20): Promise<AppNotification[]> {
  const parsed = limitSchema.safeParse(limit);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*") // "*": the list keeps working before and after the kitchen_item_id column exists
    .order("created_at", { ascending: false })
    .limit(parsed.success ? parsed.data : 20);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    task_id: r.task_id ?? null,
    asset_id: r.asset_id ?? null,
    kitchen_item_id: r.kitchen_item_id ?? null,
    read_at: r.read_at ?? null,
    created_at: r.created_at,
  })) as AppNotification[];
}

export async function markAsRead(notificationId: string): Promise<MarkResult> {
  const id = notificationIdSchema.safeParse(notificationId);
  if (!id.success) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id.data });
  return error ? { ok: false, error: "읽음 처리에 실패했어요." } : { ok: true };
}

export async function markAllAsRead(): Promise<MarkResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_notifications_read");
  return error ? { ok: false, error: "읽음 처리에 실패했어요." } : { ok: true };
}
