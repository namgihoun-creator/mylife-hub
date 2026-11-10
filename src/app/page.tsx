import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";

// Thin route: branch on auth state only.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/assets" : "/login");
}
