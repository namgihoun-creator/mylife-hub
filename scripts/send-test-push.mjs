// Sends ONE real test push to an account so you can see the OS notification popup.
//
//   1) In your browser (http://localhost:3000): sign in -> bell icon -> turn "푸시 알림" ON -> Allow.
//   2) npm run push:test -- you@example.com ["title"] ["body"]
//
// What it does: finds the account, checks it has a subscribed device, inserts one notification row
// (service role) and triggers POST /api/push/dispatch scoped to that user (Bearer CRON_SECRET).
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const [email, title = "MyLife Hub 테스트 알림", body = "푸시 알림이 정상적으로 도착했어요 🎉"] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));

const fail = (msg, code = 1) => {
  console.error(`\n✗ ${msg}`);
  process.exit(code);
};

if (!email) fail('Usage: npm run push:test -- <account-email> ["title"] ["body"]', 2);

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey, CRON_SECRET: cronSecret } = process.env;
if (!url || !serviceKey || !cronSecret) {
  fail("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET must be set in .env.local", 2);
}

const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// 1) account -> user id
let userId = null;
for (let page = 1; page <= 10 && !userId; page++) {
  const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  if (data.users.length < 200) break;
}
if (!userId) fail(`No account with the e-mail "${email}" in this Supabase project.`);

const { data: profile } = await svc.from("profiles").select("household_id").eq("id", userId).maybeSingle();
if (!profile) fail("This account has no household yet (finish the household setup in the app first).");

// 2) must have a subscribed device — otherwise the dispatcher would mark the notification as handled and the push is lost
const { data: subs } = await svc.from("push_subscriptions").select("endpoint").eq("user_id", userId);
if (!subs?.length) {
  fail(
    "No push-enabled device for this account.\n" +
      `  → Open ${BASE}, sign in as this account, click the bell icon, turn "푸시 알림" ON and press Allow.\n` +
      "  → Then run this command again.",
    3,
  );
}
console.log(`✓ ${subs.length} subscribed device(s): ${subs.map((s) => new URL(s.endpoint).host).join(", ")}`);

// 3) one notification row
const { data: notification, error: insertError } = await svc
  .from("notifications")
  .insert({
    household_id: profile.household_id,
    user_id: userId,
    type: "DUE_TODAY",
    title,
    body,
    dedupe_key: `manual-test-${Date.now()}`,
  })
  .select("id")
  .single();
if (insertError) fail(`Could not create the notification: ${insertError.message}`);
console.log(`✓ notification created (${notification.id})`);

// 4) dispatch (scoped to this user so nobody else's pending notifications are touched)
let res;
try {
  res = await fetch(`${BASE}/api/push/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_ids: [userId] }),
  });
} catch {
  fail(`Could not reach ${BASE}. Is "npm run dev" running?`);
}
const result = await res.json().catch(() => null);
console.log(`✓ dispatch → HTTP ${res.status}`, JSON.stringify(result));

if (res.status === 401) fail("Dispatch rejected the secret: the running server was started with a different CRON_SECRET (restart it).");
if (!result?.ok) fail("Dispatch failed — see the response above.");

if (result.pushesSent > 0) {
  console.log("\n🎉 Push handed to the browser's push service. The OS popup should appear within a few seconds.");
  console.log("   Nothing showing? Check: browser still running · site notifications allowed (lock icon in the address bar) ·");
  console.log("   Windows Focus Assist / Do Not Disturb off · OS notifications enabled for your browser.");
  console.log("   Click the popup: it opens /timeline (same origin).");
} else if (result.expiredSubscriptionsRemoved > 0) {
  console.log("\n⚠ The push service said the subscription is gone (404/410) and it was removed.");
  console.log('   Turn "푸시 알림" OFF and ON again in the browser, then re-run this command.');
} else if (result.released > 0) {
  console.log("\n⚠ Temporary push-service error: the notification was released and will be retried on the next dispatch run.");
} else {
  console.log("\n⚠ Nothing was sent (see the counters above).");
}
