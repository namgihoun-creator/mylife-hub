import { z } from "zod";

export const BILL_TYPES = ["ELECTRICITY", "GAS", "WATER", "MAINTENANCE", "INTERNET", "ETC"] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const BILL_LABEL: Record<BillType, string> = {
  ELECTRICITY: "전기",
  GAS: "도시가스",
  WATER: "수도",
  MAINTENANCE: "아파트 관리비",
  INTERNET: "통신비",
  ETC: "기타",
};

/** A row of utility_bills (migration 19). */
export type UtilityBill = {
  id: string;
  bill_type: BillType;
  billing_month: string; // 'YYYY-MM'
  amount: number;
  due_date: string | null;
  provider_name: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: string;
};

/** What the AI (or the manual form) hands over before saving. */
export type BillDraft = { billType: BillType; billingMonth: string; amount: number; dueDate: string | null; providerName: string | null; memo?: string | null };

const text = (max: number) => z.string().trim().max(max);

export const billInputSchema = z.object({
  billType: z.enum(BILL_TYPES, "고지서 종류를 골라 주세요."),
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "청구 월은 2026-10 형식으로 적어 주세요."),
  amount: z.number("금액을 숫자로 적어 주세요.").int("금액은 원 단위 정수로 적어 주세요.").min(0, "금액은 0원 이상이에요.").max(100_000_000, "금액이 너무 커요."),
  dueDate: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine((v) => v == null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), "납부 기한 날짜가 올바르지 않아요."),
  providerName: text(50).transform((v) => (v === "" ? null : v)).nullable().optional(),
  memo: text(200).transform((v) => (v === "" ? null : v)).nullable().optional(),
});
export type BillInput = z.input<typeof billInputSchema>;

export const billIdSchema = z.object({ id: z.uuid() });

export const analyzeBillBodySchema = z.object({
  imageBase64: z.string().min(16, "사진이 없어요."),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"], "JPG, PNG, WEBP 사진만 올릴 수 있어요."),
});

export type BillActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; notReady?: boolean };
