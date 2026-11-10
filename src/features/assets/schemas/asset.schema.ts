import { z } from "zod";

export const SPACES = ["거실", "주방", "안방", "욕실", "화장실", "세탁실", "다용도실", "창고", "현관", "기타"] as const;

export const presetTaskSchema = z.object({
  title: z.string().min(1).max(200),
  recurring_type: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval_n: z.number().int().min(1).max(120),
  anchor: z.enum(["DUE_DATE", "COMPLETION_DATE"]),
});

export const addPresetInputSchema = z.object({
  presetKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
  visibility: z.enum(["FAMILY", "PRIVATE"]).default("FAMILY"),
});

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
};

export type AssetTask = {
  id: string;
  title: string;
  due_date: string; // 'YYYY-MM-DD'
  status: "PENDING" | "SNOOZED";
  rule_id: string | null;
};

export type Asset = {
  id: string;
  name: string;
  space: string | null;
  category: string | null;
  preset_key: string | null;
  visibility: "FAMILY" | "PRIVATE";
  created_at: string;
  task_rules: AssetRule[];
  tasks: AssetTask[]; // open tasks only (see getAssets)
};

export type ActionResult =
  | { ok: true; assetId: string; ruleCount: number }
  | { ok: false; error: string };
