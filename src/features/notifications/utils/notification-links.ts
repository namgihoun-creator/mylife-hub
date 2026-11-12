import type { NotificationType } from "../schemas/notification.schema";

/** Where a notification leads when it carries no asset (bell click and push notificationclick share notificationHref). */
export const NOTIFICATION_HREF: Record<NotificationType, string> = {
  MAGIC_COMPLETED: "/timeline",
  INVITE_ACCEPTED: "/assets",
  DUE_SOON: "/timeline",
  DUE_TODAY: "/timeline",
  OVERDUE: "/timeline",
  RENTAL_EXPIRING: "/assets", // fallback when the asset is gone; normally the deep link below
  KITCHEN_EXPIRING: "/kitchen", // fallback when the item is gone; normally /kitchen?focus=<id>
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Target URL of a notification (the /assets and /kitchen pages handle the query):
 *   RENTAL_EXPIRING          → the asset's detail on the "환승 & 비용 비교" tab
 *   DUE_SOON / DUE_TODAY / OVERDUE with an asset → that appliance's detail panel
 *   KITCHEN_EXPIRING         → /kitchen?focus=<item id> (scrolls to and highlights the ingredient)
 * Anything else (or a deleted target) falls back to the plain list page.
 */
export function notificationHref(type: string, assetId?: string | null, kitchenItemId?: string | null): string {
  if (type === "KITCHEN_EXPIRING" && kitchenItemId && UUID.test(kitchenItemId)) {
    return `/kitchen?focus=${encodeURIComponent(kitchenItemId)}`;
  }
  if (type === "RENTAL_EXPIRING" && assetId && UUID.test(assetId)) {
    return `/assets?openAssetId=${encodeURIComponent(assetId)}&tab=compare`;
  }
  if ((type === "DUE_SOON" || type === "DUE_TODAY" || type === "OVERDUE") && assetId && UUID.test(assetId)) {
    return `/assets?openAssetId=${encodeURIComponent(assetId)}`;
  }
  return NOTIFICATION_HREF[type as NotificationType] ?? "/timeline";
}
