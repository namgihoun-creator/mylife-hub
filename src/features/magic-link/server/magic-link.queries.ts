import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { isPlausibleToken, sha256Hex } from "@/shared/lib/token";

export type MagicTaskInfo = {
  householdName: string;
  taskTitle: string;
  dueDate: string; // 'YYYY-MM-DD'
  assetName: string | null;
  presetKey: string | null;
  space: string | null;
};

export type MagicLinkView =
  | { kind: "ready"; info: MagicTaskInfo; expiresAt: string }
  | { kind: "done"; info: MagicTaskInfo; completedAt: string | null }
  | { kind: "invalid" };

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Read-only lookup for the GET page. NEVER consumes the token or changes the task
 * (consumption happens only in the POST route -> complete_via_magic_token).
 * Unknown / expired / unusable tokens all collapse into the same "invalid" view.
 */
export async function getMagicLinkView(token: string): Promise<MagicLinkView> {
  if (!isPlausibleToken(token)) return { kind: "invalid" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("magic_tokens")
    .select(
      "consumed_at, expires_at, households(name), tasks(title, due_date, status, completed_at, assets(name, preset_key, space))",
    )
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (error || !data) return { kind: "invalid" };

  const household = one(data.households as { name: string } | { name: string }[] | null);
  const task = one(
    data.tasks as
      | { title: string; due_date: string; status: string; completed_at: string | null; assets: unknown }
      | { title: string; due_date: string; status: string; completed_at: string | null; assets: unknown }[]
      | null,
  );
  if (!household || !task) return { kind: "invalid" };

  const asset = one(
    task.assets as { name: string; preset_key: string | null; space: string | null } | { name: string; preset_key: string | null; space: string | null }[] | null,
  );
  const info: MagicTaskInfo = {
    householdName: household.name,
    taskTitle: task.title,
    dueDate: task.due_date,
    assetName: asset?.name ?? null,
    presetKey: asset?.preset_key ?? null,
    space: asset?.space ?? null,
  };

  // Consumed token or already-completed task (e.g. done in the app) -> "already done".
  if (data.consumed_at || task.status === "COMPLETED") {
    return { kind: "done", info, completedAt: task.completed_at ?? (data.consumed_at as string | null) };
  }
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return { kind: "invalid" };
  if (task.status !== "PENDING" && task.status !== "SNOOZED") return { kind: "invalid" };

  return { kind: "ready", info, expiresAt: data.expires_at as string };
}
