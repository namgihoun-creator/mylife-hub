import type { NotificationType } from "../schemas/notification.schema";

/** Where a notification leads when it carries no asset (bell click and push notificationclick share notificationHref). */
export const NOTIFICATION_HREF: Record<NotificationType, string> = {
  MAGIC_COMPLETED: "/timeline",
  INVITE_ACCEPTED: "/assets",
  DUE_SOON: "/timeline",
  DUE_TODAY: "/timeline",
  OVERDUE: "/timeline",
  RENTAL_EXPIRING: "/assets", // fallback when the asset is gone; normally the deep link below
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Target URL of a notification. RENTAL_EXPIRING opens the asset's detail directly on the
 * "환승 & 비용 비교" tab: /assets?openAssetId=<id>&tab=compare (the /assets page handles the query).
 */
export function notificationHref(type: string, assetId?: string | null): string {
  if (type === "RENTAL_EXPIRING" && assetId && UUID.test(assetId)) {
    return `/assets?openAssetId=${encodeURIComponent(assetId)}&tab=compare`;
  }
  return NOTIFICATION_HREF[type as NotificationType] ?? "/timeline";
}
