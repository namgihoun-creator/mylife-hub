// Screenshot capture + DOM sanity checks for docs/DESIGN_SYSTEM.md v2.
// Usage: npm run screens   (dev server must be running; needs E2E_EMAIL / E2E_PASSWORD in .env.local)
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
