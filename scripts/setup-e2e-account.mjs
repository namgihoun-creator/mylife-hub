// Creates a dedicated TEST account + household in the Supabase project from .env.local and
// stores its credentials as E2E_EMAIL / E2E_PASSWORD in .env.local (never printed).
// Usage: node --env-file=.env.local scripts/setup-e2e-account.mjs
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";

const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, E2E_EMAIL } = process.env;
if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing in .env.local");
if (E2E_EMAIL) {
  console.log("E2E_EMAIL already set in .env.local — nothing to do.");
  process.exit(0);
}

const email = `mylife.e2e+${randomBytes(4).toString("hex")}@example.com`;
const password = randomBytes(15).toString("base64url"); // 20 chars

const supabase = createClient(url, anon, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.signUp({ email, password });
if (error) {
  console.error(`signUp failed: ${error.message}`);
  process.exit(1);
}
if (!data.session) {
  console.error("signUp succeeded but no session was returned (e-mail confirmation is ON). Disable it for dev or confirm the account manually.");
  process.exit(2);
}

const { error: hhError } = await supabase.rpc("create_household", {
  p_name: "E2E 테스트 가구",
  p_display_name: "E2E",
});
if (hhError) {
  console.error(`create_household failed: ${hhError.message}`);
  process.exit(3);
}

await appendFile(".env.local", `\n# Dedicated test account for \`npm run screens\` (created by scripts/setup-e2e-account.mjs)\nE2E_EMAIL=${email}\nE2E_PASSWORD=${password}\n`);
console.log("Test account + household created. Credentials saved to .env.local (E2E_EMAIL / E2E_PASSWORD).");
