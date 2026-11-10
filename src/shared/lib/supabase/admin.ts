import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client (bypasses RLS). SERVER ONLY — `server-only` makes any client import a build error.
 * CLAUDE.md §4.E: use only for back-channel work that cannot go through the user's JWT:
 *  - magic_tokens access (the table is closed to anon/authenticated),
 *  - POST /api/tasks/magic-complete -> complete_via_magic_token (granted to service_role only).
 * Callers must authorize the request themselves before using it.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
