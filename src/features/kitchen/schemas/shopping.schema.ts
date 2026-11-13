import { z } from "zod";

export const SHOPPING_SOURCES = ["MANUAL", "KITCHEN_CONSUMED", "KITCHEN_EXPIRING"] as const;
export type ShoppingSource = (typeof SHOPPING_SOURCES)[number];

/** A row of shopping_items (migration 18): the couple's shared shopping list. */
export type ShoppingItem = {
  id: string;
  name: string;
  quantity: string | null;
  category: string | null;
  is_checked: boolean;
  source_type: ShoppingSource;
  created_by: string | null;
  created_at: string;
};

export const SOURCE_LABEL: Record<ShoppingSource, string> = { MANUAL: "직접 추가", KITCHEN_CONSUMED: "다 먹었어요", KITCHEN_EXPIRING: "기한 임박" };

const text = (max: number) => z.string().trim().max(max);

export const addShoppingItemSchema = z.object({
  name: text(100).min(1, "품목 이름을 적어 주세요."),
  quantity: text(50).optional().transform((v) => (v ? v : "1개")),
  sourceType: z.enum(SHOPPING_SOURCES).optional().default("MANUAL"),
});
export type AddShoppingItemInput = z.input<typeof addShoppingItemSchema>;

export const shoppingIdSchema = z.object({ id: z.uuid() });
export const toggleShoppingSchema = z.object({ id: z.uuid(), checked: z.boolean() });

/** Same-name check used to avoid listing one thing twice (case/whitespace-insensitive). */
export const sameName = (a: string, b: string) => a.split(/\s+/).join("").toLowerCase() === b.split(/\s+/).join("").toLowerCase();

export type ShoppingResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; notReady?: boolean };
