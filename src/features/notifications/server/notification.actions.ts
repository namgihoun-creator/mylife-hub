"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { randomUUID } from "node:crypto";
import { completeTask } from "@/features/timeline/server/timeline.actions";
import { consumeKitchenItem } from "@/features/kitchen/server/kitchen.actions";
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

// ---------------------------------------------------------------------------------------------- one-tap completion from the bell
export type NotificationQuickResult =
  | { ok: true; kind: "task"; alreadyDone: boolean; nextDueDate: string | null; message: string }
  | { ok: true; kind: "kitchen"; alreadyGone: boolean; itemName: string | null; itemAmount: string | null; message: string }
  | { ok: false; error: string };

async function markRead(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  await supabase.rpc("mark_notification_read", { p_notification_id: id });
}

const dotDate = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/**
 * The [교체·점검 완료] / [소진 완료] capsules of the bell:
 *   DUE_SOON · DUE_TODAY · OVERDUE (task_id, or the asset's next open task when only asset_id is left)
 *       -> the same atomic complete RPC as the timeline (log + next due date), then the notification is read.
 *   KITCHEN_EXPIRING (kitchen_item_id)
 *       -> the ingredient is used up (stats credited like "다 먹었어요"), then the notification is read.
 * A target that is already completed / deleted never fails the tap: the notification is just marked read and the message says so.
 * Runs under the caller's JWT, so a notification of someone else is simply not found (RLS).
 */
export async function completeFromNotification(notificationId: string): Promise<NotificationQuickResult> {
  const id = notificationIdSchema.safeParse(notificationId);
  if (!id.success) return { ok: false, error: "잘못된 요청입니다." };
  const supabase = await createClient();
  const { data: n, error } = await supabase.from("notifications").select("*").eq("id", id.data).maybeSingle();
  if (error || !n) return { ok: false, error: "알림을 찾을 수 없어요." };

  // ---- kitchen
  if (n.type === "KITCHEN_EXPIRING") {
    const itemId: string | null = n.kitchen_item_id ?? null;
    const item = itemId ? (await supabase.from("kitchen_items").select("id, name, amount").eq("id", itemId).maybeSingle()).data : null;
    if (!item) {
      await markRead(supabase, id.data);
      return { ok: true, kind: "kitchen", alreadyGone: true, itemName: null, itemAmount: null, message: "이미 정리된 재료예요. 알림만 읽음 처리했어요." };
    }
    const res = await consumeKitchenItem({ id: item.id });
    if (!res.ok) {
      // lost a race with the partner: it is gone now
      await markRead(supabase, id.data);
      return { ok: true, kind: "kitchen", alreadyGone: true, itemName: item.name, itemAmount: item.amount, message: "이미 정리된 재료예요. 알림만 읽음 처리했어요." };
    }
    await markRead(supabase, id.data);
    return { ok: true, kind: "kitchen", alreadyGone: false, itemName: item.name, itemAmount: item.amount, message: `${item.name}을(를) 소진 처리했어요.` };
  }

  // ---- appliance / consumable task
  if (n.type === "DUE_SOON" || n.type === "DUE_TODAY" || n.type === "OVERDUE") {
    let taskId: string | null = n.task_id ?? null;
    if (!taskId && n.asset_id) {
      const { data: open } = await supabase.from("tasks").select("id").eq("asset_id", n.asset_id).in("status", ["PENDING", "SNOOZED"]).order("due_date", { ascending: true }).limit(1);
      taskId = open?.[0]?.id ?? null;
    }
    const task = taskId ? (await supabase.from("tasks").select("id, status").eq("id", taskId).maybeSingle()).data : null;
    if (!task || (task.status !== "PENDING" && task.status !== "SNOOZED")) {
      await markRead(supabase, id.data);
      return { ok: true, kind: "task", alreadyDone: true, nextDueDate: null, message: "이미 완료됐거나 삭제된 항목이에요. 알림만 읽음 처리했어요." };
    }
    const res = await completeTask(task.id, randomUUID());
    if (!res.ok) return { ok: false, error: res.error };
    let nextDueDate: string | null = null;
    if (res.nextTaskId) nextDueDate = (await supabase.from("tasks").select("due_date").eq("id", res.nextTaskId).maybeSingle()).data?.due_date ?? null;
    await markRead(supabase, id.data);
    return {
      ok: true,
      kind: "task",
      alreadyDone: Boolean(res.alreadyDone),
      nextDueDate,
      message: res.alreadyDone ? "이미 완료된 항목이에요. 알림만 읽음 처리했어요." : nextDueDate ? `완료했어요. 다음 예정일은 ${dotDate(nextDueDate)}예요.` : "완료했어요.",
    };
  }

  return { ok: false, error: "바로 처리할 수 있는 알림이 아니에요." };
}
