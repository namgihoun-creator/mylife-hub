import { createClient } from "@/shared/lib/supabase/server";
import { sha256Hex } from "@/shared/lib/token";
import type { InvitePreview, InviteStatus, Member } from "../schemas/household.schema";

/** Household members (RLS: own household only). */
export async function getMembers(): Promise<Member[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, role")
    .order("created_at", { ascending: true });
  return (data ?? []) as Member[];
}

/** Read-only invite lookup via get_invite_preview (callable before login). Never consumes the invite. */
export async function getInvitePreview(code: string): Promise<InvitePreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", { p_code_hash: await sha256Hex(code) });
  if (error || !data) return { status: "INVALID", householdName: null };
  const r = data as { status: InviteStatus; household_name?: string };
  return { status: r.status, householdName: r.household_name ?? null };
}
