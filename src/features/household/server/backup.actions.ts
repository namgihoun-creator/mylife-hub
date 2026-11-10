"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/features/auth/server/session";
import {
  BACKUP_MAX_BYTES,
  BACKUP_VERSION,
  backupSchema,
  type RestoreSummary,
} from "../schemas/household.schema";

const PAGE = 1000; // PostgREST returns at most 1000 rows per request
const MAX_ROWS = { assets: 5000, task_rules: 5000, tasks: 5000, event_logs: 20000 } as const;

const COLUMNS = {
  assets: "id, visibility, name, space, category, preset_key, note, created_at",
  task_rules:
    "id, visibility, asset_id, title, recurring_type, interval_n, anchor, day_of_month, timezone, next_iteration_no, active, created_at",
  tasks:
    "id, visibility, asset_id, rule_id, iteration_no, title, due_date, status, completed_at, snoozed_until, created_at",
  event_logs: "id, visibility, task_id, asset_id, event_type, actor_identifier, payload, created_at",
} as const;

type Table = keyof typeof COLUMNS;

export type ExportResult =
  | { ok: true; filename: string; json: string; counts: Record<Table, number>; truncated: boolean }
  | { ok: false; error: string };
export type ImportResult = { ok: true; summary: RestoreSummary } | { ok: false; error: string };

type AdminCheck = { ok: false; error: string } | { ok: true; profile: SessionProfile };

async function requireAdmin(): Promise<AdminCheck> {
  const { user, profile } = await getSessionProfile();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!profile) return { ok: false, error: "가구 설정이 필요합니다." };
  if (profile.role !== "ADMIN") return { ok: false, error: "백업과 복구는 관리자만 할 수 있어요." };
  return { ok: true, profile };
}

/**
 * Full household export (assets, rules, tasks incl. completed/skipped, event log) as JSON text.
 * Runs under the caller's JWT, so the file contains exactly what the admin may see under RLS:
 * FAMILY data plus the admin's own PRIVATE data — other members' PRIVATE data never leaves the DB.
 * Secrets (magic tokens, idempotency keys, invites) and Storage binaries are not included.
 */
export async function exportBackup(): Promise<ExportResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const counts = { assets: 0, task_rules: 0, tasks: 0, event_logs: 0 } as Record<Table, number>;
  const data = {} as Record<Table, unknown[]>;
  let truncated = false;

  for (const table of Object.keys(COLUMNS) as Table[]) {
    const rows: unknown[] = [];
    for (let from = 0; rows.length < MAX_ROWS[table]; from += PAGE) {
      const { data: page, error } = await supabase
        .from(table)
        // Cast: a union of four literal column lists makes supabase-js' type parser explode (TS2590).
        .select(COLUMNS[table] as string)
        .eq("household_id", auth.profile.householdId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return { ok: false, error: `${table} 내보내기에 실패했어요: ${error.message}` };
      rows.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
      if (rows.length >= MAX_ROWS[table]) truncated = true;
    }
    data[table] = rows.slice(0, MAX_ROWS[table]);
    counts[table] = data[table].length;
  }

  const exportedAt = new Date().toISOString();
  const json = JSON.stringify(
    {
      version: BACKUP_VERSION,
      app: "mylife-hub",
      exported_at: exportedAt,
      household: { name: auth.profile.householdName },
      truncated,
      ...data,
    },
    null,
    2,
  );
  return { ok: true, filename: `mylife-backup-${exportedAt.slice(0, 10).replaceAll("-", "")}.json`, json, counts, truncated };
}

/**
 * Restores a backup file into the caller's household in ONE transaction (restore_household_backup):
 * rows are re-owned by the admin, forced into this household, merged by id (existing ids are skipped,
 * so importing the same file twice is a no-op) and foreign references are dropped.
 */
export async function importBackup(jsonText: unknown): Promise<ImportResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (typeof jsonText !== "string" || jsonText.length === 0) return { ok: false, error: "백업 파일이 비어 있어요." };
  if (jsonText.length > BACKUP_MAX_BYTES) return { ok: false, error: "백업 파일이 너무 커요 (최대 5MB)." };

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "올바른 JSON 파일이 아니에요." };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "MyLife Hub 백업 파일(version 1) 형식이 아니에요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_household_backup", { p_payload: parsed.data });
  if (error) {
    if (error.message === "INVALID_BACKUP") return { ok: false, error: "MyLife Hub 백업 파일(version 1) 형식이 아니에요." };
    if (error.message === "BACKUP_TOO_LARGE") return { ok: false, error: "백업에 담긴 항목이 너무 많아요." };
    if (error.message === "NOT_AUTHORIZED") return { ok: false, error: "백업과 복구는 관리자만 할 수 있어요." };
    // 22xxx = bad value/type, 23xxx = constraint: the file was malformed. The transaction rolled back.
    if (error.code?.startsWith("22") || error.code?.startsWith("23")) {
      return { ok: false, error: "백업 파일의 데이터가 올바르지 않아 복구하지 못했어요. (아무것도 변경되지 않았어요)" };
    }
    return { ok: false, error: "복구 중 오류가 발생했어요. (아무것도 변경되지 않았어요)" };
  }

  revalidatePath("/assets");
  revalidatePath("/timeline");
  return { ok: true, summary: data as RestoreSummary };
}
