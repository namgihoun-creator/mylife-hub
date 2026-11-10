import { cache } from "react";
import { createClient } from "@/shared/lib/supabase/server";

export type SessionProfile = {
  householdId: string;
  householdName: string;
  role: "ADMIN" | "MEMBER";
  displayName: string;
};

/** Current user + profile (null profile = signed in but household not created yet). Deduped per request. */
export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null as SessionProfile | null };

  const { data } = await supabase
    .from("profiles")
    .select("household_id, role, display_name, households(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return { user, profile: null as SessionProfile | null };

  const household = data.households as unknown as { name: string } | { name: string }[] | null;
  const householdName = Array.isArray(household) ? household[0]?.name : household?.name;

  const profile: SessionProfile = {
    householdId: data.household_id as string,
    householdName: householdName ?? "",
    role: data.role as "ADMIN" | "MEMBER",
    displayName: data.display_name as string,
  };
  return { user, profile };
});
