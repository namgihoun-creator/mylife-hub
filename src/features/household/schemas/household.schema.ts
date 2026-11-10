import { z } from "zod";

/** Invite codes are base64url (see shared/lib/token.ts); the strict shape also makes `/invite/${code}` redirects safe. */
export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{16,512}$/);
export const displayNameSchema = z.string().trim().min(1).max(50);

export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;

const rows = (max: number) => z.array(z.record(z.string(), z.unknown())).max(max);

/** Light structural validation; the restore RPC re-validates types and ownership inside the transaction. */
export const backupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  assets: rows(5000).default([]),
  task_rules: rows(5000).default([]),
  tasks: rows(5000).default([]),
  event_logs: rows(20000).default([]),
});

export type Member = { id: string; display_name: string; role: "ADMIN" | "MEMBER" };

export type Counts = { inserted: number; total: number };
export type RestoreSummary = {
  assets: Counts;
  task_rules: Counts;
  tasks: Counts;
  event_logs: Counts;
};

export type InviteStatus = "ACTIVE" | "USED" | "EXPIRED" | "INVALID";
export type InvitePreview = { status: InviteStatus; householdName: string | null };
