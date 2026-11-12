import { z } from "zod";

export const NOTIFICATION_TYPES = ["DUE_SOON", "DUE_TODAY", "OVERDUE", "MAGIC_COMPLETED", "INVITE_ACCEPTED", "RENTAL_EXPIRING", "KITCHEN_EXPIRING"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  task_id: string | null;
  asset_id: string | null; // task / rental alerts: the appliance to open; null for kitchen alerts or once the asset is deleted
  kitchen_item_id: string | null; // KITCHEN_EXPIRING: the ingredient to focus on /kitchen; null once it is deleted
  read_at: string | null;
  created_at: string;
};

export const notificationIdSchema = z.uuid();
export const limitSchema = z.number().int().min(1).max(50);

export type MarkResult = { ok: true } | { ok: false; error: string };
