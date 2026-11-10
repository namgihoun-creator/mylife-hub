// Screenshot capture + DOM sanity checks for docs/DESIGN_SYSTEM.md v2.
// Usage: npm run screens   (dev server must be running; needs E2E_EMAIL / E2E_PASSWORD in .env.local)
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

// Syntactically valid fake subscription keys (65-byte P-256 point / 16-byte auth secret, base64url).
const fakeKeys = () => ({
  p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
});

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const OUT = ".screenshots";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 812 },
];

const results = []; // { page, viewport, check, ok, detail }
const record = (page, viewport, check, ok, detail = "") => results.push({ page, viewport, check, ok, detail });

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function newContext(vp, storageState) {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    storageState,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
}

// ---------------------------------------------------------------- login (once)
let storageState;
{
  const ctx = await newContext(VIEWPORTS[0]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  if (!EMAIL || !PASSWORD) {
    await page.screenshot({ path: `${OUT}/login-desktop.png`, fullPage: true });
    console.error("E2E_EMAIL / E2E_PASSWORD are not set (.env.local). Captured /login only.");
    await browser.close();
    process.exit(2);
  }

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  } catch {
    const msg = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    await page.screenshot({ path: `${OUT}/login-failed.png`, fullPage: true });
    console.error(`Login failed${msg ? `: ${msg}` : ""}`);
    await browser.close();
    process.exit(3);
  }
  await page.waitForLoadState("networkidle");
  if (await page.getByText("가구 만들기").count()) {
    await page.screenshot({ path: `${OUT}/household-setup.png`, fullPage: true });
    console.error("Account has no household yet (setup form shown). Create one first, then re-run.");
    await browser.close();
    process.exit(4);
  }
  storageState = await ctx.storageState();
  await ctx.close();
}

// Test user's own API session (RLS applies) — used for sandbox rows and for spreading due dates.
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
{
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`API sign-in failed: ${error.message}`);
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const shift = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// Dev-tooling only: service role lets the script create/delete a throw-away second user for the invite flow.
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// ---------------------------------------------------------------- seed sample data (only when the account is empty)
// Goes through the real UI (preset modal -> addAssetFromPreset), then spreads due dates through the test
// user's own session (RLS) so overdue / today / soon / ok states are all visible in the captures.
const SEED_PRESETS = ["냉장고", "정수기", "세탁기", "에어컨", "공기청정기", "로봇청소기"];
{
  const ctx = await newContext(VIEWPORTS[0], storageState);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
  const existing = await page.locator("main h3").allTextContents();
  const missing = SEED_PRESETS.filter((n) => !existing.some((e) => e.trim().startsWith(n)));
  if (missing.length > 0 && process.env.E2E_SEED !== "0") {
    console.log(`Seeding sample appliances through the UI: ${missing.join(", ")}…`);
    await page.getByRole("button", { name: "가전 추가" }).first().click();
    const dialog = page.getByRole("dialog");
    for (const name of missing) {
      await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
      await page.waitForTimeout(200);
      await page.waitForFunction(
        () => ![...document.querySelectorAll('[role="dialog"] ul button')].some((b) => b.disabled),
        null,
        { timeout: 30_000 },
      );
    }
    const err = await dialog.locator('[role="alert"]').count();
    if (err) console.error("Seeding showed an error:", await dialog.locator('[role="alert"]').first().textContent());
    await page.keyboard.press("Escape");

    const { data: tasks } = await sb.from("tasks").select("id").eq("status", "PENDING").order("created_at");
    const offsets = [-3, -1, 0, 0, 2, 5, 9, 14, 30]; // overdue, overdue, today, today, soon…, ok
    for (const [i, t] of (tasks ?? []).slice(0, offsets.length).entries()) {
      await sb.from("tasks").update({ due_date: shift(offsets[i]) }).eq("id", t.id);
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------- checks
const overflowCheck = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function checkCommon(page, name, vp) {
  const consoleErrors = page.__errors;
  record(name, vp.name, "no console/page errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  const overflowOk = await overflowCheck(page);
  const offenders = overflowOk
    ? ""
    : await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("main *")]
          .filter((el) => el.getBoundingClientRect().right > vw + 1)
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`)
          .join(", ");
      });
  record(name, vp.name, "no horizontal overflow", overflowOk, offenders);

  const header = await page.evaluate(() => {
    const h = document.querySelector("header");
    if (!h) return null;
    const cs = getComputedStyle(h);
    return { position: cs.position, blur: cs.backdropFilter || cs.webkitBackdropFilter || "" };
  });
  record(name, vp.name, "header sticky + backdrop blur", !!header && header.position === "sticky" && header.blur.includes("blur"), JSON.stringify(header));

  if (vp.name === "desktop") {
    const box = await page.locator("main").boundingBox();
    const centered = !!box && box.width <= 1152.5 && Math.abs(box.x * 2 + box.width - vp.width) <= 2;
    record(name, vp.name, "main is max-w-6xl & centered", centered, box ? `x=${box.x} w=${box.width}` : "no main");
  } else {
    const bottomNav = await page.locator('nav[aria-label="주요 메뉴"]').last().isVisible();
    record(name, vp.name, "mobile bottom tab bar visible", bottomNav);
  }
}

async function checkAssets(page, vp) {
  const banner = page.locator('section[aria-label="자산 현황 요약"]');
  const hasAssets = (await banner.count()) > 0;
  if (!hasAssets) {
    record("assets", vp.name, "hero banner / grid / gauge", true, "SKIPPED: no assets registered (empty state shown)");
    record("assets", vp.name, "empty state rendered", (await page.getByText("아직 등록된 가전이 없어요").count()) > 0);
    return;
  }
  record("assets", vp.name, "hero banner (3 stats)", (await banner.locator(":scope > div").count()) === 3);

  const cols = await page.evaluate(() => {
    const uls = [...document.querySelectorAll("main ul")].filter((u) => getComputedStyle(u).display === "grid");
    return uls.length ? getComputedStyle(uls[0]).gridTemplateColumns.split(" ").length : 0;
  });
  const want = vp.name === "desktop" ? 3 : 1;
  record("assets", vp.name, `card grid has ${want} column(s)`, cols === want, `got ${cols}`);

  const badges = await page.evaluate(
    () => [...document.querySelectorAll("main li span")].filter((s) => /^(D-\d+|D-Day|D\+\d+|예정 없음)$/.test(s.textContent.trim())).length,
  );
  const cards = await page.locator("main li").count();
  record("assets", vp.name, "D-Day badge on every card", badges >= cards && cards > 0, `badges=${badges} cards=${cards}`);

  const bars = await page.locator('[role="progressbar"]').count();
  const widths = await page.$$eval('[role="progressbar"] > div', (els) => els.map((e) => e.style.width));
  record("assets", vp.name, "gauge bars rendered", bars > 0, `bars=${bars} widths=${widths.slice(0, 4).join(",")}`);
}

async function checkTimeline(page, vp) {
  const banner = page.locator('section[aria-label="오늘의 과업 요약"]');
  record("timeline", vp.name, "hero banner (3 stats)", (await banner.locator(":scope > div").count()) === 3);

  const allClear = (await page.getByText("모든 가전 관리가 완료되었습니다!").count()) > 0;
  const empty = (await page.getByText("아직 등록된 과업이 없어요").count()) > 0;
  const cards = await page.locator("main li").count();
  if (allClear || empty || cards === 0) {
    record("timeline", vp.name, "task cards", true, `SKIPPED: ${allClear ? "all-clear" : "empty"} state shown`);
    return;
  }
  const badges = await page.evaluate(
    () => [...document.querySelectorAll("main li span")].filter((s) => /^(D-\d+|D-Day|D\+\d+)$/.test(s.textContent.trim())).length,
  );
  record("timeline", vp.name, "D-Day badges rendered", badges > 0, `badges=${badges}`);
  const sections = await page.locator("main section > button[aria-expanded]").allTextContents();
  record("timeline", vp.name, "section headers", sections.length > 0, sections.map((s) => s.trim().slice(0, 12)).join(" / "));
  record("timeline", vp.name, "complete buttons present", (await page.locator('button[aria-label$="완료"]').count()) > 0);
}

// ---------------------------------------------------------------- capture
for (const vp of VIEWPORTS) {
  const ctx = await newContext(vp, storageState);
  for (const route of ["assets", "timeline"]) {
    const page = await ctx.newPage();
    page.__errors = [];
    page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && page.__errors.push(`console: ${m.text()}`));

    await page.goto(`${BASE}/${route}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }); // hide the Next.js dev badge
    await page.waitForTimeout(700); // let enter animations / gauge transitions settle
    await page.screenshot({ path: `${OUT}/${route}-${vp.name}.png`, fullPage: true });

    await checkCommon(page, route, vp);
    if (route === "assets") await checkAssets(page, vp);
    else await checkTimeline(page, vp);
    await page.close();
  }
  await ctx.close();
}

