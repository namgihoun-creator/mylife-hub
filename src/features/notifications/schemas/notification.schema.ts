import { z } from "zod";

export const NOTIFICATION_TYPES = ["DUE_SOON", "DUE_TODAY", "OVERDUE", "MAGIC_COMPLETED", "INVITE_ACCEPTED"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
};

export const notificationIdSchema = z.uuid();
export const limitSchema = z.number().int().min(1).max(50);

export type MarkResult = { ok: true } | { ok: false; error: string };
