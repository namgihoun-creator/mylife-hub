import { z } from "zod";
import { safeHttpUrl } from "@/features/tasks/utils/purchase-link";

/** Optional consumable block shared by rule create / edit (all fields optional; empty string = cleared). */
const optionalText = (max: number, msg: string) => z.string().trim().max(max, msg).nullish();

export const consumableFieldsSchema = z.object({
  consumableName: optionalText(100, "소모품 이름은 100자 이하예요."),
  consumableModel: optionalText(100, "소모품 모델명은 100자 이하예요."),
  customPurchaseUrl: z
    .string()
    .trim()
    .max(2048, "구매 링크가 너무 길어요.")
    .nullish()
    .refine((v) => !v || safeHttpUrl(v) !== null, { message: "구매 링크는 http:// 또는 https:// 로 시작하는 주소여야 해요." }),
});

export const RULE_RECURRING = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RuleRecurring = (typeof RULE_RECURRING)[number];
export const RULE_RECURRING_LABEL: Record<RuleRecurring, string> = { DAILY: "일", WEEKLY: "주", MONTHLY: "개월", YEARLY: "년" };

export const createRuleInputSchema = consumableFieldsSchema.extend({
  assetId: z.uuid(),
  title: z.string().trim().min(1, "규칙 이름을 입력해 주세요.").max(200, "규칙 이름은 200자 이하예요."),
  recurringType: z.enum(RULE_RECURRING),
  intervalN: z.number().int("주기는 정수여야 해요.").min(1, "주기는 1 이상이에요.").max(120, "주기는 120 이하예요."),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "첫 예정일을 입력해 주세요."),
});

export const updateRuleConsumableInputSchema = consumableFieldsSchema.extend({ ruleId: z.uuid() });

export type CreateRuleInput = z.input<typeof createRuleInputSchema>;
export type UpdateRuleConsumableInput = z.input<typeof updateRuleConsumableInputSchema>;
export type RuleActionResult = { ok: true; updatedTasks?: number } | { ok: false; error: string };
