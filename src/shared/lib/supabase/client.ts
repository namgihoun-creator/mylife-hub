import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/** Supabase client for Client Components (browser). */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
