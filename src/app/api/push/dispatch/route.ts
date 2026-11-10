import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runPushDispatch } from "@/features/notifications/server/push-dispatch";
import { configureVapid } from "@/shared/lib/push/sender";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // generate + send + cleanup in one run

const NO_STORE = { "Cache-Control": "no-store" };

const optionsSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    // Scope a run to specific users (operations / tests); omitted = every pending notification.
    user_ids: z.array(z.uuid()).max(100).optional(),
    // Pipeline stages. Cron (GET) runs all of them; a manual POST only dispatches unless asked.
    generate: z.boolean().optional(), // generate_due_notifications() before sending
    cleanup: z.boolean().optional(), // cleanup_old_notifications() after sending
    household_id: z.uuid().optional(), // limit the generator to one household (operations / tests)
  })
  .strict();

type Options = z.infer<typeof optionsSchema>;

/** GET (Vercel Cron) takes the same options from the query string: ?generate=0&cleanup=0&household_id=…&user_ids=a,b */
function optionsFromQuery(url: URL): unknown {
  const q = url.searchParams;
  const flag = (k: string) => (q.has(k) ? !["0", "false"].includes(q.get(k)!) : undefined);
  return {
    ...(q.get("limit") ? { limit: Number(q.get("limit")) } : {}),
    ...(q.get("user_ids") ? { user_ids: q.get("user_ids")!.split(",").filter(Boolean) } : {}),
    ...(q.get("household_id") ? { household_id: q.get("household_id") } : {}),
    ...(flag("generate") !== undefined ? { generate: flag("generate") } : {}),
    ...(flag("cleanup") !== undefined ? { cleanup: flag("cleanup") } : {}),
  };
}

/** null = CRON_SECRET not configured (never "open"), false = wrong/missing credentials. Constant-time compare. */
function checkAuth(request: Request): boolean | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  const auth = checkAuth(request);
  if (auth === null) {
    return NextResponse.json({ ok: false, error: "NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (!auth) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": "Bearer" } });
  }

  const vapidProblem = configureVapid();
  if (vapidProblem) {
    return NextResponse.json({ ok: false, error: "VAPID_NOT_CONFIGURED", message: vapidProblem }, { status: 503, headers: NO_STORE });
  }

  // Options: POST JSON body, or the query string on GET (what a cron service calls).
  const isCron = request.method === "GET";
  let rawOptions: unknown = {};
  if (isCron) {
    rawOptions = optionsFromQuery(new URL(request.url));
  } else {
    const text = await request.text();
    if (text.trim()) {
      try {
        rawOptions = JSON.parse(text);
      } catch {
        return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      }
    }
  }
  const parsedOptions = optionsSchema.safeParse(rawOptions);
  if (!parsedOptions.success) return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  const options: Options = parsedOptions.data;

  // Cron = the full daily pipeline (generate -> send -> cleanup). A manual POST stays a plain dispatch unless asked.
  const runGenerate = options.generate ?? isCron;
  const runCleanup = options.cleanup ?? isCron;

  const admin = createAdminClient();

  // 0) Generate due-date notifications (D-3 / D-Day / overdue). A failure must not block already-pending pushes.
  let generated: unknown = null;
  let generateError: string | null = null;
  if (runGenerate) {
    const { data, error } = await admin.rpc("generate_due_notifications", { p_household_id: options.household_id ?? null });
    if (error) generateError = error.message;
    else generated = data;
  }

  // 1) Claim + send + expired-subscription cleanup (shared with the instant triggers).
  const result = await runPushDispatch({ limit: options.limit, userIds: options.user_ids });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status: result.error === "CLAIM_FAILED" ? 500 : 503, headers: NO_STORE });
  }

  // 2) Retention (read > 30 days / created > 90 days). Global housekeeping; a failure is reported, never fatal.
  let cleanedUp: number | null = null;
  let cleanupError: string | null = null;
  if (runCleanup) {
    const { data, error } = await admin.rpc("cleanup_old_notifications");
    if (error) cleanupError = error.message;
    else cleanedUp = typeof data === "number" ? data : 0;
  }

  return NextResponse.json(
    {
      ok: true,
      ...result.stats,
      generated, // { date, due_soon, due_today, overdue, total } or null when the stage did not run
      ...(generateError ? { generateError } : {}),
      cleanedUp, // number of deleted notifications or null when the stage did not run
      ...(cleanupError ? { cleanupError } : {}),
    },
    { headers: NO_STORE },
  );
}

export const POST = handle;
export const GET = handle;
