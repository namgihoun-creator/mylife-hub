import { z } from "zod";
import type { RecurringType } from "@/shared/lib/recurrence";

export const taskIdSchema = z.uuid();
export const idempotencyKeySchema = z.string().min(8).max(128);
export const snoozeDaysSchema = z.number().int().min(1).max(60);

export type TimelineTask = {
  id: string;
  title: string;
  due_date: string; // 'YYYY-MM-DD' (Asia/Seoul)
  status: "PENDING" | "SNOOZED" | "COMPLETED";
  completed_at: string | null;
  rule_id: string | null; // null = one-off task (cannot be skipped)
  iteration_no: number | null;
  asset: { name: string; preset_key: string | null; space: string | null; category: string | null } | null;
  rule: { recurring_type: RecurringType; interval_n: number } | null;
  /** Client-only optimistic marker (never sent by the server). */
  pending?: "done" | "skipped";
};

export type TimelineActionResult =
  | { ok: true; nextTaskId?: string | null; alreadyDone?: boolean }
  | { ok: false; error: string };
