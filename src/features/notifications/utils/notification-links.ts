import type { NotificationType } from "../schemas/notification.schema";

/** Where a notification leads (bell click and push notificationclick share this). */
export const NOTIFICATION_HREF: Record<NotificationType, string> = {
  MAGIC_COMPLETED: "/timeline",
  INVITE_ACCEPTED: "/assets",
  DUE_SOON: "/timeline",
  DUE_TODAY: "/timeline",
  OVERDUE: "/timeline",
};

export function notificationHref(type: string): string {
  return NOTIFICATION_HREF[type as NotificationType] ?? "/timeline";
}
