import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calls the create_household(p_name, p_display_name) RPC: creates the household and
 * the caller's ADMIN profile in one transaction. Returns an error message or null.
 */
export async function bootstrapHousehold(
  supabase: SupabaseClient,
  input: { householdName: string; displayName: string },
): Promise<string | null> {
  const { error } = await supabase.rpc("create_household", {
    p_name: input.householdName,
    p_display_name: input.displayName,
  });
  if (!error) return null;
  // 23505 = profile already exists (already bootstrapped): treat as success.
  if (error.code === "23505") return null;
  return error.message;
}