// ---------------------------------------------------------------- Magic Link flow (share -> anonymous page -> complete)
// Sandbox: the flow runs on a throw-away one-off task created through the test user's session, so the
// real demo tasks are never consumed. Leftovers of a crashed earlier run are cleaned up first.
const SANDBOX_PREFIX = "E2E 임시 과업";
const { data: me } = await sb.auth.getUser();
const { data: myProfile } = await sb.from("profiles").select("household_id").eq("id", me.user.id).single();
await sb.from("tasks").delete().like("title", `${SANDBOX_PREFIX}%`);
const countRealOpen = async () =>
  (
    await sb
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["PENDING", "SNOOZED"])
      .not("title", "like", `${SANDBOX_PREFIX}%`)
  ).count;
const realOpenBefore = await countRealOpen();
const sandboxTitle = `${SANDBOX_PREFIX} ${Date.now()}`;
// Recurring sandbox (monthly rule + iteration 1) so completing it also proves next-iteration generation.
await sb.from("task_rules").delete().like("title", `${SANDBOX_PREFIX}%`);
const { data: sandboxRule, error: ruleError } = await sb
  .from("task_rules")
  .insert({
    household_id: myProfile.household_id,
    owner_id: me.user.id,
    title: sandboxTitle,
    recurring_type: "MONTHLY",
    interval_n: 1,
    anchor: "DUE_DATE",
    next_iteration_no: 2,
  })
  .select("id")
  .single();
