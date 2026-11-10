import { z } from "zod";

export const SPACES = ["거실", "주방", "안방", "욕실", "화장실", "세탁실", "다용도실", "창고", "현관", "기타"] as const;

// ---------------------------------------------------------------- ownership / rental (migration 0009)
export const OWNERSHIP_TYPES = ["OWNED", "RENTAL"] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const CARE_TYPES = ["NONE", "VISIT", "SELF"] as const;
export type CareType = (typeof CARE_TYPES)[number];

export const OWNERSHIP_LABEL: Record<OwnershipType, string> = { OWNED: "직접 구매", RENTAL: "렌탈·구독" };
export const CARE_LABEL: Record<CareType, string> = { NONE: "없음", VISIT: "방문 코디", SELF: "자가 관리" };

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dateField = z.string().refine(isRealDate, "날짜 형식이 올바르지 않아요.").nullish();

/**
 * Rental details. The DB only guards ownership_type / care_type / billing_day (CHECK constraints); everything else
 * (non-negative fee, contract order, "required provider for rentals") is enforced HERE, on the server.
 */
export const rentalInputSchema = z
  .object({
    provider: z.string().trim().min(1, "렌탈사명을 입력해 주세요.").max(50, "렌탈사명은 50자 이하예요."),
    monthlyFee: z.number().int("월 렌탈료는 정수(원)로 입력해 주세요.").min(0, "월 렌탈료는 0원 이상이에요.").max(10_000_000, "월 렌탈료가 너무 커요.").nullish(),
    billingDay: z.number().int().min(1, "결제일은 1~31일이에요.").max(31, "결제일은 1~31일이에요.").nullish(),
    contractStartDate: dateField,
    obligationEndDate: dateField,
    ownershipTransferDate: dateField,
    careType: z.enum(CARE_TYPES).default("NONE"),
    paymentCardNote: z.string().trim().max(200, "제휴카드 메모는 200자 이하예요.").nullish(),
  })
  .refine((v) => !v.contractStartDate || !v.obligationEndDate || v.obligationEndDate >= v.contractStartDate, {
    message: "약정 만료일은 계약 시작일보다 빠를 수 없어요.",
    path: ["obligationEndDate"],
  });

export type RentalInput = z.input<typeof rentalInputSchema>;

export const presetTaskSchema = z.object({
  title: z.string().min(1).max(200),
  recurring_type: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval_n: z.number().int().min(1).max(120),
  anchor: z.enum(["DUE_DATE", "COMPLETION_DATE"]),
});

export const addPresetInputSchema = z
  .object({
    presetKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
    visibility: z.enum(["FAMILY", "PRIVATE"]).default("FAMILY"),
    // Both optional: callers that only send {presetKey, visibility} keep working and register an OWNED asset.
    ownershipType: z.enum(OWNERSHIP_TYPES).default("OWNED"),
    rental: rentalInputSchema.optional(),
  })
  .refine((v) => v.ownershipType !== "RENTAL" || !!v.rental, { message: "렌탈 정보를 입력해 주세요.", path: ["rental"] });

/**
 * Asset edit. visibility is intentionally NOT editable (the asset's rules/tasks carry their own visibility, so a
 * silent change here could expose or hide them inconsistently). Switching RENTAL -> OWNED clears the rental data.
 */
export const updateAssetInputSchema = z
  .object({
    assetId: z.uuid(),
    name: z.string().trim().min(1, "이름을 입력해 주세요.").max(100, "이름은 100자 이하예요."),
    space: z.string().trim().max(30, "위치는 30자 이하예요.").nullish(),
    category: z.string().trim().max(50, "카테고리는 50자 이하예요.").nullish(),
    note: z.string().trim().max(500, "메모는 500자 이하예요.").nullish(),
    modelName: z.string().trim().max(100, "모델명은 100자 이하예요.").nullish(),
    ownershipType: z.enum(OWNERSHIP_TYPES),
    rental: rentalInputSchema.optional(),
  })
  .refine((v) => v.ownershipType !== "RENTAL" || !!v.rental, { message: "렌탈 정보를 입력해 주세요.", path: ["rental"] });

export type UpdateAssetInput = z.input<typeof updateAssetInputSchema>;
export type UpdateAssetResult = { ok: true } | { ok: false; error: string };

export type PresetTask = z.infer<typeof presetTaskSchema>;
export type AddPresetInput = z.input<typeof addPresetInputSchema>;

export type AppliancePreset = {
  preset_key: string;
  name_ko: string;
  category: string;
  default_space: string;
  sort_order: number;
  default_tasks: PresetTask[];
};

export type AssetRule = {
  id: string;
  title: string;
  recurring_type: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval_n: number;
  consumable_name: string | null;
  consumable_model: string | null;
  custom_purchase_url: string | null;
};

export type AssetTask = {
  id: string;
  title: string;
  due_date: string; // 'YYYY-MM-DD'
  status: "PENDING" | "SNOOZED";
  rule_id: string | null;
};

/** The 9 columns added by migration 0009 (all nullable in the DB; ownership_type / care_type default to OWNED / NONE). */
export type RentalColumns = {
  ownership_type: OwnershipType | null;
  rental_provider: string | null;
  monthly_fee: number | null;
  billing_day: number | null;
  contract_start_date: string | null; // 'YYYY-MM-DD'
  obligation_end_date: string | null; // 'YYYY-MM-DD' — penalty-free from this date
  ownership_transfer_date: string | null; // 'YYYY-MM-DD'
  care_type: CareType | null;
  payment_card_note: string | null;
};

export type Asset = RentalColumns & {
  id: string;
  name: string;
  space: string | null;
  category: string | null;
  preset_key: string | null;
  note: string | null;
  model_name: string | null;
  visibility: "FAMILY" | "PRIVATE";
  created_at: string;
  task_rules: AssetRule[];
  tasks: AssetTask[]; // open tasks only (see getAssets)
};

export const isRental = (a: Pick<Asset, "ownership_type">) => a.ownership_type === "RENTAL";

export type ActionResult =
  | { ok: true; assetId: string; ruleCount: number }
  | { ok: false; error: string };
