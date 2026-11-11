import { z } from "zod";
import { isValidDate } from "../rules/date-utils";
import { STORAGE_TYPES, type StorageType } from "../rules/shelf-life";

export const PET_TYPES = ["none", "dog", "cat", "both"] as const;
export type PetType = (typeof PET_TYPES)[number];
export const PET_TYPE_LABEL: Record<PetType, string> = { none: "없음", dog: "강아지", cat: "고양이", both: "강아지·고양이" };

export type KitchenItem = {
  id: string;
  name: string;
  amount: string;
  storage_type: StorageType;
  spot: string | null;
  expire_date: string; // 'YYYY-MM-DD'
  added_at: string; // 'YYYY-MM-DD' — start of the current storage period
  is_pet: boolean;
  memo: string | null;
  created_at: string;
};

export type KitchenProfile = {
  pet_type: PetType;
  human_monthly_budget: number;
  pet_monthly_budget: number;
  rescued_count: number;
  discarded_count: number;
  saved_money: number;
};

export const DEFAULT_KITCHEN_PROFILE: KitchenProfile = {
  pet_type: "none",
  human_monthly_budget: 350_000,
  pet_monthly_budget: 100_000,
  rescued_count: 0,
  discarded_count: 0,
  saved_money: 0,
};

export type KitchenStats = {
  total: number;
  urgent: number; // D-3 or fewer, expired included
  expired: number; // date already passed
  fossil: number; // frozen 30+ days
};

export type KitchenDashboardData = {
  today: string;
  profile: KitchenProfile;
  items: KitchenItem[]; // soonest expiry first
  stats: KitchenStats;
  /** Names of items that are toxic to pets (only filled when the household has a pet). */
  toxicItems: { id: string; name: string; match: string }[];
};

// ---------------------------------------------------------------- action inputs
const dateField = z
  .string()
  .refine(isValidDate, "소비기한 날짜 형식이 올바르지 않아요.")
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "소비기한은 2000~2100년 사이여야 해요.");

const trimmedOrNull = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .nullish()
    .transform((v) => (v ? v : null));

export const createKitchenItemSchema = z.object({
  name: z.string().trim().min(1, "재료 이름을 입력해 주세요.").max(100, "재료 이름은 100자 이하예요."),
  amount: z.string().trim().max(50, "수량은 50자 이하예요.").optional().transform((v) => (v ? v : "1개")),
  storageType: z.enum(STORAGE_TYPES).optional(),
  spot: trimmedOrNull(30, "보관 장소는 30자 이하예요."),
  /** Omitted -> the server fills the default from the 50-ingredient shelf-life dictionary. */
  expireDate: dateField.optional(),
  isPet: z.boolean().optional().default(false),
  memo: trimmedOrNull(200, "메모는 200자 이하예요."),
});

export const updateKitchenItemSchema = z
  .object({
    id: z.uuid(),
    amount: z.string().trim().min(1, "수량을 입력해 주세요.").max(50, "수량은 50자 이하예요.").optional(),
    spot: trimmedOrNull(30, "보관 장소는 30자 이하예요.").optional(),
    expireDate: dateField.optional(),
    memo: trimmedOrNull(200, "메모는 200자 이하예요.").optional(),
  })
  .refine((v) => v.amount !== undefined || v.spot !== undefined || v.expireDate !== undefined || v.memo !== undefined, { message: "바꿀 내용이 없어요." });

export const kitchenIdSchema = z.object({ id: z.uuid() });
export const moveKitchenItemSchema = z.object({ id: z.uuid(), storageType: z.enum(STORAGE_TYPES) });
export const petTypeSchema = z.object({ petType: z.enum(PET_TYPES) });

export type CreateKitchenItemInput = z.input<typeof createKitchenItemSchema>;
export type UpdateKitchenItemInput = z.input<typeof updateKitchenItemSchema>;

export type KitchenActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