if (ruleError) throw new Error(`sandbox rule insert failed: ${ruleError.message}`);
const { error: sandboxError } = await sb.from("tasks").insert({
  household_id: myProfile.household_id,
  owner_id: me.user.id,
  rule_id: sandboxRule.id,
  iteration_no: 1,
  title: sandboxTitle,
  due_date: shift(20),
});
if (sandboxError) throw new Error(`sandbox task insert failed: ${sandboxError.message}`);
{
  const ctx = await newContext(VIEWPORTS[0], storageState);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/timeline`, { waitUntil: "networkidle" });

  const card = page.locator("main li").filter({ hasText: sandboxTitle });
  await card.getByRole("button", { name: /더보기/ }).click();
  await page.getByRole("menuitem", { name: "가족에게 링크 공유" }).click();

  const toastShown = await page
    .getByText("공유 링크가 복사되었습니다!")
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record("timeline", "desktop", "share menu → toast “공유 링크가 복사되었습니다!”", toastShown);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: `${OUT}/timeline-share-toast-desktop.png` }); // viewport shot: the toast is position:fixed

  const url = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  const urlOk = /\/m\/[A-Za-z0-9_-]{86}$/.test(url);
  record("timeline", "desktop", "clipboard holds absolute /m/<64-byte token> URL", urlOk, url.replace(/\/m\/.+$/, "/m/…"));
  await ctx.close();

  if (urlOk) {
    const token = url.split("/m/")[1];
    const anon = await newContext(VIEWPORTS[1]); // NO storageState = not logged in
    const mp = await anon.newPage();
    mp.__errors = [];
    mp.on("pageerror", (e) => mp.__errors.push(`pageerror: ${e.message}`));
    mp.on("console", (m) => m.type() === "error" && mp.__errors.push(`console: ${m.text()}`));
    const V = "mobile";

    const resp = await mp.goto(url, { waitUntil: "networkidle" });
    record("magic", V, "public: 200 and no redirect to /login (middleware)", resp?.status() === 200 && mp.url() === url, `status=${resp?.status()}`);
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await mp.waitForTimeout(400);
    await mp.screenshot({ path: `${OUT}/magic-link-mobile.png`, fullPage: true });

    const button = mp.getByRole("button", { name: "이 과업 완료하기" });
    const box = await button.boundingBox();
    record("magic", V, "single big CTA “이 과업 완료하기” (>=48px tall, wide)", !!box && box.height >= 48 && box.width >= 300, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "missing");
    record("magic", V, "household banner “… 가전 관리” shown", (await mp.getByText(/가전 관리$/).count()) > 0);
    record("magic", V, "asset name (h1) + task title + due date shown", (await mp.locator("h1").count()) === 1 && (await mp.getByText("수행할 과업").count()) === 1 && (await mp.getByText("원래 예정일").count()) === 1);
    record("magic", V, "no login form / nav / app header", (await mp.locator("input, nav, a[aria-label='MyLife Hub 홈']").count()) === 0);
    record("magic", V, "no horizontal overflow", await overflowCheck(mp));

    // GET must be side-effect free: reloading twice keeps the CTA.
    await mp.reload({ waitUntil: "networkidle" });
    await mp.reload({ waitUntil: "networkidle" });
    record("magic", V, "GET does not consume the token (CTA survives 2 reloads)", await button.isVisible());

    // Complete through the real button -> POST /api/tasks/magic-complete.
    const postPromise = mp.waitForResponse((r) => r.url().endsWith("/api/tasks/magic-complete") && r.request().method() === "POST");
    await button.click();
    const post = await postPromise;
    record("magic", V, "POST /api/tasks/magic-complete → 200", post.status() === 200, `status=${post.status()}`);
    const doneShown = await mp.getByText("완료 처리되었어요!").waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    record("magic", V, "success state “완료 처리되었어요!” (celebration)", doneShown);
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await mp.waitForTimeout(500);
    record("magic", V, "success state hides the stale “한 번만 사용” note", (await mp.getByText(/한 번만 사용할 수 있어요/).count()) === 0);
    record("magic", V, "success state shows next due date with year", (await mp.getByText(/다음 관리 일정은 \d{4}\.\d{2}\.\d{2}이에요/).count()) > 0);
    await mp.screenshot({ path: `${OUT}/magic-link-done-mobile.png`, fullPage: true });

    // Reload -> consumed state with timestamp.
    await mp.reload({ waitUntil: "networkidle" });
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const consumed = (await mp.getByText("이미 완료 처리된 과업입니다").count()) > 0;
    const hasTime = (await mp.getByText(/에 완료되었어요\./).count()) > 0;
    record("magic", V, "reload shows “이미 완료 처리된 과업입니다” + completion time", consumed && hasTime);
    await mp.screenshot({ path: `${OUT}/magic-link-consumed-mobile.png`, fullPage: true });
    record("magic", V, "no console/page errors", mp.__errors.length === 0, mp.__errors.slice(0, 2).join(" | "));

    // Replays with a NEW idempotency key must be rejected; garbage tokens are invalid.
    const replay = await anon.request.post(`${BASE}/api/tasks/magic-complete`, { data: { token, idempotencyKey: "e2e-replay-key-0001" } });
    record("magic", V, "POST on consumed token (new key) → 409", replay.status() === 409, `status=${replay.status()}`);
    const garbage = await anon.request.post(`${BASE}/api/tasks/magic-complete`, { data: { token: "x".repeat(40), idempotencyKey: "e2e-garbage-key-0001" } });
    record("magic", V, "POST on unknown token → 404", garbage.status() === 404, `status=${garbage.status()}`);

    await mp.goto(`${BASE}/m/${"x".repeat(40)}`, { waitUntil: "networkidle" });
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("magic", V, "unknown token page shows “유효하지 않거나 만료된 링크입니다”", (await mp.getByText("유효하지 않거나 만료된 링크입니다").count()) > 0);
    await mp.screenshot({ path: `${OUT}/magic-link-invalid-mobile.png`, fullPage: true });
    await anon.close();
  }
}

// Sandbox cleanup + proof that the demo data was not consumed.
{
  // The completion generated iteration 2 under the same rule: prove it, then remove both rows + the rule.
  const { count: generated } = await sb.from("tasks").select("id", { count: "exact", head: true }).eq("rule_id", sandboxRule.id).eq("iteration_no", 2);
  record("magic", "mobile", "magic completion generated iteration 2 of the sandbox rule", generated === 1, `iteration 2 rows=${generated}`);
}
await sb.from("tasks").delete().like("title", `${SANDBOX_PREFIX}%`);
await sb.from("task_rules").delete().like("title", `${SANDBOX_PREFIX}%`);
{
  const { count: left } = await sb.from("tasks").select("id", { count: "exact", head: true }).like("title", `${SANDBOX_PREFIX}%`);
  const { count: ruleLeft } = await sb.from("task_rules").select("id", { count: "exact", head: true }).like("title", `${SANDBOX_PREFIX}%`);
  const realOpenAfter = await countRealOpen();
  record("magic", "mobile", "sandbox: temp task/rule removed & real tasks untouched", left === 0 && ruleLeft === 0 && realOpenAfter === realOpenBefore, `temp tasks=${left} rules=${ruleLeft}, real open ${realOpenBefore}→${realOpenAfter}`);
}

// ---------------------------------------------------------------- Phase 2-2: Magic Link completion -> notification
{
  const { data: rows } = await sb.from("notifications").select("id, type, title, body, read_at").like("body", `%${sandboxTitle}%`);
  const one = rows?.length === 1 ? rows[0] : null;
  record(
    "notifications",
    "-",
    "magic completion created exactly 1 MAGIC_COMPLETED notification for the owner/admin (replays add none)",
    !!one && one.type === "MAGIC_COMPLETED" && one.title === "가족이 과업을 완료했어요" && one.read_at === null,
    `rows=${rows?.length} type=${one?.type}`,
  );
}

// ---------------------------------------------------------------- rate limit on /api/tasks/magic-complete (10 / min / IP)
{
  const ctx = await browser.newContext();
  const ip = `198.51.100.${(Date.now() % 200) + 1}`; // own bucket per run (the limiter keys on the forwarded IP)
  const statuses = [];
  let retryAfter = null;
  for (let i = 0; i < 12; i++) {
    const r = await ctx.request.post(`${BASE}/api/tasks/magic-complete`, {
      headers: { "x-forwarded-for": ip },
      data: { token: "y".repeat(40), idempotencyKey: `e2e-rate-key-${i}-0000` },
    });
    statuses.push(r.status());
    if (r.status() === 429) retryAfter = r.headers()["retry-after"];
  }
  record("api", "-", "rate limit: requests 1–10 → 404, 11–12 → 429", statuses.slice(0, 10).every((s) => s === 404) && statuses.slice(10).every((s) => s === 429), statuses.join(","));
  record("api", "-", "429 carries Retry-After", Number(retryAfter) > 0, `retry-after=${retryAfter}`);
  const other = await ctx.request.post(`${BASE}/api/tasks/magic-complete`, {
    headers: { "x-forwarded-for": "203.0.113.77" },
    data: { token: "z".repeat(40), idempotencyKey: "e2e-rate-other-0000" },
  });
  record("api", "-", "a different IP is not throttled", other.status() === 404, `status=${other.status()}`);
  await ctx.close();
}

// ---------------------------------------------------------------- household settings: members, invite, backup/restore
let inviteUrl = "";
{
  const ctx = await newContext(VIEWPORTS[0], storageState);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && page.__errors.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

  await page.getByRole("button", { name: "가구 설정" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  record("household", "desktop", "settings modal: members list with 관리자 badge", (await dialog.getByText("관리자", { exact: true }).count()) >= 1);
  record("household", "desktop", "settings modal (admin): invite + backup sections", (await dialog.getByRole("button", { name: "초대 링크 만들기" }).count()) === 1 && (await dialog.getByRole("button", { name: "JSON 내보내기" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/household-settings-desktop.png` });

  // Invite link
  await dialog.getByRole("button", { name: "초대 링크 만들기" }).click();
  const inviteToast = await dialog.getByText("초대 링크가 복사되었습니다!").waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
  inviteUrl = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  record("household", "desktop", "invite: link copied (/invite/<code>) + feedback", inviteToast && /\/invite\/[A-Za-z0-9_-]{43}$/.test(inviteUrl), inviteUrl.replace(/\/invite\/.+$/, "/invite/…"));

  // Backup: export -> delete -> restore -> idempotent re-restore (on a sandbox asset; leftovers of a crashed run are purged first)
  await sb.from("assets").delete().eq("name", "E2E 백업 테스트 자산");
  const { data: sandboxAsset, error: assetError } = await sb
    .from("assets")
    .insert({ household_id: myProfile.household_id, owner_id: me.user.id, name: "E2E 백업 테스트 자산", space: "기타", category: "테스트" })
    .select("id")
    .single();
  if (assetError) throw new Error(`backup sandbox asset failed: ${assetError.message}`);

  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "JSON 내보내기" }).click()]);
  const backupPath = await download.path();
  const backupText = await readFile(backupPath, "utf8");
  const backup = JSON.parse(backupText);
  record("household", "desktop", "export: file name mylife-backup-YYYYMMDD.json", /^mylife-backup-\d{8}\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
  record(
    "household",
    "desktop",
    "export: version 1 with assets/rules/tasks/event_logs, includes the sandbox asset",
    backup.version === 1 && ["assets", "task_rules", "tasks", "event_logs"].every((k) => Array.isArray(backup[k])) && backup.assets.some((a) => a.id === sandboxAsset.id),
    `assets=${backup.assets?.length} rules=${backup.task_rules?.length} tasks=${backup.tasks?.length} logs=${backup.event_logs?.length}`,
  );
  record("household", "desktop", "export: no secrets (token/code hashes) in the file", !/token_hash|code_hash|idempotency_key/.test(backupText));

  await sb.from("assets").delete().eq("id", sandboxAsset.id);
  const gone = (await sb.from("assets").select("id").eq("id", sandboxAsset.id).maybeSingle()).data === null;

  await dialog.locator('input[type="file"]').setInputFiles(backupPath);
  await dialog.getByRole("button", { name: "복구 실행" }).click();
  await dialog.getByText(/복구 완료/).waitFor({ timeout: 30_000 }).catch(() => {});
  const firstMsg = (await dialog.getByRole("status").allTextContents()).join(" ");
  const restored = (await sb.from("assets").select("id").eq("id", sandboxAsset.id).maybeSingle()).data !== null;
  record("household", "desktop", "restore: deleted asset comes back (1 inserted)", gone && restored && /자산 1\//.test(firstMsg), firstMsg.slice(0, 90));

  await dialog.locator('input[type="file"]').setInputFiles(backupPath);
  await dialog.getByRole("button", { name: "복구 실행" }).click();
  await page.waitForFunction(() => /자산 0\//.test(document.querySelector('[role="dialog"] [role="status"]')?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
  const secondMsg = (await dialog.getByRole("status").allTextContents()).join(" ");
  record("household", "desktop", "restore: re-importing the same file is idempotent (0 inserted)", /자산 0\/.*과업 0\/.*이력 0\//.test(secondMsg), secondMsg.slice(0, 90));
  await page.screenshot({ path: `${OUT}/household-backup-restored-desktop.png` });

  await dialog.locator('input[type="file"]').setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"foo":1}') });
  await dialog.getByRole("button", { name: "복구 실행" }).click();
  const badShown = await dialog.getByText(/백업 파일\(version 1\) 형식이 아니에요/).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  record("household", "desktop", "restore: malformed file is rejected with a clear message", badShown);
  record("household", "desktop", "no console/page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));

  await sb.from("assets").delete().eq("id", sandboxAsset.id);
  await ctx.close();
}

// ---------------------------------------------------------------- invite acceptance with a throw-away second user
if (inviteUrl && svc) {
  const rand = Math.random().toString(36).slice(2, 10);
  const memberEmail = `mylife.e2e.member+${rand}@example.com`;
  const memberPassword = `Pw-${rand}-${Date.now()}`;
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: memberEmail,
    password: memberPassword,
    email_confirm: true,
    user_metadata: { display_name: "E2E 구성원" },
  });
  if (createError) throw new Error(`createUser failed: ${createError.message}`);
  const memberId = created.user.id;
  try {
    const mctx = await newContext(VIEWPORTS[1]);
    const mp = await mctx.newPage();
    mp.__errors = [];
    mp.on("pageerror", (e) => mp.__errors.push(`pageerror: ${e.message}`));
    const V = "mobile";

    const resp = await mp.goto(inviteUrl, { waitUntil: "networkidle" });
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("invite", V, "public invite page: 200, household banner, login/sign-up CTA", resp?.status() === 200 && (await mp.getByText("가구에 초대받았어요").count()) === 1 && (await mp.getByRole("link", { name: /로그인 \/ 가입하고 참여하기/ }).count()) === 1);
    await mp.screenshot({ path: `${OUT}/invite-mobile.png`, fullPage: true });

    await mp.getByRole("link", { name: /로그인 \/ 가입하고 참여하기/ }).click();
    await mp.waitForURL(/\/login\?invite=/);
    record("invite", V, "login form switches to invite mode (no household name on sign-up)", (await mp.getByText("로그인하면 초대받은 가구에 참여할 수 있어요.").count()) === 1);
    await mp.fill('input[name="email"]', memberEmail);
    await mp.fill('input[name="password"]', memberPassword);
    await mp.click('button[type="submit"]');
    await mp.waitForURL(/\/invite\//, { timeout: 20_000 });
    await mp.waitForLoadState("networkidle");
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("invite", V, "after login: back on /invite with name field + 가구에 참여하기", (await mp.locator('input[name="displayName"]').count()) === 1 && (await mp.getByRole("button", { name: "가구에 참여하기" }).count()) === 1);
    await mp.screenshot({ path: `${OUT}/invite-join-mobile.png`, fullPage: true });

    await mp.getByRole("button", { name: "가구에 참여하기" }).click();
    await mp.waitForURL(/\/assets/, { timeout: 20_000 });
    await mp.waitForLoadState("networkidle");
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("invite", V, "joined: /assets shows the household capsule", (await mp.getByText("E2E 테스트 가구").count()) > 0);
    record("invite", V, "member role: no ‘가전 추가’ (ADMIN-only)", (await mp.getByRole("button", { name: "가전 추가" }).count()) === 0);
    {
      const { data: inv } = await sb.from("notifications").select("id, body, read_at").eq("type", "INVITE_ACCEPTED").like("body", "E2E 구성원%");
      record("notifications", V, "invite accepted → ADMIN received INVITE_ACCEPTED with the member's name", (inv?.length ?? 0) >= 1 && inv.some((n) => /E2E 구성원님이 가구에 참여했어요/.test(n.body)), `rows=${inv?.length}`);
    }
    await mp.screenshot({ path: `${OUT}/invite-member-assets-mobile.png`, fullPage: true });

    await mp.getByRole("button", { name: "가구 설정" }).click();
    const md = mp.getByRole("dialog");
    await md.waitFor();
    record("invite", V, "member settings: lists 2 people, no invite/backup controls", (await md.getByText("구성원", { exact: true }).count()) >= 1 && (await md.getByRole("button", { name: "초대 링크 만들기" }).count()) === 0 && (await md.getByRole("button", { name: "JSON 내보내기" }).count()) === 0);
    record("invite", V, "no page errors", mp.__errors.length === 0, mp.__errors.slice(0, 2).join(" | "));

    // ---- Phase 2-1: a MEMBER snoozes a FAMILY task (needs the snooze_task RPC; plain RLS would reject it)
    await mp.keyboard.press("Escape");
    const mk = (title, visibility) => ({ household_id: myProfile.household_id, owner_id: me.user.id, title, visibility, due_date: shift(2) });
    const famTitle = `${SANDBOX_PREFIX} 연기 ${Date.now()}`;
    const privTitle = `${SANDBOX_PREFIX} 개인 ${Date.now()}`;
    const { data: famTask, error: famErr } = await sb.from("tasks").insert(mk(famTitle, "FAMILY")).select("id").single();
    if (famErr) throw new Error(`snooze sandbox (FAMILY) failed: ${famErr.message}`);
    const { data: privTask, error: privErr } = await sb.from("tasks").insert(mk(privTitle, "PRIVATE")).select("id").single();
    if (privErr) throw new Error(`snooze sandbox (PRIVATE) failed: ${privErr.message}`);
    try {
      await mp.goto(`${BASE}/timeline`, { waitUntil: "networkidle" });
      await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const card = mp.locator("main li").filter({ hasText: famTitle });
      record("snooze", V, "member sees the admin's FAMILY task, not the admin's PRIVATE task", (await card.count()) === 1 && (await mp.locator("main li").filter({ hasText: privTitle }).count()) === 0);

      await card.getByRole("button", { name: /더보기/ }).click();
      await mp.getByRole("menuitem", { name: "3일 연기" }).click();
      const expected = shift(5); // greatest(due = today+2, today) + 3
      let row;
      for (let i = 0; i < 24; i++) {
        ({ data: row } = await sb.from("tasks").select("status, due_date, snoozed_until").eq("id", famTask.id).single());
        if (row.status === "SNOOZED") break;
        await mp.waitForTimeout(500);
      }
      record("snooze", V, "MEMBER snooze via UI: SNOOZED, due = max(due,today)+3, snoozed_until set", row.status === "SNOOZED" && row.due_date === expected && row.snoozed_until === expected, JSON.stringify(row));
      await mp.waitForLoadState("networkidle");
      await mp.waitForTimeout(800);
      record("snooze", V, "UI shows the moved date (D-5 badge + 연기됨)", (await card.getByText("D-5", { exact: true }).count()) === 1 && (await card.getByText(/연기됨/).count()) === 1);
      await mp.screenshot({ path: `${OUT}/snooze-member-mobile.png`, fullPage: true });

      // Direct RPC checks with the member's own session.
      const msb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { error: msbErr } = await msb.auth.signInWithPassword({ email: memberEmail, password: memberPassword });
      if (msbErr) throw new Error(`member API sign-in failed: ${msbErr.message}`);
      const args = { p_task_id: famTask.id, p_days: 1, p_idempotency_key: `e2e-snooze-${rand}-0001` };
      const r1 = await msb.rpc("snooze_task", args);
      const r2 = await msb.rpc("snooze_task", args);
      const { data: after } = await sb.from("tasks").select("due_date").eq("id", famTask.id).single();
      record("snooze", V, "RPC idempotent: replay returns the same result, no double snooze", !r1.error && !r2.error && JSON.stringify(r1.data) === JSON.stringify(r2.data) && after.due_date === shift(6), `due=${after.due_date} expected=${shift(6)}`);
      const reuse = await msb.rpc("snooze_task", { ...args, p_days: 2 });
      record("snooze", V, "same key with different days → IDEMPOTENCY_KEY_REUSED", reuse.error?.message === "IDEMPOTENCY_KEY_REUSED", reuse.error?.message ?? "no error");
      const priv = await msb.rpc("snooze_task", { p_task_id: privTask.id, p_days: 1, p_idempotency_key: `e2e-snooze-${rand}-0002` });
      record("snooze", V, "another member's PRIVATE task → NOT_AUTHORIZED (42501)", priv.error?.code === "42501" && priv.error?.message === "NOT_AUTHORIZED", `${priv.error?.code} ${priv.error?.message}`);
      const badDays = await msb.rpc("snooze_task", { p_task_id: famTask.id, p_days: 0, p_idempotency_key: `e2e-snooze-${rand}-0003` });
      record("snooze", V, "days outside 1..60 → INVALID_DAYS", badDays.error?.message === "INVALID_DAYS", badDays.error?.message ?? "no error");
      const { data: logs } = await sb.from("event_logs").select("payload").eq("task_id", famTask.id).eq("event_type", "TASK_SNOOZED");
      record("snooze", V, "audit: 2 TASK_SNOOZED logs (UI + RPC; replay not duplicated) with days/previous/new dates", logs?.length === 2 && logs.every((l) => l.payload.days && l.payload.previous_due_date && l.payload.new_due_date), `logs=${logs?.length}`);

      // ---- Phase 2-2: notification isolation (RLS). A row that belongs to the MEMBER only (created with the service role).
      const isoTitle = `E2E 격리 ${rand}`;
      const { data: iso, error: isoErr } = await svc
        .from("notifications")
        .insert({ household_id: myProfile.household_id, user_id: memberId, type: "OVERDUE", title: isoTitle, body: "member only", dedupe_key: `e2e-iso-${rand}` })
        .select("id")
        .single();
      if (isoErr) throw new Error(`isolation fixture failed: ${isoErr.message}`);
      const adminSees = await sb.from("notifications").select("id").eq("title", isoTitle);
      const memberSees = await msb.from("notifications").select("id").eq("title", isoTitle);
      record("notifications", V, "RLS: another user's notification is invisible (admin 0 rows, owner 1 row)", adminSees.data?.length === 0 && memberSees.data?.length === 1, `admin=${adminSees.data?.length} owner=${memberSees.data?.length}`);

      const upd = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", iso.id).select("id");
      const rpcOther = await sb.rpc("mark_notification_read", { p_notification_id: iso.id });
      const { data: still } = await svc.from("notifications").select("read_at").eq("id", iso.id).single();
      record("notifications", V, "RLS: cannot mark another user's notification as read (0 rows, RPC=false, still unread)", (upd.data?.length ?? 0) === 0 && rpcOther.data === false && still.read_at === null, `update=${upd.data?.length ?? 0} rpc=${rpcOther.data}`);

      const ins = await sb.from("notifications").insert({ household_id: myProfile.household_id, user_id: me.user.id, type: "OVERDUE", title: "E2E forged", body: "x", dedupe_key: `e2e-forged-${rand}` });
      const del = await sb.from("notifications").delete().eq("id", iso.id).select("id");
      const { data: stillThere } = await svc.from("notifications").select("id").eq("id", iso.id);
      record("notifications", V, "clients cannot INSERT or DELETE notifications", !!ins.error && stillThere?.length === 1, `insert=${ins.error?.code ?? "allowed"} delete=${del.error?.code ?? del.data?.length}`);

      const own = await msb.rpc("mark_notification_read", { p_notification_id: iso.id });
      const { data: ownAfter } = await svc.from("notifications").select("read_at").eq("id", iso.id).single();
      record("notifications", V, "owner can mark their own notification as read (RPC=true, read_at set)", own.data === true && ownAfter.read_at !== null);

      // ---- Phase 2-3: push_subscriptions RLS + hand-off + service-only RPCs
      const k = fakeKeys();
      const epA = `https://fcm.googleapis.com/fcm/send/e2e-ok-rls-a-${rand}`;
      const epM = `https://fcm.googleapis.com/fcm/send/e2e-ok-rls-m-${rand}`;
      const { error: subFixErr } = await svc.from("push_subscriptions").insert({ user_id: memberId, endpoint: epM, ...k });
      if (subFixErr) throw new Error(`push fixture failed: ${subFixErr.message}`);
      const aSeesM = await sb.from("push_subscriptions").select("id").eq("endpoint", epM);
      const mSeesM = await msb.from("push_subscriptions").select("id").eq("endpoint", epM);
      record("push", V, "RLS: another user's subscription is invisible (admin 0 rows, owner 1 row)", aSeesM.data?.length === 0 && mSeesM.data?.length === 1, `admin=${aSeesM.data?.length} owner=${mSeesM.data?.length}`);

      const aDelM = await sb.from("push_subscriptions").delete().eq("endpoint", epM).select("id");
      const forged = await sb.from("push_subscriptions").insert({ user_id: memberId, endpoint: epA, ...k });
      const ownIns = await sb.from("push_subscriptions").insert({ user_id: me.user.id, endpoint: epA, ...k }).select("id");
      const updTry = await sb.from("push_subscriptions").update({ user_agent: "tampered" }).eq("endpoint", epA).select("id");
      const { data: mStill } = await svc.from("push_subscriptions").select("id").eq("endpoint", epM);
      record("push", V, "RLS: cannot delete or forge another user's subscription; own INSERT works; UPDATE is not granted", (aDelM.data?.length ?? 0) === 0 && mStill?.length === 1 && forged.error?.code === "42501" && ownIns.data?.length === 1 && !!updTry.error, `del=${aDelM.data?.length ?? 0} forged=${forged.error?.code} own=${ownIns.data?.length} update=${updTry.error?.code ?? "allowed"}`);

      const hand = await msb.rpc("upsert_push_subscription", { p_endpoint: epA, p_p256dh: k.p256dh, p_auth: k.auth, p_user_agent: "e2e-handoff" });
      const aAfter = await sb.from("push_subscriptions").select("id").eq("endpoint", epA);
      const mAfter = await msb.from("push_subscriptions").select("id").eq("endpoint", epA);
      record("push", V, "upsert_push_subscription hands a shared-device endpoint over to the new user", !hand.error && aAfter.data?.length === 0 && mAfter.data?.length === 1, hand.error?.message ?? `admin=${aAfter.data?.length} member=${mAfter.data?.length}`);

      const delRpc = await msb.rpc("delete_expired_subscription", { p_endpoint: epM });
      const claimRpc = await msb.rpc("claim_unsent_notifications", {});
      const relRpc = await msb.rpc("release_notification_push", { p_ids: [] });
      record("push", V, "dispatcher RPCs (delete_expired_subscription / claim / release) are not callable by users", !!delRpc.error && !!claimRpc.error && !!relRpc.error, `${delRpc.error?.code} ${claimRpc.error?.code} ${relRpc.error?.code}`);
      await svc.from("push_subscriptions").delete().in("endpoint", [epA, epM]);

      // ---- Phase 2-4: due-date notification generator (D-3 / D-Day / overdue, recipients, dedupe)
      const mkTask = (label, due, extra = {}) => ({ household_id: myProfile.household_id, owner_id: me.user.id, title: `${SANDBOX_PREFIX} 기한 ${label}`, due_date: due, ...extra });
      const specs = {
        soon: mkTask("D-3", shift(3)),
        near: mkTask("D-2", shift(2)), // not D-3 -> nothing
        far: mkTask("D-4", shift(4)), // nothing
        today: mkTask("오늘", shift(0)),
        over: mkTask("초과", shift(-2)),
        priv: mkTask("개인 오늘", shift(0), { visibility: "PRIVATE" }), // admin only
        snoozed: mkTask("연기됨 D-3", shift(3), { status: "SNOOZED", snoozed_until: shift(3) }),
        done: mkTask("완료됨", shift(0), { status: "COMPLETED", completed_at: new Date().toISOString() }), // nothing
      };
      const tid = {};
      try {
        for (const [key, row] of Object.entries(specs)) {
          const { data, error } = await sb.from("tasks").insert(row).select("id").single();
          if (error) throw new Error(`generator fixture ${key} failed: ${error.message}`);
          tid[key] = data.id;
        }
        const allIds = Object.values(tid);
        const gen1 = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { data: rows1 } = await svc.from("notifications").select("user_id, type, dedupe_key, task_id, title, body").in("task_id", allIds);
        const of = (key) => (rows1 ?? []).filter((r) => r.task_id === tid[key]);
        const users = (key) => of(key).map((r) => r.user_id).sort().join(",");
        const both = [me.user.id, memberId].sort().join(",");

        record("due", V, "D-3 (PENDING and SNOOZED) → DUE_SOON for every household member (FAMILY)", [of("soon"), of("snoozed")].every((r) => r.length === 2 && r.every((x) => x.type === "DUE_SOON")) && users("soon") === both && users("snoozed") === both, `soon=${of("soon").length} snoozed=${of("snoozed").length}`);
        record("due", V, "D-Day → DUE_TODAY: FAMILY task to all members, PRIVATE task to its owner only", of("today").length === 2 && of("today").every((x) => x.type === "DUE_TODAY") && users("today") === both && of("priv").length === 1 && of("priv")[0].user_id === me.user.id && of("priv")[0].type === "DUE_TODAY", `today=${of("today").length} private=${of("priv").length}`);
        record("due", V, "overdue → OVERDUE with the days-late text", of("over").length === 2 && of("over").every((x) => x.type === "OVERDUE" && /2일 지났어요/.test(x.body)), of("over")[0]?.body ?? "none");
        record("due", V, "D-2, D-4 and COMPLETED tasks create nothing", of("near").length === 0 && of("far").length === 0 && of("done").length === 0, `near=${of("near").length} far=${of("far").length} done=${of("done").length}`);
        record(
          "due",
          V,
          "dedupe_key format: due-soon|due-today|overdue : <task_id> : <due_date>",
          of("soon").every((x) => x.dedupe_key === `due-soon:${tid.soon}:${shift(3)}`) && of("today").every((x) => x.dedupe_key === `due-today:${tid.today}:${shift(0)}`) && of("over").every((x) => x.dedupe_key === `overdue:${tid.over}:${shift(-2)}`),
          of("over")[0]?.dedupe_key ?? "none",
        );
        record("due", V, "RPC summary: date (Seoul), per-type counts add up to total", !gen1.error && gen1.data?.date === today && gen1.data.total === gen1.data.due_soon + gen1.data.due_today + gen1.data.overdue && gen1.data.due_soon >= 4 && gen1.data.due_today >= 3 && gen1.data.overdue >= 2, JSON.stringify(gen1.data));

        // Idempotent: nothing new on a second run
        const gen2 = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { count: rowsAfter2 } = await svc.from("notifications").select("id", { count: "exact", head: true }).in("task_id", allIds);
        record("due", V, "re-running creates nothing (dedupe): total 0, same row count", gen2.data?.total === 0 && rowsAfter2 === rows1.length, `total=${gen2.data?.total} rows ${rows1.length}→${rowsAfter2}`);

        // The due date is part of the key: a re-scheduled overdue task alerts again for its new date
        await sb.from("tasks").update({ due_date: shift(-3) }).eq("id", tid.over);
        const gen3 = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { data: overRows } = await svc.from("notifications").select("dedupe_key").eq("task_id", tid.over);
        record("due", V, "new due date → new alert (overdue key changes), old alert kept", gen3.data?.overdue === 2 && overRows?.length === 4 && overRows.some((r) => r.dedupe_key === `overdue:${tid.over}:${shift(-3)}`), `overdue=${gen3.data?.overdue} rows=${overRows?.length}`);

        const userCall = await msb.rpc("generate_due_notifications", {});
        record("due", V, "generate_due_notifications is service_role only (members get 42501)", userCall.error?.code === "42501", `${userCall.error?.code}`);
      } finally {
        // notifications first (deleting a task would null their task_id), then the sandbox tasks
        await svc.from("notifications").delete().eq("household_id", myProfile.household_id).or("dedupe_key.like.due-%,dedupe_key.like.overdue:%");
        await sb.from("tasks").delete().like("title", `${SANDBOX_PREFIX}%`);
      }
    } finally {
      await sb.from("tasks").delete().like("title", `${SANDBOX_PREFIX}%`);
    }

    // Single-use: the same link is now spent.
    const spent = await newContext(VIEWPORTS[1]);
    const sp = await spent.newPage();
    await sp.goto(inviteUrl, { waitUntil: "networkidle" });
    await sp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("invite", V, "single-use: reopening the link shows “이미 사용된 초대 링크예요”", (await sp.getByText("이미 사용된 초대 링크예요").count()) === 1);
    await sp.screenshot({ path: `${OUT}/invite-used-mobile.png`, fullPage: true });
    await spent.close();
    await mctx.close();
  } finally {
    await svc.auth.admin.deleteUser(memberId); // profile cascades; invite.used_by becomes NULL
  }
} else {
  record("invite", "mobile", "invite acceptance flow", true, "SKIPPED: needs an invite URL and SUPABASE_SERVICE_ROLE_KEY");
}

// ---------------------------------------------------------------- Phase 2-2: notification bell (badge, polling, dropdown, read states)
{
  const unreadInDb = async () =>
    (await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)).count ?? 0;
  const badgeValue = async (page) => {
    const badge = page.getByTestId("notification-badge");
    if ((await badge.count()) === 0) return 0;
    const t = (await badge.innerText()).trim();
    return t === "9+" ? 10 : Number(t);
  };
  const shown = (n) => (n >= 10 ? 10 : n); // the badge caps at "9+"
  const waitBadge = (page, want) =>
    page
      .waitForFunction((w) => {
        const el = document.querySelector('[data-testid="notification-badge"]');
        const t = el ? el.textContent.trim() : "0";
        return (t === "9+" ? 10 : Number(t)) === w;
      }, want, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
  const bellButton = (page) => page.getByRole("button", { name: /^알림( \d+건)?$/ });
  const panel = (page) => page.locator('[aria-label="알림 목록"]');

  const ctx = await newContext(VIEWPORTS[0], storageState);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && page.__errors.push(`console: ${m.text()}`));

  const u0 = await unreadInDb();
  await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  record("notifications", "desktop", "header bell badge shows the unread count (server-rendered)", u0 > 0 && (await badgeValue(page)) === shown(u0), `db=${u0} badge=${await badgeValue(page)}`);
  record("notifications", "desktop", "badge is rose with a pulse accent", (await page.locator('[data-testid="notification-badge"] .animate-ping').count()) === 1 && (await page.locator('[data-testid="notification-badge"] .bg-rose-500').count()) === 1);

  // Polling: a new notification appears after the window regains focus (no reload).
  let u1 = u0;
  if (svc) {
    await svc.from("notifications").insert({
      household_id: myProfile.household_id,
      user_id: me.user.id,
      type: "DUE_SOON",
      title: "E2E 폴링 알림",
      body: "포커스 복귀 시 즉시 갱신되는지 확인",
      dedupe_key: `e2e-poll-${Date.now()}`,
    });
    u1 = u0 + 1;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    record("notifications", "desktop", "polling hook: window focus refreshes the badge without reload", await waitBadge(page, shown(u1)), `want=${shown(u1)}`);
  }

  // Dropdown
  await bellButton(page).click();
  await panel(page).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="알림 목록"] li').length > 0, null, { timeout: 15_000 });
  const items = panel(page).locator("li");
  const first = items.first();
  record("notifications", "desktop", "dropdown: title + ‘모두 읽음’, items with type icon, title, body, relative time", (await panel(page).getByRole("heading", { name: "알림" }).count()) === 1 && (await panel(page).getByRole("button", { name: "모두 읽음" }).count()) === 1 && /(방금 전|\d+분 전|\d+시간 전)/.test(await first.innerText()), (await first.innerText()).replace(/\n/g, " | ").slice(0, 80));
  record("notifications", "desktop", "dropdown: unread items marked (dot + tint) = unread count", (await panel(page).locator('li button[data-unread="true"]').count()) === Math.min(u1, 20), `dots=${await panel(page).locator('li button[data-unread="true"]').count()} unread=${u1}`);
  await page.screenshot({ path: `${OUT}/notifications-dropdown-desktop.png` });

  // Single read: clicking an item marks it read and navigates.
  const target = panel(page).locator("li button", { hasText: "가족이 과업을 완료했어요" }).first();
  if ((await target.count()) > 0) {
    await target.click();
    await page.waitForURL(/\/timeline/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    record("notifications", "desktop", "clicking a notification routes to its page (/timeline)", /\/timeline/.test(page.url()));
    await page.waitForTimeout(500);
    const u2 = await unreadInDb();
    record("notifications", "desktop", "single read: DB unread −1 and badge decreases", u2 === u1 - 1 && (await waitBadge(page, shown(u2))), `db ${u1}→${u2}`);
    u1 = u2;
  } else {
    record("notifications", "desktop", "single read", false, "no MAGIC_COMPLETED item in the dropdown");
  }

  // Mark all read
  await bellButton(page).click();
  await panel(page).waitFor();
  await panel(page).getByRole("button", { name: "모두 읽음" }).click();
  const cleared = await page
    .waitForFunction(() => !document.querySelector('[data-testid="notification-badge"]'), null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(500);
  record("notifications", "desktop", "‘모두 읽음’: badge disappears, DB unread = 0, no unread markers left", cleared && (await unreadInDb()) === 0 && (await panel(page).locator('li button[data-unread="true"]').count()) === 0, `db=${await unreadInDb()}`);
  await page.keyboard.press("Escape");

  // Empty state (the dedicated E2E account only ever holds test notifications; service role cleans them up)
  if (svc) {
    await svc.from("notifications").delete().eq("user_id", me.user.id);
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await bellButton(page).click();
    await panel(page).waitFor();
    const emptyShown = await panel(page).getByText("새로운 알림이 없습니다").waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    record("notifications", "desktop", "empty state: “새로운 알림이 없습니다”", emptyShown);
    await page.screenshot({ path: `${OUT}/notifications-empty-desktop.png` });
  }
  record("notifications", "desktop", "no console/page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------- Phase 2-3: Web Push (SW, manifest, toggle, subscriptions, dispatch)
const CRON_SECRET = process.env.CRON_SECRET;
{
  // Static pieces
  const sw = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
  const swText = await sw.text();
  record("push", "-", "sw.js: public JS, no-cache, push + notificationclick handlers", sw.status === 200 && /javascript/.test(sw.headers.get("content-type") ?? "") && /no-cache|no-store/.test(sw.headers.get("cache-control") ?? "") && /addEventListener\("push"/.test(swText) && /addEventListener\("notificationclick"/.test(swText), `status=${sw.status} cc=${sw.headers.get("cache-control")}`);
  const mf = await fetch(`${BASE}/manifest.json`, { redirect: "manual" });
  const manifest = await mf.json().catch(() => null);
  record("push", "-", "manifest.json: name, standalone, start_url, 192/512 icons", mf.status === 200 && manifest?.display === "standalone" && manifest?.start_url === "/assets" && manifest?.icons?.some((i) => i.sizes === "512x512"), `status=${mf.status}`);
  const iconStatuses = await Promise.all(["/icons/icon-192.png", "/icons/icon-512.png", "/icons/badge-72.png"].map(async (p) => (await fetch(`${BASE}${p}`, { redirect: "manual" })).status));
  record("push", "-", "icons served (192 / 512 / badge)", iconStatuses.every((s) => s === 200), iconStatuses.join(","));

  // ---- Browser toggle: permission -> SW -> subscribe (PushManager mocked: headless Chromium has no push service) -> Server Action -> DB
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-ok-ui-${Date.now()}`;
  const kk = fakeKeys();
  const mockPush = ({ endpoint: ep, p256dh, auth }) => {
    // Headless Chromium keeps reporting Notification.permission = "denied" even after grantPermissions(),
    // so the permission API is controlled explicitly (configurable: tests can redefine it).
    let permission = "granted";
    Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
    Notification.requestPermission = async () => permission;
    const mk = () => ({
      endpoint: ep,
      expirationTime: null,
      toJSON: () => ({ endpoint: ep, keys: { p256dh, auth } }),
      unsubscribe: async () => {
        sessionStorage.removeItem("__e2e_push");
        return true;
      },
    });
    PushManager.prototype.getSubscription = async () => (sessionStorage.getItem("__e2e_push") ? mk() : null);
    PushManager.prototype.subscribe = async () => {
      sessionStorage.setItem("__e2e_push", "1");
      return mk();
    };
  };
  const toggle = (page) => page.getByRole("switch", { name: "푸시 알림" });
  const openBell = async (page) => {
    await page.getByRole("button", { name: /^알림( \d+건)?$/ }).click();
    await page.locator('[aria-label="알림 목록"]').waitFor();
    // The switch replaces a spinner while the hook checks the browser + server state.
    await page.getByRole("switch", { name: "푸시 알림" }).waitFor({ timeout: 15_000 }).catch(() => {});
  };

  const ctx = await newContext(VIEWPORTS[0], storageState);
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  await ctx.addInitScript(mockPush, { endpoint, ...kk });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await openBell(page);
  record("push", "desktop", "popover footer has the ‘푸시 알림’ switch (off by default)", (await toggle(page).count()) === 1 && (await toggle(page).getAttribute("aria-checked")) === "false");

  await toggle(page).click();
  const turnedOn = await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true", null, { timeout: 20_000 }).then(() => true).catch(() => false);
  const { data: row } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth, user_agent, last_used_at").eq("endpoint", endpoint).maybeSingle();
  record("push", "desktop", "toggle ON → Server Action stored the subscription (endpoint, keys, user agent)", turnedOn && row?.p256dh === kk.p256dh && row?.auth === kk.auth && !!row?.user_agent, `on=${turnedOn} row=${!!row}`);
  const swScript = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration("/");
    return (r?.active ?? r?.waiting ?? r?.installing)?.scriptURL ?? null;
  });
  record("push", "desktop", "Service Worker /sw.js is registered with scope /", !!swScript && swScript.endsWith("/sw.js"), String(swScript));
  await page.screenshot({ path: `${OUT}/push-toggle-on-desktop.png` });

  // Persisted across a reload: the hook re-checks the browser AND the server (hasPushSubscription).
  await page.reload({ waitUntil: "networkidle" });
  await openBell(page);
  record("push", "desktop", "after reload the switch is still ON (browser + server agree)", (await toggle(page).getAttribute("aria-checked")) === "true");

  await toggle(page).click();
  const turnedOff = await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false", null, { timeout: 20_000 }).then(() => true).catch(() => false);
  const { data: gone } = await sb.from("push_subscriptions").select("id").eq("endpoint", endpoint);
  record("push", "desktop", "toggle OFF → subscription row deleted", turnedOff && gone?.length === 0);
  record("push", "desktop", "no page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));
  await ctx.close();

  // SSRF guard: an endpoint outside the push-service allowlist is rejected and never stored.
  {
    const evil = `https://evil.example.com/push/e2e-ok-${Date.now()}`;
    const c2 = await newContext(VIEWPORTS[0], storageState);
    await c2.grantPermissions(["notifications"], { origin: BASE });
    await c2.addInitScript(mockPush, { endpoint: evil, ...fakeKeys() });
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
    await openBell(p2);
    await toggle(p2).click();
    const shownError = await p2.getByText("지원하지 않는 푸시 서비스 주소입니다.").waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const { data: evilRow } = await sb.from("push_subscriptions").select("id").eq("endpoint", evil);
    record("push", "desktop", "SSRF guard: non-push-service endpoint is rejected with a message and not stored", shownError && evilRow?.length === 0 && (await toggle(p2).getAttribute("aria-checked")) === "false");
    await c2.close();
  }

  // Permission denied path (headless auto-denies the prompt)
  {
    const c3 = await newContext(VIEWPORTS[0], storageState);
    await c3.addInitScript(mockPush, { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-ok-denied-${Date.now()}`, ...fakeKeys() });
    await c3.addInitScript(() => {
      // Starts as "default" (the prompt has not been answered); answering it denies.
      let permission = "default";
      Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
      Notification.requestPermission = async () => {
        permission = "denied";
        return "denied";
      };
    });
    const p3 = await c3.newPage();
    await p3.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
    await openBell(p3);
    await toggle(p3).click();
    const blocked = await p3.getByText(/브라우저에서 알림이 차단되어 있어요/).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    record("push", "desktop", "permission denied → clear guidance, switch stays off", blocked && (await toggle(p3).count()) === 1);
    await c3.close();
  }

  // ---- /api/push/dispatch
  const call = (headers = {}, init = {}) => fetch(`${BASE}/api/push/dispatch`, { method: "POST", headers, ...init });
  const bearer = { Authorization: `Bearer ${CRON_SECRET}` };
  const s0 = (await call()).status;
  const s1 = (await call({ Authorization: "Bearer definitely-wrong" })).status;
  const s2 = (await fetch(`${BASE}/api/push/dispatch`)).status;
  const s3 = (await call({ Authorization: `Token ${CRON_SECRET}` })).status;
  record("push", "-", "dispatch auth: missing / wrong / non-Bearer credentials → 401 (POST and GET)", [s0, s1, s2, s3].every((s) => s === 401), `${s0},${s1},${s2},${s3}`);

  if (!CRON_SECRET || !svc) {
    record("push", "-", "dispatch flow", true, "SKIPPED: needs CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY");
  } else {
    const dispatch = async (body) => {
      const res = await call({ ...bearer, "Content-Type": "application/json" }, { body: JSON.stringify({ user_ids: [me.user.id], ...body }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const uid = me.user.id;
    const sub = (kind) => ({ user_id: uid, endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${kind}-d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...fakeKeys() });
    const notif = async (title) => {
      const { data } = await svc.from("notifications").insert({ household_id: myProfile.household_id, user_id: uid, type: "DUE_SOON", title, body: "dispatch test", dedupe_key: `e2e-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }).select("id").single();
      return data.id;
    };
    // Start clean: nothing pending and no subscriptions for the E2E account.
    await svc.from("notifications").update({ push_sent_at: new Date().toISOString() }).eq("user_id", uid).is("push_sent_at", null);
    await svc.from("push_subscriptions").delete().eq("user_id", uid);

    const bad = await call({ ...bearer, "Content-Type": "application/json" }, { body: JSON.stringify({ limit: 0 }) });
    record("push", "-", "dispatch rejects an invalid body with 400", bad.status === 400, `status=${bad.status}`);

    // 1) one healthy + one 410 + one 404 subscription
    const ok = sub("ok"), g410 = sub("gone"), g404 = sub("notfound");
    await svc.from("push_subscriptions").insert([ok, g410, g404]);
    const n1 = await notif("E2E 푸시 발송 1");
    const r1 = await dispatch({});
    const { data: left } = await svc.from("push_subscriptions").select("endpoint, last_used_at").eq("user_id", uid);
    const { data: n1row } = await svc.from("notifications").select("push_sent_at").eq("id", n1).single();
    record("push", "-", "dispatch OK: claimed 1, 1 push sent, 410 + 404 subscriptions auto-removed, healthy one kept (last_used_at set)", r1.status === 200 && r1.json?.claimed === 1 && r1.json?.pushesSent === 1 && r1.json?.notificationsDelivered === 1 && r1.json?.expiredSubscriptionsRemoved === 2 && left?.length === 1 && left[0].endpoint === ok.endpoint && !!left[0].last_used_at && !!n1row.push_sent_at, JSON.stringify(r1.json));

    // 2) no double push
    const r2 = await dispatch({});
    record("push", "-", "dispatch is not repeatable for the same notification (claimed 0, no second push)", r2.json?.claimed === 0 && r2.json?.pushesSent === 0, JSON.stringify(r2.json));

    // 3) transient failure -> released, retried on the next run, then delivered
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    const fail = sub("fail");
    await svc.from("push_subscriptions").insert(fail);
    const n2 = await notif("E2E 푸시 재시도");
    const r3 = await dispatch({});
    const { data: n2row } = await svc.from("notifications").select("push_sent_at").eq("id", n2).single();
    const { data: failSub } = await svc.from("push_subscriptions").select("id").eq("endpoint", fail.endpoint);
    record("push", "-", "transient push-service error (500): notification released for retry, subscription kept", r3.json?.released === 1 && r3.json?.notificationsDelivered === 0 && n2row.push_sent_at === null && failSub?.length === 1, JSON.stringify(r3.json));
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    await svc.from("push_subscriptions").insert(sub("ok"));
    const r4 = await dispatch({});
    const { data: n2after } = await svc.from("notifications").select("push_sent_at").eq("id", n2).single();
    record("push", "-", "released notification is delivered on the next run", r4.json?.claimed === 1 && r4.json?.pushesSent === 1 && !!n2after.push_sent_at, JSON.stringify(r4.json));

    // 4) no subscription -> nothing to send, not retried forever
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    const n3 = await notif("E2E 구독 없음");
    const r5 = await dispatch({});
    const { data: n3row } = await svc.from("notifications").select("push_sent_at").eq("id", n3).single();
    record("push", "-", "user without a subscribed device: counted as noSubscription and marked handled", r5.json?.noSubscription === 1 && r5.json?.pushesSent === 0 && !!n3row.push_sent_at, JSON.stringify(r5.json));

    // 5) send-time allowlist: a stored endpoint outside the push services is dropped, never contacted
    const evilSub = { user_id: uid, endpoint: `https://evil.example.com/e2e-ok-${Date.now()}`, ...fakeKeys() };
    await svc.from("push_subscriptions").insert(evilSub);
    await notif("E2E SSRF");
    const r6 = await dispatch({});
    const { data: evilLeft } = await svc.from("push_subscriptions").select("id").eq("endpoint", evilSub.endpoint);
    record("push", "-", "send-time SSRF guard: disallowed endpoint is removed and not contacted", r6.json?.pushesSent === 0 && r6.json?.expiredSubscriptionsRemoved === 1 && evilLeft?.length === 0, JSON.stringify(r6.json));

    // 6) user_ids scoping: another user's pending notification is untouched
    const other = await notif("E2E scope");
    const r7 = await call({ ...bearer, "Content-Type": "application/json" }, { body: JSON.stringify({ user_ids: ["00000000-0000-4000-8000-000000000000"] }) });
    const j7 = await r7.json();
    const { data: otherRow } = await svc.from("notifications").select("push_sent_at").eq("id", other).single();
    record("push", "-", "dispatch scoped to other users leaves this user's pending notification unclaimed", j7.claimed === 0 && otherRow.push_sent_at === null, JSON.stringify(j7));

    // 7) Phase 2-4 pipeline: generate -> send -> cleanup (POST with stages enabled)
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    await svc.from("push_subscriptions").insert(sub("ok"));
    const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
    const retention = async (label, extra) =>
      (await svc.from("notifications").insert({ household_id: myProfile.household_id, user_id: uid, type: "OVERDUE", title: `E2E 보관 ${label}`, body: "retention", dedupe_key: `e2e-ret-${label}-${Date.now()}`, push_sent_at: ago(0), ...extra }).select("id").single()).data.id;
    const oldRead = await retention("읽음40일", { created_at: ago(40), read_at: ago(31) }); // read > 30d ago -> deleted
    const oldUnread = await retention("생성91일", { created_at: ago(91) }); // created > 90d ago -> deleted
    const freshRead = await retention("최근읽음", { created_at: ago(2), read_at: ago(1) }); // kept
    const pTitle1 = `${SANDBOX_PREFIX} 파이프라인 A ${Date.now()}`;
    const { data: pt1 } = await sb.from("tasks").insert({ household_id: myProfile.household_id, owner_id: uid, title: pTitle1, due_date: shift(0) }).select("id").single();

    const plain = await dispatch({});
    record("push", "-", "plain POST dispatch does not run the generator or cleanup (generated/cleanedUp are null)", plain.json?.generated === null && plain.json?.cleanedUp === null, JSON.stringify({ g: plain.json?.generated, c: plain.json?.cleanedUp }));
    const badOpt = await call({ ...bearer, "Content-Type": "application/json" }, { body: JSON.stringify({ generate: "yes" }) });
    record("push", "-", "dispatch rejects invalid stage options with 400", badOpt.status === 400, `status=${badOpt.status}`);

    const r8 = await dispatch({ generate: true, cleanup: true, household_id: myProfile.household_id });
    const { data: pn1 } = await svc.from("notifications").select("type, push_sent_at").eq("task_id", pt1.id);
    const { data: kept } = await svc.from("notifications").select("id").in("id", [oldRead, oldUnread, freshRead]);
    record("push", "-", "pipeline: generator ran → due notification created for the new task, claimed and pushed in the same run", r8.status === 200 && r8.json?.generated?.due_today >= 1 && r8.json?.claimed >= 1 && r8.json?.pushesSent >= 1 && pn1?.length === 1 && pn1[0].type === "DUE_TODAY" && !!pn1[0].push_sent_at, JSON.stringify(r8.json));
    record("push", "-", "pipeline: cleanup deleted read>30d and created>90d notifications, kept the recent one", r8.json?.cleanedUp >= 2 && kept?.length === 1 && kept[0].id === freshRead, `cleanedUp=${r8.json?.cleanedUp} kept=${kept?.length}`);

    // Cron path = GET (all stages on by default), scoped here with the query string
    const pTitle2 = `${SANDBOX_PREFIX} 파이프라인 B ${Date.now()}`;
    const { data: pt2 } = await sb.from("tasks").insert({ household_id: myProfile.household_id, owner_id: uid, title: pTitle2, due_date: shift(0) }).select("id").single();
    const cronRes = await fetch(`${BASE}/api/push/dispatch?household_id=${myProfile.household_id}&user_ids=${uid}`, { headers: bearer });
    const cronJson = await cronRes.json().catch(() => null);
    const { data: pn2 } = await svc.from("notifications").select("push_sent_at").eq("task_id", pt2.id);
    record("push", "-", "cron GET runs generate → send → cleanup by default (1 new DUE_TODAY, pushed)", cronRes.status === 200 && cronJson?.generated?.due_today === 1 && cronJson?.pushesSent >= 1 && typeof cronJson?.cleanedUp === "number" && pn2?.length === 1 && !!pn2[0].push_sent_at, JSON.stringify(cronJson));
    await svc.from("notifications").delete().eq("user_id", uid).like("title", "E2E 보관%");
    await sb.from("tasks").delete().like("title", `${SANDBOX_PREFIX}%`);

    // Cleanup (dedicated E2E account)
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    await svc.from("notifications").delete().eq("user_id", uid);
  }
}
await browser.close();

// ---------------------------------------------------------------- report
await writeFile(`${OUT}/report.json`, JSON.stringify(results, null, 2));
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.page.padEnd(8)} ${r.viewport.padEnd(8)} ${r.check}${r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}/`);
process.exit(failed ? 1 : 0);
