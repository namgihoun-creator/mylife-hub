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

// The signed-in E2E user and household (used by the rental, magic-link and notification sections below).
const { data: me } = await sb.auth.getUser();
const { data: myProfile } = await sb.from("profiles").select("household_id").eq("id", me.user.id).single();

// ---------------------------------------------------------------- Phase 3-1: rental / subscription assets
// Everything created here (assets, their rules and first tasks) is removed again in `finally`.
{
  const { data: beforeAssets } = await sb.from("assets").select("id");
  const beforeIds = new Set((beforeAssets ?? []).map((a) => a.id));
  const ctx = await newContext(VIEWPORTS[0], storageState);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && page.__errors.push(`console: ${m.text()}`));
  const vp = VIEWPORTS[0];
  try {
    await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.getByRole("button", { name: "가전 추가" }).first().click();
    const dialog = page.getByRole("dialog");
    const ownedRadio = dialog.getByRole("radio", { name: "직접 구매" });
    const rentalRadio = dialog.getByRole("radio", { name: "렌탈·구독" });
    await ownedRadio.waitFor();

    record("rental-summary", vp.name, "no rentals yet: the summary banner is not rendered", (await page.getByTestId("rental-summary").count()) === 0);
    // -- toggle + conditional, animated panel
    const providerInput = dialog.getByLabel(/렌탈사명/);
    // Playwright treats clipped / opacity-0 content as visible, so the collapsed state is checked the way a user experiences it:
    // the wrapper is inert (no focus, hidden from assistive tech) and has no height.
    const panel = () => dialog.locator("fieldset").evaluate((el) => { const w = el.closest("[aria-hidden]"); return { inert: w.hasAttribute("inert"), hidden: w.getAttribute("aria-hidden"), h: Math.round(w.getBoundingClientRect().height) }; });
    const waitPanel = (collapsed) => page.waitForFunction((c) => { const w = document.querySelector('[role="dialog"] fieldset')?.closest("[aria-hidden]"); if (!w) return false; const h = w.getBoundingClientRect().height; return c ? w.hasAttribute("inert") && h < 2 : !w.hasAttribute("inert") && h > 100; }, collapsed, { timeout: 5000 });
    record("rental", vp.name, "modal top: [직접 구매]/[렌탈·구독] toggle, OWNED selected, rental panel collapsed (hidden + inert)", (await ownedRadio.getAttribute("aria-checked")) === "true" && (await rentalRadio.getAttribute("aria-checked")) === "false" && await (async () => { const p = await panel(); return p.inert && p.hidden === "true" && p.h < 2; })());
    await rentalRadio.click();
    await waitPanel(false);
    await page.waitForTimeout(500); // let the 300ms transition finish before measuring / capturing
    const reveal = await dialog.locator("fieldset").evaluate((el) => { const w = el.closest("[aria-hidden]"); return { wrap: Math.round(w.getBoundingClientRect().height), content: Math.round(el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginTop)) }; });
    record("rental", vp.name, "expanded panel is fully revealed after the transition (wrapper height = content height, nothing clipped)", Math.abs(reveal.wrap - reveal.content) <= 2, JSON.stringify(reveal));
    const fieldsOk = await Promise.all(["월 렌탈료 (원)", "결제일 (매월)", "계약 시작일", "약정 만료일", "소유권 이전 만료일", "제휴카드 메모"].map((l) => dialog.getByLabel(l).isVisible()));
    const careOk = await Promise.all(["없음", "방문 코디", "자가 관리"].map((l) => dialog.getByRole("radio", { name: l }).isVisible()));
    const anim = await dialog.locator("fieldset").evaluate((el) => {
      const wrap = el.closest("[aria-hidden]");
      const cs = getComputedStyle(wrap);
      return { prop: cs.transitionProperty, dur: cs.transitionDuration, inert: wrap.hasAttribute("inert") };
    });
    record("rental", vp.name, "selecting 렌탈·구독 expands the panel with all 6 fields (+2 optional dates) and a height/opacity transition", fieldsOk.every(Boolean) && careOk.every(Boolean) && /grid-template-rows/.test(anim.prop) && /opacity/.test(anim.prop) && anim.dur.includes("0.3") && !anim.inert, JSON.stringify(anim));
    await page.screenshot({ path: `${OUT}/assets-rental-form-desktop.png` });

    // -- client/server validation (nothing may be stored on failure)
    const preset = (name) => dialog.getByRole("button", { name: new RegExp(`^${name}`) }).first();
    const alertText = async () => ((await dialog.getByRole("alert").first().textContent({ timeout: 8000 }).catch(() => "")) ?? "").trim();
    const countRentals = async () => (await sb.from("assets").select("id", { count: "exact", head: true }).eq("rental_provider", "E2E렌탈")).count ?? 0;

    await preset("정수기").click();
    const noProvider = await alertText();
    record("rental", vp.name, "rental without a provider is rejected (“렌탈사명을 입력해 주세요.”)", /렌탈사명을 입력해 주세요/.test(noProvider) && (await countRentals()) === 0, noProvider);

    await providerInput.fill("E2E렌탈");
    await dialog.getByLabel("월 렌탈료 (원)").fill("-5");
    await preset("정수기").click();
    await page.waitForFunction(() => /0원 이상/.test(document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
    const negFee = await alertText();
    await dialog.getByLabel("월 렌탈료 (원)").fill("32900");
    await dialog.getByLabel("결제일 (매월)").fill("32");
    await preset("정수기").click();
    await page.waitForFunction(() => /1~31일/.test(document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
    const badDay = await alertText();
    await dialog.getByLabel("결제일 (매월)").fill("15");
    await dialog.getByLabel("계약 시작일").fill(shift(50));
    await dialog.getByLabel("약정 만료일").fill(shift(45));
    await preset("정수기").click();
    await page.waitForFunction(() => /빠를 수 없어요/.test(document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
    const badOrder = await alertText();
    record("rental", vp.name, "server validation: negative fee, billing day 32 and end-before-start are rejected with clear messages, nothing stored", /0원 이상/.test(negFee) && /1~31일/.test(badDay) && /빠를 수 없어요/.test(badOrder) && (await countRentals()) === 0, `${negFee} | ${badDay} | ${badOrder}`);

    // -- valid rental registration
    await dialog.getByLabel("계약 시작일").fill(shift(-320));
    await dialog.getByLabel("약정 만료일").fill(shift(45));
    await dialog.getByLabel("소유권 이전 만료일").fill(shift(400));
    await dialog.getByRole("radio", { name: "방문 코디" }).click();
    await dialog.getByLabel("제휴카드 메모").fill("KB국민 30만원 실적");
    await preset("정수기").click();
    let rentalRow = null;
    for (let i = 0; i < 30 && !rentalRow; i++) {
      rentalRow = (await sb.from("assets").select("*").eq("rental_provider", "E2E렌탈")).data?.[0] ?? null;
      if (!rentalRow) await page.waitForTimeout(500);
    }
    record(
      "rental",
      vp.name,
      "rental registration stores all 9 columns (RENTAL, provider, fee, billing day, contract/obligation/transfer dates, VISIT care, card note)",
      !!rentalRow && rentalRow.ownership_type === "RENTAL" && rentalRow.rental_provider === "E2E렌탈" && rentalRow.monthly_fee === 32900 && rentalRow.billing_day === 15 && rentalRow.contract_start_date === shift(-320) && rentalRow.obligation_end_date === shift(45) && rentalRow.ownership_transfer_date === shift(400) && rentalRow.care_type === "VISIT" && rentalRow.payment_card_note === "KB국민 30만원 실적",
      JSON.stringify(rentalRow && { o: rentalRow.ownership_type, f: rentalRow.monthly_fee, d: rentalRow.billing_day, c: rentalRow.care_type }),
    );

    // -- switching back to OWNED collapses the panel and registers a plain owned asset (rental columns untouched)
    await ownedRadio.click();
    await waitPanel(true);
    await preset("에어컨").click();
    let ownedRow = null;
    for (let i = 0; i < 30 && !ownedRow; i++) {
      const { data } = await sb.from("assets").select("*").eq("preset_key", "aircon");
      ownedRow = (data ?? []).filter((a) => !beforeIds.has(a.id))[0] ?? null;
      if (!ownedRow) await page.waitForTimeout(500);
    }
    record("rental", vp.name, "switching back to 직접 구매 collapses the panel; the new asset is OWNED with no rental data", !!ownedRow && ownedRow.ownership_type === "OWNED" && ownedRow.rental_provider === null && ownedRow.monthly_fee === null && ownedRow.care_type === "NONE");
    await page.keyboard.press("Escape");

    // -- list: badge on the rental card only
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const rentalCard = page.locator("main li").filter({ has: page.getByTestId("rental-badge") });
    const badgeText = ((await rentalCard.first().getByTestId("rental-badge").textContent()) ?? "").replace(/\s+/g, " ").trim();
    const badgeBox = await rentalCard.first().getByTestId("rental-badge").boundingBox();
    const nameBox = await rentalCard.first().locator("h3").boundingBox();
    record("rental", vp.name, "card shows the “[렌탈] 렌탈사명” badge above the name, only on rental assets", (await rentalCard.count()) === 1 && /^렌탈s*E2E렌탈$/.test(badgeText) && !!badgeBox && !!nameBox && badgeBox.y < nameBox.y, `badges=${await rentalCard.count()} text="${badgeText}"`);
    await rentalCard.first().scrollIntoViewIfNeeded();
    await rentalCard.first().screenshot({ path: `${OUT}/assets-rental-card-desktop.png` });

    // -- detail: fee + remaining obligation
    await rentalCard.first().getByRole("button", { name: /상세 보기/ }).click();
    const detail = page.getByRole("dialog");
    await detail.getByLabel("렌탈 정보").waitFor();
    const fee = ((await detail.getByTestId("rental-fee").textContent()) ?? "").trim();
    const obligation = ((await detail.getByTestId("rental-obligation").textContent()) ?? "").trim();
    record("rental", vp.name, "detail: monthly fee “32,900원” + billing day + “약정 만료까지 D-45” with a D-45 badge", fee === "32,900원" && obligation === "약정 만료까지 D-45" && (await detail.getByText("D-45", { exact: true }).count()) >= 1 && (await detail.getByText("매월 15일 결제").count()) === 1, `${fee} | ${obligation}`);
    record("rental", vp.name, "detail: contract progress bar, care type, card memo, transfer date", (await detail.getByRole("progressbar", { name: "계약 진행률" }).count()) === 1 && (await detail.getByText("방문 코디").count()) >= 1 && (await detail.getByText("KB국민 30만원 실적").count()) === 1 && (await detail.getByText("소유권 이전 만료일").count()) === 1);
    await page.waitForTimeout(500); // dialog fade/zoom-in must finish before the capture
    await page.screenshot({ path: `${OUT}/asset-detail-rental-desktop.png` });
    await page.keyboard.press("Escape");

    // -- an owned asset's detail has no rental section
    const ownedCard = page.locator("main li").filter({ has: page.getByRole("button", { name: "에어컨 상세 보기" }) }).filter({ hasNot: page.getByTestId("rental-badge") });
    await ownedCard.first().getByRole("button", { name: /상세 보기/ }).click();
    const ownedDetail = page.getByRole("dialog");
    await ownedDetail.getByText("관리 규칙").waitFor();
    record("rental", vp.name, "owned asset detail: no rental section, still lists management rules", (await ownedDetail.getByLabel("렌탈 정보").count()) === 0 && (await ownedDetail.getByText("직접 구매").count()) >= 1);
    await page.keyboard.press("Escape");

    // -- mobile: the badge card and the detail dialog fit a 375px screen
    const mctx = await newContext(VIEWPORTS[1], storageState);
    const mp = await mctx.newPage();
    await mp.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const mCard = mp.locator("main li").filter({ has: mp.getByTestId("rental-badge") }).first();
    await mCard.getByRole("button", { name: /상세 보기/ }).click();
    const mDetail = mp.getByRole("dialog");
    await mDetail.getByLabel("렌탈 정보").waitFor();
    const mBox = await mDetail.boundingBox();
    record("rental", "mobile", "mobile: rental card + detail dialog fit 375px without horizontal overflow", (await overflowCheck(mp)) && !!mBox && mBox.width <= 375, `dialog w=${Math.round(mBox?.width ?? 0)}`);
    await mp.waitForTimeout(500);
    await mp.screenshot({ path: `${OUT}/asset-detail-rental-mobile.png` });
    {
      // Long nowrap lines must never widen the dialog's grid column (that clipped the cards and the ‘수정’ button).
      await mDetail.getByRole("tab", { name: "환승 & 비용 비교" }).click();
      await mDetail.getByTestId("rental-compare").waitFor();
      await mp.waitForTimeout(500);
      const fit = await mDetail.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
      record("compare", "mobile", "mobile: comparison tab fits the 375px dialog (no horizontal clipping)", fit.scrollW <= fit.clientW + 1 && (await overflowCheck(mp)), JSON.stringify(fit));
      await mp.screenshot({ path: `${OUT}/asset-compare-mobile.png` });
    }
    await mctx.close();

    // ================================================================ Phase 3-2: 환승 & 비용 비교 tab
    // Expected figures are computed HERE from the same inputs (fee 32,900 · obligation +45d · transfer +400d · 정수기 defaults),
    // independently of the app code: a formula bug in the app would show up as a mismatch.
    const dayNum = (d) => Date.UTC(...d.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) / 86_400_000;
    const monthsTo = (d) => Math.max(0, Math.ceil((dayNum(d) - dayNum(today)) / 30.4375));
    const won = (n) => `${n.toLocaleString("ko-KR")}원`;
    const FEE = 32_900;
    const exp = {
      keep: FEE * Math.min(36, monthsTo(shift(400))),
      obligationMonths: monthsTo(shift(45)),
      switch: 25_000 * 36 - 250_000,
      buy: 450_000 + 90_000 * 3,
    };

    await rentalCard.first().getByRole("button", { name: /상세 보기/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("렌탈 정보").waitFor();
    const infoTab = dlg.getByRole("tab", { name: "정보" });
    const compareTab = dlg.getByRole("tab", { name: "환승 & 비용 비교" });
    record("compare", vp.name, "rental detail has a tablist: ‘정보’ (selected) + ‘환승 & 비용 비교’", (await infoTab.getAttribute("aria-selected")) === "true" && (await compareTab.count()) === 1);

    await compareTab.click();
    await dlg.getByTestId("rental-compare").waitFor();
    await page.waitForTimeout(500);
    const totalOf = async (k) => (((await dlg.getByTestId(`compare-${k}-total`).textContent()) ?? "").trim());
    const recommendedIn = async (k) => (await dlg.getByTestId(`compare-${k}`).getByTestId("compare-recommended").count()) === 1;
    record("compare", vp.name, "3-way totals over 36 months match the independent calculation (keep / new rental / buy)", (await totalOf("keep")) === won(exp.keep) && (await totalOf("switch")) === won(exp.switch) && (await totalOf("buy")) === won(exp.buy), `${await totalOf("keep")} | ${await totalOf("switch")} | ${await totalOf("buy")}`);
    const oblLine = ((await dlg.getByTestId("compare-obligation-line").textContent()) ?? "").replace(/\s+/g, " ");
    record("compare", vp.name, "cheapest is flagged ‘추천’ once; remaining obligation line = N개월 × fee", (await recommendedIn("keep")) && (await dlg.getByTestId("compare-recommended").count()) === 1 && oblLine.includes(`잔여 의무 ${exp.obligationMonths}개월`) && oblLine.includes(won(FEE * exp.obligationMonths)), oblLine);
    record("compare", vp.name, "‘추정치’ disclaimer and the keep-option basis are shown", (await dlg.getByText("추정치", { exact: false }).count()) >= 1 && (await dlg.getByText(/소유권 이전 후에는 렌탈료가 없어요/).count()) === 1);
    const fitDesktop = await dlg.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
    record("compare", vp.name, "desktop: comparison tab fits the dialog (cards and ‘수정’ button are not clipped)", fitDesktop.scrollW <= fitDesktop.clientW + 1, JSON.stringify(fitDesktop));
    await page.screenshot({ path: `${OUT}/asset-compare-desktop.png` });

    // Outbound links (fixed hosts, encoded keyword, safe rel)
    const dHref = (await dlg.getByTestId("compare-link-danawa").getAttribute("href")) ?? "";
    const nHref = (await dlg.getByTestId("compare-link-naver").getAttribute("href")) ?? "";
    const dRel = (await dlg.getByTestId("compare-link-danawa").getAttribute("rel")) ?? "";
    record(
      "compare",
      vp.name,
      "outlinks: 다나와 + 네이버 쇼핑 search for “정수기 렌탈”, new tab, rel=noopener noreferrer",
      dHref === `https://search.danawa.com/dsearch.php?query=${encodeURIComponent("정수기 렌탈")}` &&
        nHref === `https://search.shopping.naver.com/search/all?query=${encodeURIComponent("정수기 렌탈")}` &&
        (await dlg.getByTestId("compare-link-danawa").getAttribute("target")) === "_blank" &&
        /noopener/.test(dRel) && /noreferrer/.test(dRel) &&
        (await dlg.getByText("최신 모델 렌탈 조건 비교하기").count()) === 1,
      dHref,
    );

    // Assumptions recalculate live and move the recommendation
    await dlg.getByRole("button", { name: "가정값 조정" }).click();
    await dlg.getByLabel("신규 렌탈 월 요금 (원)").fill("10000");
    await page.waitForFunction(() => !!document.querySelector('[data-testid="compare-switch"] [data-testid="compare-recommended"]'), null, { timeout: 5000 }).catch(() => {});
    const swTotal = await totalOf("switch");
    record("compare", vp.name, "editing ‘신규 렌탈 월 요금’ recalculates instantly and moves ‘추천’ to 신규 렌탈 환승", swTotal === won(10_000 * 36 - 250_000) && (await recommendedIn("switch")) && /신규 렌탈 환승/.test((await dlg.getByTestId("compare-summary").textContent()) ?? ""), swTotal);
    await dlg.getByLabel("위약금 (원)").fill("500000");
    await page.waitForTimeout(150);
    record("compare", vp.name, "penalty is added to both switching options; keep becomes cheapest again", (await totalOf("switch")) === won(10_000 * 36 - 250_000 + 500_000) && (await totalOf("buy")) === won(exp.buy + 500_000) && (await recommendedIn("keep")), `${await totalOf("switch")} | ${await totalOf("buy")}`);
    await dlg.getByRole("button", { name: "기본값으로" }).click();
    await page.waitForTimeout(150);
    record("compare", vp.name, "‘기본값으로’ restores the default assumptions", (await totalOf("switch")) === won(exp.switch) && (await totalOf("buy")) === won(exp.buy));
    await page.keyboard.press("Escape");

    // ================================================================ Phase 3-3: notification deep link (/assets?openAssetId=…&tab=…)
    {
      const rid = rentalRow.id;
      const dlUrl = (id, tab) => `${BASE}/assets?openAssetId=${id}${tab ? `&tab=${tab}` : ""}`;
      const settle = async () => {
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        await page.waitForFunction(() => !location.search.includes("openAssetId"), null, { timeout: 10_000 }).catch(() => {});
      };
      const ddlg = page.getByRole("dialog");

      await page.goto(dlUrl(rid, "compare"), { waitUntil: "networkidle" });
      await ddlg.getByTestId("rental-compare").waitFor({ timeout: 15_000 }).catch(() => {});
      await settle();
      record("deeplink", vp.name, "?openAssetId=<id>&tab=compare opens that asset's detail on ‘환승 & 비용 비교’, then strips the query", (await ddlg.getByRole("tab", { name: "환승 & 비용 비교" }).getAttribute("aria-selected")) === "true" && (await ddlg.getByTestId("rental-compare").count()) === 1 && !page.url().includes("openAssetId"), page.url().replace(BASE, ""));
      await page.keyboard.press("Escape");

      await page.goto(dlUrl(rid, "info"), { waitUntil: "networkidle" });
      await ddlg.getByLabel("렌탈 정보").waitFor({ timeout: 15_000 }).catch(() => {});
      await settle();
      record("deeplink", vp.name, "?tab=info opens the detail on the ‘정보’ tab", (await ddlg.getByRole("tab", { name: "정보" }).getAttribute("aria-selected")) === "true" && (await ddlg.getByTestId("rental-compare").count()) === 0);
      await page.keyboard.press("Escape");

      await page.goto(dlUrl("00000000-0000-4000-8000-000000000000", "compare"), { waitUntil: "networkidle" });
      await page.getByRole("status").filter({ hasText: "찾을 수 없어요" }).waitFor({ timeout: 10_000 }).catch(() => {});
      await settle();
      record("deeplink", vp.name, "unknown asset id: an inline notice (no dialog), query stripped", (await page.getByRole("status").filter({ hasText: "찾을 수 없어요" }).count()) === 1 && (await ddlg.count()) === 0 && !page.url().includes("openAssetId"));

      await page.goto(`${BASE}/assets?openAssetId=not-a-uuid&tab=compare`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      record("deeplink", vp.name, "malformed id is ignored (no dialog, no notice)", (await ddlg.count()) === 0 && (await page.getByRole("status").filter({ hasText: "찾을 수 없어요" }).count()) === 0);

      // ---- bell click on a RENTAL_EXPIRING notification (needs a notification row -> service role)
      if (svc) {
        const { data: nrow, error: nerr } = await svc
          .from("notifications")
          .insert({ household_id: myProfile.household_id, user_id: me.user.id, type: "RENTAL_EXPIRING", asset_id: rid, title: "[정수기] 렌탈 의무 약정 D-60", body: "위약금 없는 환승 타이밍! 현재 유지 vs 신규 환승 비용을 비교해 보세요.", dedupe_key: `e2e-bell-${Date.now()}` })
          .select("id")
          .single();
        if (nerr) record("deeplink", vp.name, "bell flow: a RENTAL_EXPIRING notification can be created (needs migration 0010)", false, nerr.message);
        if (nrow) {
        const bell = () => page.getByRole("button", { name: /^알림( \d+건)?$/ });
        const panelEl = () => page.locator('[aria-label="알림 목록"]');
        const clickItem = async () => {
          await bell().click();
          await panelEl().waitFor();
          await panelEl().locator("li button", { hasText: "렌탈 의무 약정 D-60" }).first().click();
        };

        // (a) from another page (/timeline) -> routed to /assets with the dialog open
        await page.goto(`${BASE}/timeline`, { waitUntil: "networkidle" });
        await clickItem();
        await page.waitForURL(/\/assets/, { timeout: 15_000 });
        await ddlg.getByTestId("rental-compare").waitFor({ timeout: 15_000 }).catch(() => {});
        await settle();
        record("deeplink", vp.name, "bell: clicking the RENTAL_EXPIRING notification on /timeline routes to /assets and opens the comparison tab", /\/assets/.test(page.url()) && (await ddlg.getByTestId("rental-compare").count()) === 1);
        await page.keyboard.press("Escape");

        // (b) already on /assets with a filter that hides the card: the filter is reset, and a second click opens it again
        await page.getByRole("group", { name: "필터" }).getByRole("button", { name: /^세탁실/ }).click();
        const hiddenByFilter = (await page.locator("main li").filter({ has: page.getByTestId("rental-badge") }).count()) === 0;
        await clickItem();
        await ddlg.getByTestId("rental-compare").waitFor({ timeout: 15_000 }).catch(() => {});
        await settle();
        await page.keyboard.press("Escape");
        const allActive = await page.getByRole("group", { name: "필터" }).getByRole("button", { name: /^전체/ }).evaluate((el) => el.className.includes("bg-sky-600"));
        const visibleAgain = (await page.locator("main li").filter({ has: page.getByTestId("rental-badge") }).count()) === 1;
        record("deeplink", vp.name, "bell on /assets: a hiding filter is reset to ‘전체’ and the card's comparison tab opens", hiddenByFilter && allActive && visibleAgain, `hidden=${hiddenByFilter} all=${allActive} visible=${visibleAgain}`);
        await clickItem();
        await ddlg.getByTestId("rental-compare").waitFor({ timeout: 15_000 }).catch(() => {});
        record("deeplink", vp.name, "the same notification opens the dialog again (query was cleaned up after the first use)", (await ddlg.getByTestId("rental-compare").count()) === 1);
        await settle();
        await page.keyboard.press("Escape");
        await svc.from("notifications").delete().eq("id", nrow.id);
        }
      }
    }

    // ================================================================ Phase 3-3: household rental summary banner
    {
      const bannerText = async () => (((await page.getByTestId("rental-summary-text").first().textContent({ timeout: 8000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
      await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const t1 = await bannerText();
      record("rental-summary", vp.name, "banner above the list: “1개 품목, 월 32,900원” for the one rental", t1 === "1개 품목, 월 32,900원", t1);
      const bannerBox = await page.getByTestId("rental-summary").boundingBox();
      const pillsBox = await page.getByRole("group", { name: "필터" }).boundingBox();
      record("rental-summary", vp.name, "banner sits at the very top of the list (above the filter pills)", !!bannerBox && !!pillsBox && bannerBox.y + bannerBox.height <= pillsBox.y);
      await page.getByTestId("rental-summary").screenshot({ path: `${OUT}/assets-rental-summary-desktop.png` });

      // a second rental without a fee: counted, not summed, and the note explains it
      const { data: extra, error: extraErr } = await sb
        .from("assets")
        .insert({ household_id: myProfile.household_id, owner_id: me.user.id, name: "E2E 렌탈 요금없음", ownership_type: "RENTAL", rental_provider: "E2E렌탈B" })
        .select("id")
        .single();
      if (extraErr) throw new Error(`summary fixture failed: ${extraErr.message}`);
      await page.reload({ waitUntil: "networkidle" });
      const t2 = await bannerText();
      const noteShown = (await page.getByTestId("rental-summary").getByText("(요금 미입력 1개 제외)").count()) === 1;
      record("rental-summary", vp.name, "a rental without a fee is counted but not summed (“2개 품목, 월 32,900원 (요금 미입력 1개 제외)”)", t2 === "2개 품목, 월 32,900원" && noteShown, t2);
      await sb.from("assets").delete().eq("id", extra.id);
      await page.reload({ waitUntil: "networkidle" });
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    }

    // ================================================================ Phase 3-2: asset edit modal
    await rentalCard.first().getByRole("button", { name: /상세 보기/ }).click();
    await dlg.getByLabel("렌탈 정보").waitFor();
    await dlg.getByRole("button", { name: "수정", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "자산 정보 수정" });
    await edit.waitFor();
    await page.waitForTimeout(500);
    const valueOf = (label) => edit.getByLabel(label).inputValue();
    record(
      "edit",
      vp.name,
      "‘수정’ opens the edit modal pre-filled with the saved values (name, place, rental details, care, card memo)",
      (await edit.getByLabel(/^이름/).inputValue()) === "정수기" &&
        (await edit.getByLabel(/렌탈사명/).inputValue()) === "E2E렌탈" &&
        (await valueOf("월 렌탈료 (원)")) === "32900" &&
        (await valueOf("결제일 (매월)")) === "15" &&
        (await valueOf("약정 만료일")) === shift(45) &&
        (await valueOf("제휴카드 메모")) === "KB국민 30만원 실적" &&
        (await edit.getByRole("radio", { name: "방문 코디" }).getAttribute("aria-checked")) === "true" &&
        (await edit.getByRole("radio", { name: "렌탈·구독" }).getAttribute("aria-checked")) === "true",
    );
    await page.screenshot({ path: `${OUT}/asset-edit-rental-desktop.png` });

    // validation
    await edit.getByLabel(/^이름/).fill("");
    await edit.getByRole("button", { name: "저장" }).click();
    await edit.getByRole("alert").waitFor({ timeout: 10_000 });
    const noName = ((await edit.getByRole("alert").textContent()) ?? "").trim();
    await edit.getByLabel(/^이름/).fill("정수기");
    await edit.getByLabel("결제일 (매월)").fill("40");
    await edit.getByRole("button", { name: "저장" }).click();
    await page.waitForFunction(() => /1~31일/.test(document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
    const badDay2 = ((await edit.getByRole("alert").textContent()) ?? "").trim();
    const { data: untouched } = await sb.from("assets").select("name, billing_day").eq("rental_provider", "E2E렌탈").single();
    record("edit", vp.name, "invalid edits are rejected with clear messages and nothing is saved", /이름을 입력해 주세요/.test(noName) && /1~31일/.test(badDay2) && untouched.name === "정수기" && untouched.billing_day === 15, `${noName} | ${badDay2}`);

    // successful edit
    await edit.getByLabel(/^이름/).fill("정수기 (거실)");
    await edit.getByLabel("위치").selectOption("거실");
    await edit.getByLabel("카테고리").fill("생활가전 테스트");
    await edit.getByLabel("메모", { exact: true }).fill("E2E 메모");
    await edit.getByLabel("월 렌탈료 (원)").fill("29900");
    await edit.getByLabel("결제일 (매월)").fill("20");
    await edit.getByRole("radio", { name: "자가 관리" }).click();
    await edit.getByRole("button", { name: "저장" }).click();
    await edit.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    let edited = null;
    for (let i = 0; i < 20 && !edited; i++) {
      const { data } = await sb.from("assets").select("*").eq("rental_provider", "E2E렌탈").eq("name", "정수기 (거실)");
      edited = data?.[0] ?? null;
      if (!edited) await page.waitForTimeout(500);
    }
    record(
      "edit",
      vp.name,
      "saving updates the row (name, place, category, memo, fee, billing day, care) and keeps it a rental",
      !!edited && edited.space === "거실" && edited.category === "생활가전 테스트" && edited.note === "E2E 메모" && edited.monthly_fee === 29_900 && edited.billing_day === 20 && edited.care_type === "SELF" && edited.ownership_type === "RENTAL" && edited.obligation_end_date === shift(45),
    );

    // the list/detail reflect the new values without a manual reload
    const renamedCard = page.locator("main li").filter({ hasText: "정수기 (거실)" });
    await renamedCard.first().waitFor({ timeout: 15_000 });
    await renamedCard.first().getByRole("button", { name: /상세 보기/ }).click();
    await dlg.getByLabel("렌탈 정보").waitFor();
    const feeNow = ((await dlg.getByTestId("rental-fee").textContent()) ?? "").trim();
    record("edit", vp.name, "card + detail show the edited values (name, ‘29,900원’, ‘매월 20일’, memo)", feeNow === "29,900원" && (await dlg.getByText("매월 20일 결제").count()) === 1 && (await dlg.getByText("E2E 메모").count()) >= 1 && (await dlg.getByText("자가 관리").count()) >= 1, feeNow);
    record("rental-summary", vp.name, "banner follows the edit (월 29,900원)", /월 29,900원/.test(((await page.getByTestId("rental-summary-text").first().textContent()) ?? "")), ((await page.getByTestId("rental-summary-text").first().textContent()) ?? "").trim());
    await dlg.getByRole("tab", { name: "환승 & 비용 비교" }).click();
    await page.waitForTimeout(300);
    record("edit", vp.name, "the comparison recalculates from the edited fee (29,900 × months to transfer)", (await totalOf("keep")) === won(29_900 * Math.min(36, monthsTo(shift(400)))), await totalOf("keep"));
    await page.keyboard.press("Escape");

    // rental -> owned clears the rental data
    await renamedCard.first().getByRole("button", { name: /상세 보기/ }).click();
    await dlg.getByRole("button", { name: "수정", exact: true }).click();
    await edit.waitFor();
    await edit.getByRole("radio", { name: "직접 구매" }).click();
    const warn = (await edit.getByRole("note").count()) === 1;
    await edit.getByRole("button", { name: "저장" }).click();
    await edit.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    let owned = null;
    for (let i = 0; i < 20 && !owned; i++) {
      const { data } = await sb.from("assets").select("*").eq("name", "정수기 (거실)");
      owned = data?.find((a) => a.ownership_type === "OWNED") ?? null;
      if (!owned) await page.waitForTimeout(500);
    }
    record("edit", vp.name, "rental → 직접 구매 warns first, then clears every rental column (care back to NONE)", warn && !!owned && owned.rental_provider === null && owned.monthly_fee === null && owned.billing_day === null && owned.obligation_end_date === null && owned.payment_card_note === null && owned.care_type === "NONE");
    const bannerGone = await page.getByTestId("rental-summary").waitFor({ state: "detached", timeout: 15_000 }).then(() => true).catch(() => false);
    record("rental-summary", vp.name, "after rental → 직접 구매 the banner disappears (no rentals left)", bannerGone);
    await page.locator("main li").filter({ hasText: "정수기 (거실)" }).first().waitFor();
    await page.locator("main li").filter({ hasText: "정수기 (거실)" }).first().getByRole("button", { name: /상세 보기/ }).click();
    await dlg.getByText("관리 규칙").waitFor();
    record("edit", vp.name, "after the switch the detail has no rental badge/compare tab/rental section", (await dlg.getByRole("tab", { name: "환승 & 비용 비교" }).count()) === 0 && (await dlg.getByTestId("rental-badge").count()) === 0 && (await dlg.getByLabel("렌탈 정보").count()) === 0);
    await page.keyboard.press("Escape");
    record("rental", vp.name, "no console/page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));
  } finally {
    // Remove what this block created: tasks first (deleting an asset would only null their asset_id), then the assets (rules cascade).
    const { data: afterAssets } = await sb.from("assets").select("id");
    const created = (afterAssets ?? []).map((a) => a.id).filter((id) => !beforeIds.has(id));
    if (created.length) {
      await sb.from("tasks").delete().in("asset_id", created);
      await sb.from("assets").delete().in("id", created);
    }
    await ctx.close();
    const { count: left } = await sb.from("assets").select("id", { count: "exact", head: true }).eq("rental_provider", "E2E렌탈");
    record("rental", vp.name, "cleanup: rental test assets, rules and tasks removed", left === 0, `created=${created.length} left=${left}`);
  }
}

// ---------------------------------------------------------------- Magic Link flow (share -> anonymous page -> complete)
// Sandbox: the flow runs on a throw-away one-off task created through the test user's session, so the
// real demo tasks are never consumed. Leftovers of a crashed earlier run are cleaned up first.
const SANDBOX_PREFIX = "E2E 임시 과업";
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
// Phase 2-5: a simulated push subscription for the admin, so the INSTANT push after Magic Link completion / invite
// acceptance can be observed (the endpoint marker makes the test-mode sender answer 201; no cron runs in this suite).
const instantEndpoint = `https://fcm.googleapis.com/fcm/send/e2e-ok-instant-${Date.now()}`;
if (svc) {
  await svc.from("push_subscriptions").delete().eq("user_id", me.user.id);
  await svc.from("push_subscriptions").insert({ user_id: me.user.id, endpoint: instantEndpoint, ...fakeKeys() });
}
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

  // Instant push: no cron has run in this suite yet, so push_sent_at can only come from the post-response trigger.
  if (svc) {
    let row = null;
    for (let i = 0; i < 30; i++) {
      row = (await svc.from("notifications").select("created_at, push_sent_at").like("body", `%${sandboxTitle}%`)).data?.[0];
      if (row?.push_sent_at) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const { data: usedSub } = await svc.from("push_subscriptions").select("last_used_at").eq("endpoint", instantEndpoint).single();
    const latencyMs = row?.push_sent_at ? new Date(row.push_sent_at) - new Date(row.created_at) : null;
    record("push", "-", "instant push after Magic Link completion: pushed within seconds, no cron needed (push_sent_at + subscription last_used_at set)", !!row?.push_sent_at && latencyMs < 20_000 && !!usedSub?.last_used_at, `latency=${latencyMs}ms`);
  }
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

    // Reset the admin's subscription so the INSTANT push for INVITE_ACCEPTED can be observed on its own.
    await svc.from("push_subscriptions").update({ last_used_at: null }).eq("user_id", me.user.id);
    await mp.getByRole("button", { name: "가구에 참여하기" }).click();
    await mp.waitForURL(/\/assets/, { timeout: 20_000 });
    await mp.waitForLoadState("networkidle");
    await mp.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    record("invite", V, "joined: /assets shows the household capsule", (await mp.getByText("E2E 테스트 가구").count()) > 0);
    {
      let row = null;
      for (let i = 0; i < 30; i++) {
        row = (await svc.from("notifications").select("created_at, push_sent_at").eq("type", "INVITE_ACCEPTED").like("body", "E2E 구성원%").order("created_at", { ascending: false }).limit(1)).data?.[0];
        if (row?.push_sent_at) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const { data: usedSub } = await svc.from("push_subscriptions").select("last_used_at").eq("endpoint", instantEndpoint).single();
      const latencyMs = row?.push_sent_at ? new Date(row.push_sent_at) - new Date(row.created_at) : null;
      record("push", V, "instant push after invite acceptance: admin pushed within seconds (push_sent_at + subscription last_used_at set)", !!row?.push_sent_at && latencyMs < 20_000 && !!usedSub?.last_used_at, `latency=${latencyMs}ms`);
    }
    record("invite", V, "member role: no ‘가전 추가’ (ADMIN-only)", (await mp.getByRole("button", { name: "가전 추가" }).count()) === 0);

    {
      // Phase 3-2: editing is ADMIN-only in the UI as well
      await mp.getByRole("button", { name: /상세 보기/ }).first().click();
      const memberDetail = mp.getByRole("dialog");
      await memberDetail.waitFor();
      record("edit", V, "member role: asset detail has no ‘수정’ button (ADMIN-only)", (await memberDetail.getByRole("button", { name: "수정", exact: true }).count()) === 0);
      await mp.keyboard.press("Escape");
    }
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

      // ---- Phase 3-2: a member cannot edit assets even by calling the API directly (RLS: ADMIN-only UPDATE)
      {
        const { data: target } = await sb.from("assets").select("id, name").limit(1).single();
        const hack = await msb.from("assets").update({ name: "HACKED", ownership_type: "RENTAL", rental_provider: "x" }).eq("id", target.id).select("id");
        const { data: after } = await sb.from("assets").select("name, rental_provider").eq("id", target.id).single();
        record("edit", V, "RLS: a member's direct UPDATE on assets changes nothing (0 rows)", (hack.data?.length ?? 0) === 0 && after.name === target.name && after.rental_provider !== "x", `rows=${hack.data?.length ?? 0} err=${hack.error?.code ?? "-"}`);
      }

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
        record("due", V, "RPC summary: date (Seoul), per-type counts add up to total", !gen1.error && gen1.data?.date === today && gen1.data.total === gen1.data.due_soon + gen1.data.due_today + gen1.data.overdue + (gen1.data.rental_expiring ?? 0) && typeof gen1.data.rental_expiring === "number" && gen1.data.due_soon >= 4 && gen1.data.due_today >= 3 && gen1.data.overdue >= 2, JSON.stringify(gen1.data));

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

        // ---- Phase 3-3: rental obligation expiry (D-60 / D-30), recipients, dedupe
        const rmk = (label, end, extra = {}) => ({ household_id: myProfile.household_id, owner_id: me.user.id, name: `${SANDBOX_PREFIX} 렌탈 ${label}`, ownership_type: "RENTAL", rental_provider: "E2E렌탈R", obligation_end_date: end, ...extra });
        const rSpecs = {
          r60: rmk("D60", shift(60)),
          r30: rmk("D30", shift(30)),
          r45: rmk("D45", shift(45)), // not 60/30 -> nothing
          owned60: rmk("소유60", shift(60), { ownership_type: "OWNED", rental_provider: null }), // only RENTAL assets
          priv30: rmk("개인D30", shift(30), { visibility: "PRIVATE" }), // owner only
        };
        const rid = {};
        for (const [key, row] of Object.entries(rSpecs)) {
          const { data, error } = await sb.from("assets").insert(row).select("id").single();
          if (error) throw new Error(`rental generator fixture ${key} failed: ${error.message}`);
          rid[key] = data.id;
        }
        const genR = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { data: rrows } = await svc.from("notifications").select("user_id, type, dedupe_key, task_id, asset_id, title, body").in("asset_id", Object.values(rid)).eq("type", "RENTAL_EXPIRING");
        const rof = (k) => (rrows ?? []).filter((r) => r.asset_id === rid[k]);
        const rusers = (k) => rof(k).map((r) => r.user_id).sort().join(",");
        const BODY = "위약금 없는 환승 타이밍! 현재 유지 vs 신규 환승 비용을 비교해 보세요.";

        record("rental-due", V, "D-60 rental → RENTAL_EXPIRING for every household member: title “[가전명] 렌탈 의무 약정 D-60”, fixed body, asset_id set, no task", rof("r60").length === 2 && rusers("r60") === both && rof("r60").every((r) => r.title === `[${rSpecs.r60.name}] 렌탈 의무 약정 D-60` && r.body === BODY && r.task_id === null), rof("r60")[0]?.title ?? "none");
        record("rental-due", V, "D-30 rental → “… D-30”; a PRIVATE rental notifies its owner only", rof("r30").length === 2 && rof("r30").every((r) => r.title.endsWith("D-30")) && rof("priv30").length === 1 && rof("priv30")[0].user_id === me.user.id, `r30=${rof("r30").length} priv30=${rof("priv30").length}`);
        record("rental-due", V, "D-45, owned assets (even with a date) and other days create nothing (while D-60/D-30 do)", !genR.error && typeof genR.data?.rental_expiring === "number" && rof("r60").length > 0 && rof("r45").length === 0 && rof("owned60").length === 0);
        record(
          "rental-due",
          V,
          "dedupe_key = rental-expiring:<asset_id>:<obligation_end_date>:<remaining_days>",
          rof("r60").length > 0 && rof("r30").length > 0 && rof("r60").every((r) => r.dedupe_key === `rental-expiring:${rid.r60}:${shift(60)}:60`) && rof("r30").every((r) => r.dedupe_key === `rental-expiring:${rid.r30}:${shift(30)}:30`),
          rof("r60")[0]?.dedupe_key ?? "none",
        );
        record("rental-due", V, "RPC summary has rental_expiring (5 = 2 + 2 + 1) and total includes it", !genR.error && genR.data?.rental_expiring === 5 && genR.data.total === genR.data.due_soon + genR.data.due_today + genR.data.overdue + genR.data.rental_expiring, JSON.stringify(genR.data));

        const genR2 = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { count: rCount2 } = await svc.from("notifications").select("id", { count: "exact", head: true }).in("asset_id", Object.values(rid)).eq("type", "RENTAL_EXPIRING");
        record("rental-due", V, "re-running creates no new rental alerts (dedupe)", genR2.data?.rental_expiring === 0 && rCount2 === 5, `new=${genR2.data?.rental_expiring} rows=${rCount2}`);

        // the end date is part of the key: a changed obligation date alerts again (D-30 now) and the old alerts stay
        await sb.from("assets").update({ obligation_end_date: shift(30) }).eq("id", rid.r60);
        const genR3 = await svc.rpc("generate_due_notifications", { p_household_id: myProfile.household_id });
        const { data: r60rows } = await svc.from("notifications").select("dedupe_key, title").eq("asset_id", rid.r60);
        record("rental-due", V, "changing obligation_end_date → a new D-30 alert (new key), the old D-60 alert is kept", genR3.data?.rental_expiring === 2 && r60rows?.length === 4 && r60rows.some((r) => r.dedupe_key === `rental-expiring:${rid.r60}:${shift(30)}:30` && r.title.endsWith("D-30")), `new=${genR3.data?.rental_expiring} rows=${r60rows?.length}`);
      } finally {
        // notifications first (deleting a task would null their task_id), then the sandbox tasks
        await svc.from("notifications").delete().eq("household_id", myProfile.household_id).or("dedupe_key.like.due-%,dedupe_key.like.overdue:%,dedupe_key.like.rental-expiring:%");
        await sb.from("assets").delete().like("name", `${SANDBOX_PREFIX}%`);
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
  record("push", "-", "manifest.json: name, standalone, start_url, 192/512 icons", mf.status === 200 && manifest?.display === "standalone" && manifest?.start_url === "/" && manifest?.icons?.some((i) => i.sizes === "512x512"), `status=${mf.status}`);
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

    // 8) Phase 3-3: a D-30 rental flows through generate -> send, and the claim carries asset_id (push deep-link data)
    const { data: rAsset, error: rAssetErr } = await sb
      .from("assets")
      .insert({ household_id: myProfile.household_id, owner_id: uid, name: `${SANDBOX_PREFIX} 렌탈 파이프라인`, ownership_type: "RENTAL", rental_provider: "E2E렌탈R", obligation_end_date: shift(30) })
      .select("id")
      .single();
    if (rAssetErr) throw new Error(`rental pipeline fixture failed: ${rAssetErr.message}`);
    const r9 = await dispatch({ generate: true, household_id: myProfile.household_id });
    const { data: rn } = await svc.from("notifications").select("type, push_sent_at, title").eq("asset_id", rAsset.id);
    record("push", "-", "pipeline: a D-30 rental becomes RENTAL_EXPIRING and is pushed in the same run", r9.status === 200 && r9.json?.generated?.rental_expiring >= 1 && rn?.length === 1 && rn[0].type === "RENTAL_EXPIRING" && /D-30/.test(rn[0].title) && !!rn[0].push_sent_at, JSON.stringify(r9.json?.generated));
    const { data: dlRow } = await svc.from("notifications").insert({ household_id: myProfile.household_id, user_id: uid, type: "RENTAL_EXPIRING", asset_id: rAsset.id, title: "E2E deeplink", body: "x", dedupe_key: `e2e-dl-${Date.now()}` }).select("id").single();
    const claim = await svc.rpc("claim_unsent_notifications", { p_limit: 10, p_user_ids: [uid] });
    const claimedRow = (claim.data ?? []).find((r) => r.id === dlRow?.id);
    record("push", "-", "claim_unsent_notifications returns asset_id (the dispatcher builds /assets?openAssetId=…&tab=compare from it)", claimedRow?.asset_id === rAsset.id && claimedRow?.type === "RENTAL_EXPIRING", JSON.stringify(claimedRow ?? null));
    await svc.from("notifications").delete().eq("asset_id", rAsset.id);
    await sb.from("assets").delete().eq("id", rAsset.id);

    // Cleanup (dedicated E2E account)
    await svc.from("push_subscriptions").delete().eq("user_id", uid);
    await svc.from("notifications").delete().eq("user_id", uid);
  }
}
// ---------------------------------------------------------------- Track B: asset documents (receipts / warranties / manuals)
{
  const DOC_BUCKET = "asset-documents";
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"); // 1x1
  const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const probeTable = svc ? await svc.from("asset_documents").select("id").limit(1) : { error: { message: "no service key" } };
  const probeBucket = svc ? await svc.storage.getBucket(DOC_BUCKET) : { error: { message: "no service key" } };
  const probe = { error: probeTable.error ?? probeBucket.error };

  if (probe.error) {
    record("documents", "-", "migration 20261110000011_asset_documents.sql is applied (table asset_documents reachable)", false, probe.error.message);
  } else {
    const { data: who } = await sb.auth.getUser();
    const uid = who.user.id;
    const { data: prof } = await sb.from("profiles").select("household_id").eq("id", uid).single();
    const hh = prof.household_id;
    const { data: owned, error: ownedErr } = await sb
      .from("assets")
      .insert({ household_id: hh, owner_id: uid, name: "E2E 문서 냉장고", ownership_type: "OWNED" })
      .select("id")
      .single();
    if (ownedErr) throw new Error(`documents fixture failed: ${ownedErr.message}`);
    const { data: rentalFx } = await sb
      .from("assets")
      .insert({ household_id: hh, owner_id: uid, name: "E2E 문서 렌탈", ownership_type: "RENTAL", rental_provider: "E2E렌탈", monthly_fee: 1000 })
      .select("id")
      .single();
    const assetId = owned.id;
    const docRows = async () => (await svc.from("asset_documents").select("*").eq("asset_id", assetId).order("created_at")).data ?? [];
    const objectNames = async () => (await svc.storage.from(DOC_BUCKET).list(`${hh}/${assetId}`)).data?.map((o) => o.name) ?? [];
    const rand = Math.random().toString(36).slice(2, 10);
    let strangerId = null;

    const openDocs = async (page, id = assetId) => {
      await page.goto(`${BASE}/assets?openAssetId=${id}&tab=info`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("tab", { name: "문서 & 보증서" }).click();
      await dlg.getByTestId("documents-panel").waitFor();
      return dlg;
    };

    try {
      // ---- UI: desktop
      const ctx = await newContext(VIEWPORTS[0], storageState);
      const page = await ctx.newPage();
      page.__errors = [];
      page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && page.__errors.push(`console: ${m.text()}`));

      let dlg = await openDocs(page);
      const names = await dlg.getByRole("tab").allInnerTexts();
      record("documents", "desktop", "owned asset detail has tabs ‘정보’ + ‘문서 & 보증서’ (no compare tab)", names.join("|") === "정보|문서 & 보증서", names.join("|"));
      await page.goto(`${BASE}/assets?openAssetId=${rentalFx.id}&tab=info`, { waitUntil: "networkidle" });
      const rnames = await page.getByRole("dialog").getByRole("tab").allInnerTexts();
      record("documents", "desktop", "rental asset detail has all three tabs: 정보 · 환승 & 비용 비교 · 문서 & 보증서", rnames.join("|") === "정보|환승 & 비용 비교|문서 & 보증서", rnames.join("|"));

      dlg = await openDocs(page);
      await dlg.getByTestId("documents-empty").waitFor();
      record("documents", "desktop", "empty state + dropzone + 4 document-type radios (영수증 selected by default)", (await dlg.getByTestId("documents-empty").count()) === 1 && (await dlg.getByTestId("document-dropzone").count()) === 1 && (await dlg.getByRole("radio").count()) === 4 && (await dlg.getByRole("radio", { name: "영수증" }).getAttribute("aria-checked")) === "true");
      await page.screenshot({ path: `${OUT}/documents-empty-desktop.png` });

      // client-side rejections (no network round trip, nothing stored)
      const fileInput = dlg.getByLabel("문서 파일 선택");
      await fileInput.setInputFiles({ name: "memo.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
      await dlg.getByTestId("document-message").filter({ hasText: "만 올릴 수 있어요" }).waitFor();
      const typeMsg = await dlg.getByTestId("document-message").innerText();
      await fileInput.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
      await dlg.getByTestId("document-message").filter({ hasText: "10.0MB 이하" }).waitFor();
      const sizeMsg = await dlg.getByTestId("document-message").innerText();
      record("documents", "desktop", "wrong type (.txt) and 10MB+1 file are rejected with clear messages", /memo\.txt/.test(typeMsg) && /huge\.png/.test(sizeMsg), `${typeMsg} / ${sizeMsg}`);
      record("documents", "desktop", "rejected files leave no DB row and no Storage object", (await docRows()).length === 0 && (await objectNames()).length === 0);

      // upload: 보증서 PNG via the picker
      await dlg.getByRole("radio", { name: "보증서" }).click();
      await fileInput.setInputFiles({ name: "보증서-냉장고.png", mimeType: "image/png", buffer: PNG });
      await dlg.getByTestId("asset-document").first().waitFor();
      let rows = await docRows();
      let objs = await objectNames();
      record("documents", "desktop", "PNG upload syncs metadata: row (name, size, mime, type, household, path) + Storage object", rows.length === 1 && rows[0].file_name === "보증서-냉장고.png" && rows[0].file_size === PNG.length && rows[0].mime_type === "image/png" && rows[0].document_type === "WARRANTY" && rows[0].household_id === hh && rows[0].owner_id === uid && rows[0].storage_path.startsWith(`${hh}/${assetId}/`) && objs.length === 1 && rows[0].storage_path.endsWith(objs[0]), JSON.stringify(rows[0] ?? null));
      const card = dlg.getByTestId("asset-document").first();
      await card.locator("img").waitFor();
      await page.waitForFunction(() => { const i = document.querySelector('[data-testid="asset-document"] img'); return i && i.complete && i.naturalWidth > 0; });
      record("documents", "desktop", "card shows a real image thumbnail (signed URL loads), name, 보증서 tag, size", (await card.getByText("보증서", { exact: true }).count()) === 1 && /B/.test(await card.innerText()) && (await card.locator("img").count()) === 1);

      // upload: PDF with default... switch type to 설명서
      await dlg.getByRole("radio", { name: "설명서" }).click();
      await fileInput.setInputFiles({ name: "설명서.pdf", mimeType: "application/pdf", buffer: PDF });
      await dlg.getByTestId("asset-document").nth(1).waitFor();
      rows = await docRows();
      record("documents", "desktop", "PDF upload: PDF icon (no thumbnail), type 설명서, DB + Storage in sync", rows.length === 2 && rows[1].mime_type === "application/pdf" && rows[1].document_type === "MANUAL" && (await dlg.getByTestId("asset-document").first().locator("img").count()) + (await dlg.getByTestId("asset-document").nth(1).locator("img").count()) === 1 && (await dlg.locator('[aria-label="PDF"]').count()) === 1 && (await objectNames()).length === 2);

      // drag & drop
      await dlg.getByRole("radio", { name: "영수증" }).click();
      await page.evaluate(
        ({ b64 }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], "영수증-드롭.png", { type: "image/png" }));
          const z = document.querySelector('[data-testid="document-dropzone"]');
          z.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
          z.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        },
        { b64: PNG.toString("base64") },
      );
      await dlg.getByTestId("asset-document").nth(2).waitFor();
      rows = await docRows();
      record("documents", "desktop", "drag & drop upload works (영수증 type)", rows.length === 3 && rows.some((r) => r.file_name === "영수증-드롭.png" && r.document_type === "RECEIPT"));
      record("documents", "desktop", "list header count follows the rows", (await dlg.getByRole("heading", { name: /업로드된 문서/ }).innerText()).includes("3"));
      await page.screenshot({ path: `${OUT}/documents-list-desktop.png` });

      // persistence: reopen from scratch
      dlg = await openDocs(page);
      await dlg.getByTestId("asset-document").nth(2).waitFor();
      record("documents", "desktop", "after a full reload the documents are listed again (3)", (await dlg.getByTestId("asset-document").count()) === 3);

      // download through a signed URL
      const target = dlg.getByTestId("asset-document").filter({ hasText: "설명서.pdf" });
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), target.getByRole("button", { name: /다운로드/ }).click()]);
      record("documents", "desktop", "download gives the original file name via a signed URL", dl.suggestedFilename() === "설명서.pdf", dl.suggestedFilename());

      // delete via UI (two-step)
      const victim = dlg.getByTestId("asset-document").filter({ hasText: "영수증-드롭.png" });
      await victim.getByRole("button", { name: /삭제/ }).click();
      record("documents", "desktop", "delete asks for confirmation first (row still exists)", (await docRows()).length === 3 && (await victim.getByRole("button", { name: "삭제 확인" }).count()) === 1);
      await victim.getByRole("button", { name: "삭제 확인" }).click();
      await victim.waitFor({ state: "detached" });
      rows = await docRows();
      objs = await objectNames();
      record("documents", "desktop", "delete removes the card, the DB row and the Storage object", rows.length === 2 && objs.length === 2 && !rows.some((r) => r.file_name === "영수증-드롭.png"));
      record("documents", "desktop", "no console/page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));
      await ctx.close();

      // ---- DB / Storage hardening, through the user's own API session (RLS applies)
      const upPath = (n) => `${hh}/${assetId}/${n}`;
      const badMime = await sb.storage.from(DOC_BUCKET).upload(upPath(`${rand}-x.txt`), Buffer.from("x"), { contentType: "text/plain" });
      record("documents", "-", "Storage rejects a disallowed MIME type at the bucket level", !!badMime.error, badMime.error?.message ?? "uploaded!");
      const bigUp = await sb.storage.from(DOC_BUCKET).upload(upPath(`${rand}-big.pdf`), Buffer.alloc(10 * 1024 * 1024 + 1), { contentType: "application/pdf" });
      record("documents", "-", "Storage rejects an object over 10MB at the bucket level", !!bigUp.error, bigUp.error?.message ?? "uploaded!");
      const forged = await sb.from("asset_documents").insert({ household_id: hh, asset_id: assetId, file_name: "forged.png", storage_path: `00000000-0000-0000-0000-000000000000/${assetId}/f.png`, file_size: 10, mime_type: "image/png" });
      record("documents", "-", "metadata row pointing outside <household>/<asset>/ is rejected (CHECK)", !!forged.error, forged.error?.message ?? "inserted!");
      const fat = await sb.from("asset_documents").insert({ household_id: hh, asset_id: assetId, file_name: "fat.png", storage_path: upPath("fat.png"), file_size: 10 * 1024 * 1024 + 1, mime_type: "image/png" });
      const badType = await sb.from("asset_documents").insert({ household_id: hh, asset_id: assetId, file_name: "t.png", storage_path: upPath("t.png"), file_size: 10, mime_type: "image/png", document_type: "SECRET" });
      const badMimeRow = await sb.from("asset_documents").insert({ household_id: hh, asset_id: assetId, file_name: "t.exe", storage_path: upPath("t.exe"), file_size: 10, mime_type: "application/x-msdownload" });
      record("documents", "-", "CHECK constraints reject size > 10MB, unknown document_type, disallowed mime_type", !!fat.error && !!badType.error && !!badMimeRow.error, [fat.error?.code, badType.error?.code, badMimeRow.error?.code].join(","));
      const upd = await sb.from("asset_documents").update({ file_name: "renamed" }).eq("asset_id", assetId).select("id");
      record("documents", "-", "metadata is immutable for clients (UPDATE denied)", !!upd.error || (upd.data ?? []).length === 0, upd.error?.message ?? `rows=${upd.data?.length}`);

      // ---- isolation: a stranger in ANOTHER household and an anonymous client
      const strangerEmail = `mylife.e2e.stranger+${rand}@example.com`;
      const strangerPw = `Pw-${rand}-${Date.now()}`;
      const { data: su, error: suErr } = await svc.auth.admin.createUser({ email: strangerEmail, password: strangerPw, email_confirm: true, user_metadata: { display_name: "E2E 타가구" } });
      if (suErr) throw new Error(`stranger createUser failed: ${suErr.message}`);
      strangerId = su.user.id;
      const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      await stranger.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
      const mk = await stranger.rpc("create_household", { p_name: "E2E 타가구", p_display_name: "E2E 타가구" });
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const target0 = (await docRows())[0];
      const realPath = target0.storage_path;

      for (const [who, c] of [["other household", stranger], ["anonymous", anon]]) {
        const sel = await c.from("asset_documents").select("id").eq("asset_id", assetId);
        const lst = await c.storage.from(DOC_BUCKET).list(`${hh}/${assetId}`);
        const dlw = await c.storage.from(DOC_BUCKET).download(realPath);
        const sgn = await c.storage.from(DOC_BUCKET).createSignedUrl(realPath, 60);
        record("documents", "-", `isolation (${who}): cannot SELECT metadata, list, download or sign URLs for my documents`, (sel.data ?? []).length === 0 && (lst.data ?? []).length === 0 && !!dlw.error && !!sgn.error, `meta=${sel.data?.length ?? sel.error?.code} list=${lst.data?.length ?? lst.error?.message} dl=${dlw.error?.message ?? "OK!"} sign=${sgn.error?.message ?? "OK!"}`);
        const ins = await c.from("asset_documents").insert({ household_id: hh, asset_id: assetId, file_name: "evil.png", storage_path: `${hh}/${assetId}/evil.png`, file_size: 10, mime_type: "image/png" });
        const upl = await c.storage.from(DOC_BUCKET).upload(`${hh}/${assetId}/evil-${rand}.png`, PNG, { contentType: "image/png" });
        const del = await c.from("asset_documents").delete().eq("id", target0.id).select("id");
        const rm = await c.storage.from(DOC_BUCKET).remove([realPath]);
        const stillThere = (await docRows()).some((r) => r.id === target0.id) && (await objectNames()).includes(realPath.split("/").pop());
        record("documents", "-", `isolation (${who}): cannot INSERT metadata, upload, DELETE rows or remove objects`, !!ins.error && !!upl.error && (del.data ?? []).length === 0 && (rm.data ?? []).length === 0 && stillThere, `ins=${ins.error?.code} upl=${upl.error?.message} del=${del.data?.length ?? del.error?.code} rm=${rm.data?.length ?? rm.error?.message} intact=${stillThere}`);
      }
      // the stranger's OWN household can use the feature for its own assets only (positive control)
      const { data: sp } = await stranger.from("profiles").select("household_id").eq("id", strangerId).maybeSingle();
      record("documents", "-", "positive control: the other household exists and is a different one", !mk.error && !!sp?.household_id && sp.household_id !== hh, mk.error?.message ?? "");

      // ---- visuals: light/dark × desktop/mobile
      for (const scheme of ["light", "dark"]) {
        for (const vp of VIEWPORTS) {
          const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, storageState, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
          const p = await c.newPage();
          const d = await openDocs(p);
          await d.getByTestId("asset-document").nth(1).waitFor();
          await p.waitForFunction(() => { const i = document.querySelector('[data-testid="asset-document"] img'); return !i || (i.complete && i.naturalWidth > 0); });
          await p.waitForTimeout(500);
          await p.screenshot({ path: `${OUT}/documents-${scheme}-${vp.name}.png` });
          const ov = await p.evaluate(() => { const dd = document.querySelector('[role="dialog"]'); return { page: document.documentElement.scrollWidth <= window.innerWidth, dlg: dd.scrollWidth <= dd.clientWidth + 1 }; });
          record("documents", vp.name, `${scheme}: documents tab fits the ${vp.name} viewport (no horizontal overflow)`, ov.page && ov.dlg, JSON.stringify(ov));
          await c.close();
        }
      }

      // ---- cascade: deleting the asset removes its metadata rows
      await sb.from("assets").delete().eq("id", assetId);
      record("documents", "-", "deleting the asset cascades to asset_documents rows", (await docRows()).length === 0);
    } finally {
      // Remove everything this block created (Storage objects are not removed by the DB cascade).
      const left = await svc.storage.from(DOC_BUCKET).list(`${hh}/${assetId}`);
      if (left.data?.length) await svc.storage.from(DOC_BUCKET).remove(left.data.map((o) => `${hh}/${assetId}/${o.name}`));
      await svc.from("asset_documents").delete().eq("asset_id", assetId);
      await sb.from("assets").delete().in("id", [assetId, rentalFx?.id].filter(Boolean));
      if (strangerId) {
        await svc.from("households").delete().eq("id", (await svc.from("profiles").select("household_id").eq("id", strangerId).maybeSingle()).data?.household_id ?? "00000000-0000-0000-0000-000000000000");
        await svc.auth.admin.deleteUser(strangerId);
      }
    }
  }
}

// ---------------------------------------------------------------- Track C: consumables (purchase links, copy, rule modal)
{
  // ---- pure link builder (no DB): imported straight from the TypeScript source
  const pl = await import("../src/features/tasks/utils/purchase-link.ts");
  const nq = (u) => new URL(u).searchParams;
  const c1 = pl.getPurchaseLinks({ custom_purchase_url: "https://shop.example.com/p/CFX-G100D?ref=a&b=1", consumable_name: "필터", consumable_model: "X", assetModelName: "WP" });
  record("consumables", "-", "custom_purchase_url wins: returned verbatim, kind=custom, no search alternatives", c1?.kind === "custom" && c1.primary === "https://shop.example.com/p/CFX-G100D?ref=a&b=1" && c1.alternatives.length === 0, JSON.stringify(c1));
  const bad = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://files.example.com/x", "//evil.example.com", "/relative/path", "https://a b.example.com", "https://"];
  const badRes = bad.map((u) => pl.getPurchaseLinks({ custom_purchase_url: u, consumable_name: "필터" }));
  record("consumables", "-", "non-http(s) / malformed custom URLs are ignored → falls back to a search link (never the bad URL)", badRes.every((r, i) => r?.kind === "search" && r.primary !== bad[i] && r.primary.startsWith("https://search.shopping.naver.com/")), JSON.stringify(badRes.map((r) => r?.kind)));
  const s1 = pl.getPurchaseLinks({ consumable_name: "복합 일체형 필터", consumable_model: "CFX-G100D", assetModelName: "WP-3000" });
  const q1 = "WP-3000 복합 일체형 필터 CFX-G100D";
  record("consumables", "-", "auto search: Naver Shopping + 다나와 URLs built from asset model + consumable name + model, encodeURIComponent'ed", s1?.kind === "search" && s1.query === q1 && s1.primary === `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q1)}` && s1.alternatives[0]?.label === "다나와" && s1.alternatives[0].url === `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(q1)}`, JSON.stringify(s1));
  const evil = 'x&query=hack#frag "><script>alert(1)</script> 한글/?=%';
  const s2 = pl.getPurchaseLinks({ consumable_name: evil });
  const keys2 = [...nq(s2.primary).keys()];
  record("consumables", "-", "injection-safe: special characters stay inside ONE query parameter (no extra params, no fragment, no raw < > \")", keys2.length === 1 && keys2[0] === "query" && nq(s2.primary).get("query") === evil.trim() && new URL(s2.primary).hash === "" && !/[<>" ]/.test(s2.primary) && new URL(s2.alternatives[0].url).searchParams.get("query") === evil.trim(), s2.primary.slice(0, 120));
  const s3 = pl.getPurchaseLinks({ assetModelName: "WP-3000", consumable_name: "wp-3000", consumable_model: " CFX  " });
  record("consumables", "-", "query de-duplicates repeated terms (case-insensitive) and collapses whitespace", s3?.query === "WP-3000 CFX", s3?.query);
  const s4 = pl.getPurchaseLinks({ consumable_name: "가".repeat(300) });
  record("consumables", "-", "query is capped at 100 characters", s4?.query.length === 100);
  record("consumables", "-", "no consumable name/model → no link (asset model alone is not enough); copyableSpec prefers the model", pl.getPurchaseLinks({ assetModelName: "WP-3000" }) === null && pl.getPurchaseLinks({}) === null && pl.copyableSpec({ consumable_name: "필터", consumable_model: "CFX" }) === "CFX" && pl.copyableSpec({ consumable_name: "필터" }) === "필터");

  const probe = svc ? await svc.from("tasks").select("id, consumable_name").limit(1) : { error: { message: "no service key" } };
  const probe2 = svc ? await svc.rpc("set_rule_consumable", { p_rule_id: "00000000-0000-0000-0000-000000000000", p_name: "", p_model: "", p_url: "" }) : { error: null };
  const missingRpc = probe2.error && /Could not find the function|schema cache/i.test(probe2.error.message);
  if (probe.error || missingRpc) {
    record("consumables", "-", "migration 20261110000012_consumables_support.sql is applied (columns + set_rule_consumable)", false, (probe.error ?? probe2.error)?.message);
  } else {
    const { data: who } = await sb.auth.getUser();
    const uid = who.user.id;
    const { data: prof } = await sb.from("profiles").select("household_id").eq("id", uid).single();
    const hh = prof.household_id;
    const rand = Math.random().toString(36).slice(2, 10);
    const { data: fx, error: fxErr } = await sb
      .from("assets")
      .insert({ household_id: hh, owner_id: uid, name: "E2E 소모품 정수기", ownership_type: "OWNED", model_name: "WP-3000", space: "주방" })
      .select("id")
      .single();
    if (fxErr) throw new Error(`consumables fixture failed: ${fxErr.message}`);
    const assetId = fx.id;
    const rules = async () => (await svc.from("task_rules").select("*").eq("asset_id", assetId).order("created_at")).data ?? [];
    const tasks = async () => (await svc.from("tasks").select("*").eq("asset_id", assetId).order("iteration_no")).data ?? [];
    const NAMETXT = "복합 일체형 필터";
    const MODEL = "CFX-G100D";
    let strangerId = null;

    try {
      // ---- DB constraints
      const { data: baseRule } = await sb.from("task_rules").insert({ household_id: hh, owner_id: uid, asset_id: assetId, title: "E2E 제약 확인", recurring_type: "MONTHLY", interval_n: 1 }).select("id").single();
      const tryUrl = async (url) => (await sb.from("task_rules").update({ custom_purchase_url: url }).eq("id", baseRule.id)).error;
      const errs = await Promise.all(["javascript:alert(1)", "ftp://x.example.com", "https://a b.example.com", "data:text/html,x", "https://" + "a".repeat(2050)].map(tryUrl));
      const okErr = await tryUrl("https://ok.example.com/x?y=1");
      const longName = await sb.from("task_rules").update({ consumable_name: "n".repeat(101) }).eq("id", baseRule.id);
      record("consumables", "-", "DB CHECKs reject javascript:/ftp:/spaced/data:/over-long URLs and over-long names; a valid https URL is accepted", errs.every(Boolean) && !okErr && !!longName.error, errs.map((e) => e?.code ?? "OK").join(",") + ` valid=${okErr?.code ?? "OK"} name=${longName.error?.code}`);
      await sb.from("task_rules").delete().eq("id", baseRule.id);

      // ---- UI: create a rule with consumable info from the asset detail
      const ctx = await newContext(VIEWPORTS[0], storageState);
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
      const page = await ctx.newPage();
      page.__errors = [];
      page.on("pageerror", (e) => page.__errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && page.__errors.push(`console: ${m.text()}`));
      const openDetail = async () => {
        await page.goto(`${BASE}/assets?openAssetId=${assetId}&tab=info`, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        const d = page.getByRole("dialog");
        await d.getByRole("heading", { name: "관리 규칙" }).waitFor();
        return d;
      };
      let dlg = await openDetail();
      record("consumables", "desktop", "asset detail shows the model name (WP-3000) and a ‘규칙 추가’ button for admins", (await dlg.getByTestId("asset-model").innerText()).includes("WP-3000") && (await dlg.getByRole("button", { name: "규칙 추가" }).count()) === 1);

      await dlg.getByRole("button", { name: "규칙 추가" }).click();
      const rm = page.getByRole("dialog").filter({ hasText: "관리 규칙 추가" });
      await rm.waitFor();
      await rm.getByLabel("규칙 이름").fill("복합 필터 교체");
      await rm.getByLabel("소모품 이름").fill(NAMETXT);
      await rm.getByLabel("모델명 · 규격").fill(MODEL);
      await rm.getByLabel("구매 링크").fill("javascript:alert(1)");
      await rm.getByRole("button", { name: "규칙 추가" }).click();
      await rm.getByRole("alert").waitFor();
      record("consumables", "desktop", "rule modal rejects a javascript: purchase link with a clear message; nothing is created", /http/.test(await rm.getByRole("alert").innerText()) && (await rules()).length === 0, await rm.getByRole("alert").innerText());
      await rm.getByLabel("구매 링크").fill("");
      await rm.getByRole("button", { name: "규칙 추가" }).click();
      await rm.waitFor({ state: "detached" });
      let r = await rules();
      let t = await tasks();
      record("consumables", "desktop", "rule created with consumable info: rule row + first task row both carry name/model (URL empty)", r.length === 1 && r[0].consumable_name === NAMETXT && r[0].consumable_model === MODEL && r[0].custom_purchase_url === null && t.length === 1 && t[0].iteration_no === 1 && t[0].consumable_name === NAMETXT && t[0].consumable_model === MODEL && t[0].rule_id === r[0].id, JSON.stringify({ r: r[0], t: t[0] }));

      dlg = page.getByRole("dialog").first();
      const ruleItem = dlg.getByTestId("asset-rule").first();
      await ruleItem.getByTestId("consumable-strip").waitFor();
      const link = ruleItem.getByTestId("purchase-link");
      const wantQ = `WP-3000 ${NAMETXT} ${MODEL}`;
      const href = await link.getAttribute("href");
      record("consumables", "desktop", "rule row: strip (name · model) + [소모품 구매] → Naver Shopping search with asset model + consumable, opens in a new tab with noopener", (await ruleItem.getByTestId("consumable-strip").innerText()).includes(MODEL) && href === `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(wantQ)}` && (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) ?? "") && (await ruleItem.getByTestId("purchase-link-alt").getAttribute("href")) === `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(wantQ)}`, href);
      await page.screenshot({ path: `${OUT}/consumables-asset-rules-desktop.png` });

      // ---- UI: edit → custom URL, open tasks follow (atomic RPC)
      await ruleItem.getByRole("button", { name: /소모품 정보 수정/ }).click();
      const em = page.getByRole("dialog").filter({ hasText: "소모품 정보 수정" });
      await em.waitFor();
      record("consumables", "desktop", "edit modal is pre-filled with the saved consumable info", (await em.getByLabel("소모품 이름").inputValue()) === NAMETXT && (await em.getByLabel("모델명 · 규격").inputValue()) === MODEL);
      const CUSTOM = "https://shop.example.com/filters/CFX-G100D?src=mylife&a=1";
      await em.getByLabel("구매 링크").fill(CUSTOM);
      await em.getByRole("button", { name: "저장" }).click();
      await em.waitFor({ state: "detached" });
      r = await rules();
      t = await tasks();
      record("consumables", "desktop", "edit saved atomically: rule AND its open task now carry the custom purchase URL", r[0].custom_purchase_url === CUSTOM && t[0].custom_purchase_url === CUSTOM, `${r[0].custom_purchase_url} / ${t[0].custom_purchase_url}`);
      await page.waitForFunction(() => document.querySelector('[data-testid="asset-rule"] [data-testid="purchase-link"]')?.getAttribute("data-kind") === "custom");
      const link2 = page.getByRole("dialog").first().getByTestId("asset-rule").first().getByTestId("purchase-link");
      record("consumables", "desktop", "with a custom URL the button opens exactly that URL and the 다나와 alternative disappears", (await link2.getAttribute("href")) === CUSTOM && (await page.getByRole("dialog").first().getByTestId("purchase-link-alt").count()) === 0);
      await page.keyboard.press("Escape");

      // ---- timeline card
      await page.goto(`${BASE}/timeline`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const card = page.locator("main li").filter({ hasText: "복합 필터 교체" }).first();
      await card.waitFor();
      record("consumables", "desktop", "timeline card shows the consumable strip (name · model) and [소모품 구매 ↗] pointing to the custom URL", (await card.getByTestId("consumable-strip").innerText()).includes(MODEL) && (await card.getByTestId("purchase-link").getAttribute("href")) === CUSTOM && (await card.getByTestId("purchase-link").getAttribute("target")) === "_blank");
      const others = await page.locator("main li").filter({ hasNotText: "복합 필터 교체" }).count();
      const stripsElsewhere = await page.locator("main li").filter({ hasNotText: "복합 필터 교체" }).getByTestId("consumable-strip").count();
      record("consumables", "desktop", "cards without consumable info render no strip / purchase button", others > 0 && stripsElsewhere === 0, `others=${others}`);
      await card.getByRole("button", { name: /복사/ }).click();
      await card.getByText("복사됨").waitFor();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      record("consumables", "desktop", "one-click copy puts the model number on the clipboard and confirms with ‘복사됨’", clip === MODEL, clip);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${OUT}/consumables-task-card-desktop.png` });

      // ---- completion copies the rule's CURRENT consumable info into the next occurrence
      await card.getByRole("button", { name: /완료$/ }).click();
      let nextTask = null;
      for (let i = 0; i < 40 && !nextTask; i++) {
        nextTask = (await tasks()).find((x) => x.iteration_no === 2) ?? null;
        if (!nextTask) await page.waitForTimeout(250);
      }
      record("consumables", "desktop", "completing the task generates the next occurrence WITH the rule's consumable info (name, model, custom URL)", !!nextTask && nextTask.consumable_name === NAMETXT && nextTask.consumable_model === MODEL && nextTask.custom_purchase_url === CUSTOM && nextTask.rule_id === r[0].id, JSON.stringify(nextTask));
      const done = (await tasks()).find((x) => x.iteration_no === 1);
      record("consumables", "desktop", "the completed task keeps its own consumable copy (history is not rewritten)", done?.status === "COMPLETED" && done.consumable_model === MODEL);

      // rule edit later propagates to the next (still open) task and to future occurrences
      const upd = await sb.rpc("set_rule_consumable", { p_rule_id: r[0].id, p_name: NAMETXT, p_model: "CFX-NEW9", p_url: "" });
      const after = await tasks();
      record("consumables", "-", "set_rule_consumable returns the number of open tasks updated; completed history stays untouched", upd.data === 1 && after.find((x) => x.iteration_no === 2).consumable_model === "CFX-NEW9" && after.find((x) => x.iteration_no === 2).custom_purchase_url === null && after.find((x) => x.iteration_no === 1).consumable_model === MODEL, JSON.stringify({ n: upd.data, err: upd.error?.message }));
      record("consumables", "desktop", "no console/page errors", page.__errors.length === 0, page.__errors.slice(0, 2).join(" | "));
      await ctx.close();

      // ---- backup restore keeps the new columns
      const rid = crypto.randomUUID(), tid = crypto.randomUUID(), aid = crypto.randomUUID();
      const payload = {
        version: 1,
        assets: [{ id: aid, visibility: "FAMILY", name: "E2E 복구 자산", space: "주방", category: "가전", preset_key: null, note: null, model_name: "RESTORE-1" }],
        task_rules: [{ id: rid, visibility: "FAMILY", asset_id: aid, title: "E2E 복구 규칙", recurring_type: "MONTHLY", interval_n: 1, anchor: "DUE_DATE", day_of_month: null, timezone: "Asia/Seoul", next_iteration_no: 2, active: true, consumable_name: "복구 필터", consumable_model: "R-100", custom_purchase_url: "https://restore.example.com/x" }],
        tasks: [{ id: tid, visibility: "FAMILY", asset_id: aid, rule_id: rid, iteration_no: 1, title: "E2E 복구 과업", due_date: shift(5), status: "PENDING", completed_at: null, snoozed_until: null, consumable_name: "복구 필터", consumable_model: "R-100", custom_purchase_url: "https://restore.example.com/x" }],
        event_logs: [],
      };
      const rest = await sb.rpc("restore_household_backup", { p_payload: payload });
      const ra = (await svc.from("assets").select("model_name").eq("id", aid).maybeSingle()).data;
      const rr = (await svc.from("task_rules").select("consumable_name, consumable_model, custom_purchase_url").eq("id", rid).maybeSingle()).data;
      const rt = (await svc.from("tasks").select("consumable_name, consumable_model, custom_purchase_url").eq("id", tid).maybeSingle()).data;
      record("consumables", "-", "backup restore round-trips assets.model_name and the consumable columns on rules and tasks", !rest.error && ra?.model_name === "RESTORE-1" && rr?.consumable_model === "R-100" && rr?.custom_purchase_url === "https://restore.example.com/x" && rt?.consumable_name === "복구 필터" && rt?.custom_purchase_url === "https://restore.example.com/x", rest.error?.message ?? JSON.stringify({ ra, rr, rt }));
      await svc.from("tasks").delete().eq("id", tid);
      await svc.from("assets").delete().eq("id", aid);

      // ---- backup restore keeps the rental columns (patch 13)
      const RENTAL_COLS = ["ownership_type", "rental_provider", "monthly_fee", "billing_day", "contract_start_date", "obligation_end_date", "ownership_transfer_date", "care_type", "payment_card_note"];
      const backupSrc = await readFile("src/features/household/server/backup.actions.ts", "utf8");
      const assetsCols = /assets:\s*"([^"]+)"/.exec(backupSrc)?.[1] ?? "";
      record("backup-rental", "-", "export COLUMNS.assets lists all 9 rental columns", RENTAL_COLS.every((c) => assetsCols.split(",").map((s) => s.trim()).includes(c)), assetsCols);
      const rentId = crypto.randomUUID(), ownedId = crypto.randomUUID(), legacyId = crypto.randomUUID();
      const base = { visibility: "FAMILY", space: "주방", category: "가전", preset_key: null, note: null, model_name: null };
      const rentalPayload = {
        version: 1,
        assets: [
          { ...base, id: rentId, name: "E2E 렌탈 복구", ownership_type: "RENTAL", rental_provider: "코웨이", monthly_fee: 32900, billing_day: 15, contract_start_date: "2025-01-10", obligation_end_date: "2030-01-09", ownership_transfer_date: "2030-01-10", care_type: "VISIT", payment_card_note: "삼성 1234" },
          { ...base, id: ownedId, name: "E2E 소유 복구", ownership_type: "OWNED", care_type: "NONE" },
          { ...base, id: legacyId, name: "E2E 구백업 복구" }, // pre-patch backup: no rental keys at all
        ],
        task_rules: [], tasks: [], event_logs: [],
      };
      const rentRest = await sb.rpc("restore_household_backup", { p_payload: rentalPayload });
      const got = (await svc.from("assets").select("id, ownership_type, rental_provider, monthly_fee, billing_day, contract_start_date, obligation_end_date, ownership_transfer_date, care_type, payment_card_note").in("id", [rentId, ownedId, legacyId])).data ?? [];
      const g = (id) => got.find((x) => x.id === id);
      record("backup-rental", "-", "restore round-trips a rental asset (all 9 columns)", !rentRest.error && g(rentId)?.ownership_type === "RENTAL" && g(rentId)?.rental_provider === "코웨이" && g(rentId)?.monthly_fee === 32900 && g(rentId)?.billing_day === 15 && g(rentId)?.contract_start_date === "2025-01-10" && g(rentId)?.obligation_end_date === "2030-01-09" && g(rentId)?.ownership_transfer_date === "2030-01-10" && g(rentId)?.care_type === "VISIT" && g(rentId)?.payment_card_note === "삼성 1234", rentRest.error?.message ?? JSON.stringify(g(rentId)));
      record("backup-rental", "-", "owned asset stays OWNED / NONE", g(ownedId)?.ownership_type === "OWNED" && g(ownedId)?.care_type === "NONE" && g(ownedId)?.monthly_fee === null, JSON.stringify(g(ownedId)));
      record("backup-rental", "-", "old backup without rental keys still restores as OWNED / NONE (column defaults)", g(legacyId)?.ownership_type === "OWNED" && g(legacyId)?.care_type === "NONE" && g(legacyId)?.rental_provider === null, JSON.stringify(g(legacyId)));
      const badRent = await sb.rpc("restore_household_backup", { p_payload: { version: 1, assets: [{ ...base, id: crypto.randomUUID(), name: "E2E 잘못된 렌탈", ownership_type: "LEASE" }], task_rules: [], tasks: [], event_logs: [] } });
      record("backup-rental", "-", "invalid ownership_type is rejected by the CHECK (restore rolls back)", !!badRent.error && /^2[23]/.test(badRent.error.code ?? ""), badRent.error?.code ?? "no error");
      await svc.from("assets").delete().in("id", [rentId, ownedId, legacyId]);

      // ---- permissions: anonymous and another household cannot use the RPC / touch the rule
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const anonRpc = await anon.rpc("set_rule_consumable", { p_rule_id: r[0].id, p_name: "hack", p_model: "hack", p_url: "https://evil.example.com" });
      const strangerEmail = `mylife.e2e.cons+${rand}@example.com`;
      const strangerPw = `Pw-${rand}-${Date.now()}`;
      const { data: su, error: suErr } = await svc.auth.admin.createUser({ email: strangerEmail, password: strangerPw, email_confirm: true, user_metadata: { display_name: "E2E 타가구" } });
      if (suErr) throw new Error(`stranger createUser failed: ${suErr.message}`);
      strangerId = su.user.id;
      const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      await stranger.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
      await stranger.rpc("create_household", { p_name: "E2E 타가구", p_display_name: "E2E 타가구" });
      const strangerRpc = await stranger.rpc("set_rule_consumable", { p_rule_id: r[0].id, p_name: "hack", p_model: "hack", p_url: "https://evil.example.com" });
      const intact = (await rules())[0];
      record("consumables", "-", "isolation: anonymous and other-household users cannot change a rule's consumable info (RPC denied, data intact)", !!anonRpc.error && !!strangerRpc.error && /RULE_NOT_FOUND_OR_FORBIDDEN/.test(strangerRpc.error.message) && intact.consumable_model === "CFX-NEW9", `anon=${anonRpc.error?.message} stranger=${strangerRpc.error?.message}`);

      // ---- visuals: timeline + asset rules in light/dark × desktop/mobile
      for (const scheme of ["light", "dark"]) {
        for (const vp of VIEWPORTS) {
          const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, storageState, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
          const p = await c.newPage();
          await p.goto(`${BASE}/timeline`, { waitUntil: "networkidle" });
          await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          const cc = p.locator("main li").filter({ hasText: "복합 필터 교체" }).first();
          await cc.waitFor();
          await p.waitForTimeout(600);
          await cc.scrollIntoViewIfNeeded();
          await cc.screenshot({ path: `${OUT}/consumables-card-${scheme}-${vp.name}.png` });
          const ov = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
          const clipped = await cc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
          record("consumables", vp.name, `${scheme}: timeline card with consumables fits the ${vp.name} viewport (no overflow)`, ov && clipped, `page=${ov} card=${clipped}`);
          await p.goto(`${BASE}/assets?openAssetId=${assetId}&tab=info`, { waitUntil: "networkidle" });
          await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          await p.getByRole("dialog").getByTestId("asset-rule").first().waitFor();
          await p.waitForTimeout(500);
          await p.screenshot({ path: `${OUT}/consumables-asset-${scheme}-${vp.name}.png` });
          const dov = await p.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; });
          record("consumables", vp.name, `${scheme}: asset detail with consumable rows fits the ${vp.name} viewport`, dov);
          await c.close();
        }
      }
    } finally {
      await svc.from("tasks").delete().eq("asset_id", assetId);
      await sb.from("assets").delete().eq("id", assetId);
      if (strangerId) {
        const hid = (await svc.from("profiles").select("household_id").eq("id", strangerId).maybeSingle()).data?.household_id;
        if (hid) await svc.from("households").delete().eq("id", hid);
        await svc.auth.admin.deleteUser(strangerId);
      }
    }
  }
}

// ---------------------------------------------------------------- v3 redesign: theme system + light/dark captures
{
  const themeCtx = (vp, scheme, state) =>
    browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  // A rental fixture so the summary banner / rental badges appear in the captures (removed in finally).
  const { data: meRow } = await sb.auth.getUser();
  const { data: prof } = await sb.from("profiles").select("household_id").eq("id", meRow.user.id).single();
  const { data: fx } = await sb
    .from("assets")
    .insert({ household_id: prof.household_id, owner_id: meRow.user.id, name: "E2E 테마 정수기", ownership_type: "RENTAL", rental_provider: "E2E렌탈", monthly_fee: 32900, obligation_end_date: shift(45) })
    .select("id")
    .single();

  try {
    // 1) system preference is followed when the user has not chosen
    for (const scheme of ["light", "dark"]) {
      const c = await themeCtx(VIEWPORTS[0], scheme, storageState);
      const p = await c.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const info = await p.evaluate(() => ({
        dark: document.documentElement.classList.contains("dark"),
        bg: getComputedStyle(document.body.firstElementChild.nextElementSibling ?? document.body).backgroundColor,
        wrap: getComputedStyle(document.querySelector('[data-testid="ambient-bg"]').parentElement).backgroundColor,
      }));
      record("theme", "desktop", `OS ${scheme} preference: the app stays in its LIGHT default (html.dark=false) on the clean off-white page`, info.dark === false && info.wrap === "rgb(248, 250, 252)", JSON.stringify(info));
      record("theme", "desktop", `OS ${scheme} preference: no hydration / console errors`, errs.length === 0, errs.join(" | ").slice(0, 200));
      await c.close();
    }

    // 2) toggle: crossfade icons, persistence, header glass, aurora
    {
      const c = await themeCtx(VIEWPORTS[0], "light", storageState);
      const p = await c.newPage();
      await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      const toggle = p.getByTestId("theme-toggle");
      record("theme", "desktop", "ThemeToggle sits in the header (right cluster, before the bell)", (await toggle.count()) === 1 && (await p.locator("header").getByTestId("theme-toggle").count()) === 1);
      record("theme", "desktop", "header is a sticky white glass bar (backdrop blur + translucent bg) floating on a soft shadow — no hard border line", await p.locator("header").evaluate((h) => { const s = getComputedStyle(h); return s.position === "sticky" && /blur/.test(s.backdropFilter) && s.borderBottomWidth === "0px" && /rgba/.test(s.backgroundColor) && s.boxShadow !== "none"; }));
      const ambient = p.getByTestId("ambient-bg");
      const ambBox = await ambient.boundingBox();
      record("theme", "desktop", "ambient aurora: 3 blurred circles at the page top, decorative (aria-hidden, no pointer events)", (await ambient.locator("div").count()) === 3 && (await ambient.getAttribute("aria-hidden")) === "true" && (await ambient.evaluate((e) => getComputedStyle(e).pointerEvents)) === "none" && ambBox !== null && ambBox.y <= 1, JSON.stringify(ambBox));
      await toggle.click();
      await p.waitForTimeout(450);
      const afterDark = await p.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("theme") }));
      const icons = await toggle.evaluate((b) => [...b.querySelectorAll("svg")].map((s) => ({ o: +getComputedStyle(s).opacity })));
      record("theme", "desktop", "toggle → dark: class applied, choice stored, Moon visible and Sun faded out", afterDark.dark && afterDark.stored === "dark" && icons[0].o < 0.05 && icons[1].o > 0.95, JSON.stringify({ afterDark, icons }));
      await p.reload({ waitUntil: "networkidle" });
      record("theme", "desktop", "dark choice survives a reload (no flash: html.dark present immediately)", await p.evaluate(() => document.documentElement.classList.contains("dark")));
      await toggle.click();
      await p.waitForTimeout(450);
      record("theme", "desktop", "toggle → light again", (await p.evaluate(() => localStorage.getItem("theme"))) === "light" && !(await p.evaluate(() => document.documentElement.classList.contains("dark"))));
      await c.close();
    }

    // 3) forced dark overrides a light OS preference, and public pages carry the toggle too
    {
      const c = await themeCtx(VIEWPORTS[1], "light");
      await c.addInitScript(() => localStorage.setItem("theme", "dark"));
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      record("theme", "mobile", "login: toggle present, stored dark beats light OS preference", (await p.getByTestId("theme-toggle").count()) === 1 && (await p.evaluate(() => document.documentElement.classList.contains("dark"))));
      record("theme", "mobile", "login: no horizontal scroll with the aurora layer", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await c.close();
    }

    // 4) captures (light + dark, desktop + mobile) and a contrast audit
    const SHOTS = [
      ["assets", "/assets"],
      ["timeline", "/timeline"],
    ];
    for (const scheme of ["light", "dark"]) {
      for (const vp of VIEWPORTS) {
        const c = await themeCtx(vp, scheme, storageState);
        const p = await c.newPage();
        const errs = [];
        p.on("pageerror", (e) => errs.push(e.message));
        for (const [name, path] of SHOTS) {
          await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
          await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          await p.waitForTimeout(700);
          await p.screenshot({ path: `${OUT}/v3-${name}-${scheme}-${vp.name}.png`, fullPage: true });
          if (vp.name === "desktop") {
            // contrast audit: every visible text element vs its nearest opaque ancestor background (WCAG AA large-ish floor of 3:1 for tinted/secondary text)
            const bad = await p.evaluate(() => {
              const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
              const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
              const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { if (/gradient/.test(getComputedStyle(e).backgroundImage)) return [37, 99, 235]; const v = parse(getComputedStyle(e).backgroundColor); if (v.length >= 3 && (v[3] === undefined || v[3] > 0.9)) return v; } return [255, 255, 255]; };
              const out = [];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (!n.textContent.trim()) continue;
                const el = n.parentElement;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
                const fg = parse(getComputedStyle(el).color);
                if (fg.length === 4 && fg[3] < 0.5) continue;
                const a = L(fg), b = L(bgOf(el));
                const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                if (ratio < 3) out.push(`${ratio.toFixed(2)} ${el.tagName} "${n.textContent.trim().slice(0, 20)}"`);
              }
              return out;
            });
            record("theme", `${vp.name}`, `${scheme} ${name}: text contrast ≥ 3:1 everywhere`, bad.length === 0, bad.slice(0, 6).join(" | "));
          }
        }
        record("theme", vp.name, `${scheme}: no page errors across captures`, errs.length === 0, errs.join(" | ").slice(0, 200));
        // overflow check on mobile
        if (vp.name === "mobile") {
          await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
          record("theme", "mobile", `${scheme} assets: no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        }
        // rental form with segmented cards
        if (vp.name === "desktop") {
          await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
          await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          await p.getByRole("button", { name: "가전 추가" }).first().click();
          const d = p.getByRole("dialog");
          await d.waitFor();
          const owned = d.getByRole("radio", { name: "직접 구매" });
          const rental = d.getByRole("radio", { name: "렌탈·구독" });
          if (await rental.count()) {
            await rental.click();
            await p.waitForTimeout(600);
            const st = await p.evaluate(() => [...document.querySelectorAll('[role="radiogroup"][aria-label="소유 형태"] [role="radio"]')].map((r) => ({ c: r.getAttribute("aria-checked"), b: getComputedStyle(r).borderTopColor, w: getComputedStyle(r).borderTopWidth, ind: r.querySelector("span[aria-hidden]") ? getComputedStyle(r.querySelector("span[aria-hidden]")).borderRadius : "" })));
            const sel = st.find((x) => x.c === "true"), un = st.find((x) => x.c === "false");
            record("theme", "desktop", `${scheme} ownership cards: selected card has a crisp 1px border distinct from the unselected one, round indicator`, !!sel && !!un && sel.w === "1px" && sel.b !== un.b && /9999|50%|\d{3,}px/.test(sel.ind), JSON.stringify(st));
            record("theme", "desktop", `${scheme} ownership cards: radio semantics kept (2 radios, exactly one aria-checked)`, st.length === 2 && st.filter((x) => x.c === "true").length === 1);
            await p.screenshot({ path: `${OUT}/v3-ownership-modal-${scheme}-desktop.png` });
            await owned.click();
          } else {
            record("theme", "desktop", `${scheme} ownership cards reachable from the add dialog`, false, "radio not found");
          }
          await p.keyboard.press("Escape");
        }
        await c.close();
      }
    }
  } finally {
    if (fx?.id) await sb.from("assets").delete().eq("id", fx.id);
  }
}

// ---------------------------------------------------------------- 리포트 (/analytics): calculator, zero states, access, light/dark, mobile
{
  // ---- pure calculator (imported straight from the TypeScript source)
  const ac = await import("../src/features/analytics/utils/analytics-calculator.ts");
  const T = "2026-11-15";
  const mk = (o) => ({ id: o.id, name: o.name, space: o.space ?? null, category: o.category ?? null, ownership_type: o.rental ? "RENTAL" : "OWNED", rental_provider: o.rental ? "코웨이" : null, monthly_fee: o.fee ?? null, billing_day: o.day ?? null, obligation_end_date: o.oblig ?? null, ownership_transfer_date: o.transfer ?? null, payment_card_note: o.card ?? null, task_rules: o.rules ?? [], tasks: o.tasks ?? [] });
  const A = mk({ id: "a", name: "정수기", rental: true, fee: 30000, day: 25, card: "신한 테스트카드", transfer: "2027-01-10", oblig: "2026-11-20", space: "주방", category: "정수기" });
  const B = mk({ id: "b", name: "공기청정기", rental: true, fee: 20000, day: 5, transfer: "2026-12-01", space: "거실", category: "공기청정기" });
  const C = mk({ id: "c", name: "안마의자", rental: true, day: null, fee: null, transfer: "2026-10-01", space: "거실" });
  const D = mk({ id: "d", name: "냉장고", space: "주방", category: "냉장고" });

  const bs = ac.buildBillingSchedule([A, B, C, D]);
  record("analytics", "-", "billing: monthly total sums only rentals with a fee (50,000), counts 3 rentals, flags 1 missing fee / 1 missing day", bs.monthlyTotal === 50000 && bs.rentalCount === 3 && bs.missingFee === 1 && bs.missingDay === 1, JSON.stringify({ t: bs.monthlyTotal, c: bs.rentalCount, mf: bs.missingFee, md: bs.missingDay }));
  record("analytics", "-", "billing: list is sorted by billing day (5 → 25 → unknown last) and carries name, fee, day and card note", bs.items.map((i) => i.billingDay).join(",") === "5,25," && bs.items[1].fee === 30000 && bs.items[1].cardNote === "신한 테스트카드" && bs.items[0].cardNote === null, JSON.stringify(bs.items.map((i) => [i.name, i.billingDay])));
  record("analytics", "-", "billing: 31-day strip (5th = 20,000, 25th = 30,000, max 30,000, other days empty)", bs.days.length === 31 && bs.days[4].total === 20000 && bs.days[24].total === 30000 && bs.maxDayTotal === 30000 && bs.days.filter((d) => d.items.length).length === 2);
  const nb = (d, t) => ac.nextBillingDate(d, t);
  record("analytics", "-", "next billing date: this month if not passed, else next month; day 31 clamps to month end; year rollover", nb(15, T) === "2026-11-15" && nb(5, T) === "2026-12-05" && nb(31, T) === "2026-11-30" && nb(31, "2026-12-31") === "2026-12-31" && nb(5, "2026-12-20") === "2027-01-05" && nb(30, "2027-02-10") === "2027-02-28", [nb(15, T), nb(5, T), nb(31, T), nb(5, "2026-12-20"), nb(30, "2027-02-10")].join(" "));
  const nx = ac.nextBilling(bs, T);
  record("analytics", "-", "next billing: soonest upcoming charge (11/25, D-10, 30,000) — merges same-day charges", nx?.date === "2026-11-25" && nx.daysUntil === 10 && nx.total === 30000 && nx.names[0] === "정수기", JSON.stringify(nx));

  const sv = ac.buildSavingsForecast([A, B, C, D], T);
  record("analytics", "-", "savings: upcoming transfers sorted by date with the running monthly total after each (50,000 → 30,000 → 0)", sv.transfers.map((x) => x.name).join(",") === "공기청정기,정수기" && sv.transfers[0].monthlyAfter === 30000 && sv.transfers[1].monthlyAfter === 0 && sv.currentMonthly === 50000 && sv.finalMonthly === 0, JSON.stringify(sv.transfers.map((x) => [x.name, x.daysUntil, x.monthlyAfter])));
  record("analytics", "-", "savings: total monthly reduction 50,000 and yearly 600,000", sv.totalMonthlyReduction === 50000 && sv.yearlyReduction === 600000);
  record("analytics", "-", "savings: a transfer date already in the past is reported separately and NOT projected; obligation end D-5 listed", sv.passedTransfers.length === 1 && sv.passedTransfers[0].name === "안마의자" && sv.obligations.length === 1 && sv.obligations[0].daysUntil === 5);
  const svToday = ac.buildSavingsForecast([mk({ id: "e", name: "당일", rental: true, fee: 1000, transfer: T })], T);
  record("analytics", "-", "savings: a transfer happening today still counts as upcoming (D-0)", svToday.transfers.length === 1 && svToday.transfers[0].daysUntil === 0 && svToday.finalMonthly === 0);

  const rule = (id, type, n, name) => ({ id, title: id, recurring_type: type, interval_n: n, consumable_name: name ?? null, consumable_model: null });
  const task = (rule_id, due) => ({ rule_id, due_date: due, status: "PENDING" });
  const qa = mk({
    id: "q", name: "분기 테스트",
    rules: [rule("r1", "MONTHLY", 1, "필터"), rule("r2", "YEARLY", 1), rule("r3", "MONTHLY", 3), rule("r4", "NONE", 1, "무시"), rule("r5", "WEEKLY", 1, "미예정")],
    tasks: [task("r1", "2026-12-01"), task("r2", "2026-10-01"), task("r3", "2026-11-30"), task("r4", "2026-12-15")],
  });
  const qo = ac.buildQuarterOutlook([qa], T);
  const qt = qo.quarters.map((q) => q.total).join(",");
  const qc = qo.quarters.map((q) => q.consumable).join(",");
  record("analytics", "-", "quarters: next 4 calendar quarters labelled 2026 Q4 … 2027 Q3", qo.quarters.map((q) => q.label).join(",") === "2026 Q4,2027 Q1,2027 Q2,2027 Q3", qo.quarters.map((q) => q.label).join(","));
  record("analytics", "-", "quarters: occurrences per interval (monthly ×1 from 12/1, yearly overdue counted once, every-3-months from 11/30 with 2/28 clamp) → totals 3,4,4,4", qt === "3,4,4,4" && qo.maxTotal === 4, `${qt} max=${qo.maxTotal}`);
  record("analytics", "-", "quarters: consumable-registered rules are split from other maintenance (1,3,3,3); NONE rules ignored; rule without an open task is 'unscheduled'", qc === "1,3,3,3" && qo.unscheduledRules === 1, `${qc} unscheduled=${qo.unscheduledRules}`);
  const ny = ac.buildQuarterOutlook([], "2026-12-31");
  record("analytics", "-", "quarters: year rollover from Q4 (today 12/31 → 2026 Q4, 2027 Q1..Q3)", ny.quarters.map((q) => q.label).join(",") === "2026 Q4,2027 Q1,2027 Q2,2027 Q3" && ny.quarters[0].end === "2026-12-31");

  const dist = ac.buildDistribution([A, B, C, D]);
  const kitchen = dist.bySpace.find((r) => r.key === "주방"), living = dist.bySpace.find((r) => r.key === "거실");
  record("analytics", "-", "distribution: per space totals with owned/rental split, overall share 75% rental, unassigned category bucket", dist.total === 4 && dist.rental === 3 && dist.owned === 1 && dist.rentalPct === 75 && kitchen.total === 2 && kitchen.rental === 1 && kitchen.owned === 1 && living.total === 2 && living.rental === 2 && dist.byCategory.some((r) => r.key === "미분류"), JSON.stringify(dist.bySpace));

  // zero states: no assets, owned-only assets → no throw, sane empty shapes
  const z0 = ac.buildAnalyticsReport([], T);
  record("analytics", "-", "zero state: no assets → zeros, no next billing, 31 empty days, 4 empty quarters, 0% share", z0.billing.monthlyTotal === 0 && z0.billing.rentalCount === 0 && z0.nextBilling === null && z0.billing.days.length === 31 && z0.quarters.quarters.every((q) => q.total === 0) && z0.distribution.rentalPct === 0 && z0.savings.transfers.length === 0 && z0.savings.totalMonthlyReduction === 0);
  const z1 = ac.buildAnalyticsReport([D], T);
  record("analytics", "-", "zero state: owned assets only (no rentals) → rental figures 0, distribution still computed", z1.billing.rentalCount === 0 && z1.nextBilling === null && z1.savings.yearlyReduction === 0 && z1.distribution.total === 1 && z1.distribution.bySpace[0].key === "주방");
}

{
  const rand = Math.random().toString(36).slice(2, 10);
  const SP = `E2E리포트${rand}`;
  const created = [];
  let strangerId = null;
  const dayOf = 25;
  try {
    const base = { household_id: myProfile.household_id, owner_id: me.user.id, visibility: "FAMILY", space: SP, category: `분류${rand}` };
    const ins = async (row) => {
      const { data, error } = await sb.from("assets").insert({ ...base, ...row }).select("id").single();
      if (error) throw new Error(`analytics fixture failed: ${error.message}`);
      created.push(data.id);
      return data.id;
    };
    const rentalId = await ins({ name: `E2E렌탈A${rand}`, ownership_type: "RENTAL", rental_provider: "코웨이", monthly_fee: 33000, billing_day: dayOf, contract_start_date: shift(-300), obligation_end_date: shift(12), ownership_transfer_date: shift(45), care_type: "NONE", payment_card_note: `카드메모${rand}` });
    await ins({ name: `E2E렌탈B${rand}`, ownership_type: "RENTAL", rental_provider: "SK매직", monthly_fee: 17000, billing_day: 3, ownership_transfer_date: shift(200) });
    await ins({ name: `E2E소유${rand}`, ownership_type: "OWNED" });
    const { data: rl } = await sb.from("task_rules").insert({ household_id: myProfile.household_id, owner_id: me.user.id, visibility: "FAMILY", asset_id: rentalId, title: "E2E 리포트 규칙", recurring_type: "MONTHLY", interval_n: 1, anchor: "DUE_DATE", next_iteration_no: 2, consumable_name: "리포트필터" }).select("id").single();
    await sb.from("tasks").insert({ household_id: myProfile.household_id, owner_id: me.user.id, visibility: "FAMILY", asset_id: rentalId, rule_id: rl.id, iteration_no: 1, title: "E2E 리포트 규칙", due_date: shift(3), consumable_name: "리포트필터" });

    const themed = async (vp, scheme, state) => {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
      await c.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
      return c;
    };
    const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

    for (const vp of VIEWPORTS) {
      for (const scheme of ["light", "dark"]) {
        const c = await themed(vp, scheme, storageState);
        const p = await c.newPage();
        const errs = [];
        p.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
        p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(`console: ${m.text()}`));
        await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
        await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        await p.getByTestId("kpi-grid").waitFor();
        await p.waitForTimeout(500);
        await p.screenshot({ path: `${OUT}/analytics-${scheme}-${vp.name}.png`, fullPage: true });
        const tag = `${scheme}/${vp.name}`;

        if (scheme === "light") {
          record("analytics", vp.name, "page renders: title 리포트 and all 5 sections present", (await p.getByRole("heading", { name: "리포트", level: 1 }).count()) === 1 && (await p.getByTestId("kpi-grid").count()) === 1 && (await p.getByTestId("billing-strip").count()) === 1 && (await p.getByTestId("savings-card").count()) === 1 && (await p.getByTestId("quarter-bar").count()) === 1 && (await p.getByTestId("space-matrix").count()) === 1);
          record("analytics", vp.name, "KPI grid: 4 cards, each with a value", (await p.getByTestId("kpi-card").count()) === 4 && (await p.getByTestId("kpi-value").allInnerTexts()).every((t) => t.trim().length > 0));
          const nav = vp.name === "desktop" ? p.locator('header nav[aria-label="주요 메뉴"]') : p.locator('nav[aria-label="주요 메뉴"]').last();
          const links = await nav.locator("a").allInnerTexts();
          const cur = await nav.locator('a[aria-current="page"]').allInnerTexts();
          record("analytics", vp.name, "nav: [리포트] tab present and marked aria-current on /analytics (others not)", links.some((t) => t.includes("리포트")) && cur.length === 1 && cur[0].includes("리포트"), `links=${links.join("|")} cur=${cur.join("|")}`);
          if (vp.name === "mobile") record("analytics", vp.name, "mobile bottom tab bar has 4 tabs (자산·타임라인·키친·리포트)", (await nav.locator("a").count()) === 4);

          const row = p.getByTestId("billing-row").filter({ hasText: `E2E렌탈A${rand}` });
          const rowText = await row.innerText();
          record("analytics", vp.name, "billing list: rental row shows 25일, fee 33,000원 and the card memo", rowText.includes("25일") && rowText.includes("33,000원") && rowText.includes(`카드메모${rand}`), rowText.replace(/\s+/g, " "));
          const rowsAll = await p.getByTestId("billing-row").allInnerTexts();
          const dayNums = rowsAll.map((t) => Number((t.match(/(\d+)일/) ?? [])[1] ?? 99));
          record("analytics", vp.name, "billing list is ordered by billing day", dayNums.every((d, i) => i === 0 || d >= dayNums[i - 1]), dayNums.join(","));
          const bar = p.locator('[data-testid="billing-bar"][data-day="25"]');
          record("analytics", vp.name, "billing strip: a bar exists on day 25 with an accessible label", (await bar.count()) === 1 && /25일/.test((await bar.getAttribute("aria-label")) ?? "") && (await p.getByTestId("billing-timeline").locator(":scope > *").count()) === 31);
          const tr = p.getByTestId("transfer-row").filter({ hasText: `E2E렌탈A${rand}` });
          record("analytics", vp.name, "savings card: transfer row with D-45 and projected monthly total", (await tr.count()) === 1 && /D-45/.test(await tr.innerText()) && /월\s[\d,]+원/.test(await tr.innerText()), (await tr.innerText()).replace(/\s+/g, " "));
          const ob = p.getByTestId("obligation-row").filter({ hasText: `E2E렌탈A${rand}` });
          record("analytics", vp.name, "savings card: obligation end row with D-12", (await ob.count()) === 1 && /D-12/.test(await ob.innerText()));
          record("analytics", vp.name, "quarter chart: 4 columns, current-quarter column counts the fixture's open task", (await p.getByTestId("quarter-col").count()) === 4 && Number(await p.getByTestId("quarter-col").first().getAttribute("data-total")) >= 1);
          const mrow = p.getByTestId("matrix-row").filter({ hasText: SP });
          const mtxt = await mrow.innerText();
          record("analytics", vp.name, "space matrix: fixture space has 3개 · 자가 1 · 렌탈 2 with both bar segments", /3개/.test(mtxt) && /자가 1/.test(mtxt) && /렌탈 2/.test(mtxt) && (await mrow.locator('[data-seg="owned"]').count()) === 1 && (await mrow.locator('[data-seg="rental"]').count()) === 1, mtxt.replace(/\s+/g, " "));
          await p.getByRole("radio", { name: "카테고리별" }).click();
          record("analytics", vp.name, "space matrix: switching to 카테고리별 lists the category rows", (await p.getByTestId("matrix-row").filter({ hasText: `분류${rand}` }).count()) === 1 && (await p.getByRole("radio", { name: "카테고리별" }).getAttribute("aria-checked")) === "true");
          await p.getByRole("radio", { name: "공간별" }).click();
        }

        record("analytics", vp.name, `${tag}: no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const isDark = await p.evaluate(() => document.documentElement.classList.contains("dark"));
        const kbg = await p.getByTestId("kpi-card").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        const kb = await p.getByTestId("kpi-card").first().evaluate((el) => getComputedStyle(el).borderTopWidth);
        record("analytics", vp.name, `${tag}: theme applied (html.dark=${scheme === "dark"}), KPI card is ${scheme === "dark" ? "dark" : "white"}, borderless, lifted by a soft shadow`, isDark === (scheme === "dark") && (scheme === "dark" ? lum(kbg) < 0.1 : lum(kbg) > 0.8) && kb === "0px" && (await p.getByTestId("kpi-card").first().evaluate((el) => getComputedStyle(el).boxShadow)) !== "none", `dark=${isDark} bg=${kbg} border=${kb}`);
        const barColor = await p.locator('[data-testid="billing-bar"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
        const savBg = await p.getByTestId("savings-card").evaluate((el) => getComputedStyle(el).backgroundColor);
        record("analytics", vp.name, `${tag}: bars and savings banner use theme colours (violet bar, tinted emerald banner)`, barColor !== "rgba(0, 0, 0, 0)" && savBg !== "rgb(255, 255, 255)" && (scheme === "dark" ? lum(savBg) < 0.2 : lum(savBg) > 0.8), `bar=${barColor} savings=${savBg}`);
        if (vp.name === "desktop") record("analytics", vp.name, `${tag}: ambient aurora layer present`, (await p.getByTestId("ambient-bg").count()) === 1);
        record("analytics", vp.name, `${tag}: no console/page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
        await c.close();
      }
    }

    // ---- access: anonymous visitors are sent to /login
    {
      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
      record("analytics", "desktop", "access: signed-out visit to /analytics redirects to /login and shows no report", new URL(p.url()).pathname.startsWith("/login") && (await p.getByTestId("kpi-grid").count()) === 0, p.url());
      await c.close();
    }

    // ---- a different household sees ONLY its own data (zero state first, then owned-only)
    {
      const strangerEmail = `mylife.e2e.report+${rand}@example.com`;
      const strangerPw = `Pw-${rand}-${Date.now()}`;
      const { data: su, error: suErr } = await svc.auth.admin.createUser({ email: strangerEmail, password: strangerPw, email_confirm: true, user_metadata: { display_name: "E2E 리포트타가구" } });
      if (suErr) throw new Error(`report stranger createUser failed: ${suErr.message}`);
      strangerId = su.user.id;
      const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      await stranger.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
      await stranger.rpc("create_household", { p_name: "E2E 리포트타가구", p_display_name: "E2E 리포트타가구" });

      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.fill('input[name="email"]', strangerEmail);
      await p.fill('input[name="password"]', strangerPw);
      await p.click('button[type="submit"]');
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await p.getByTestId("analytics-empty").waitFor();
      record("analytics", "desktop", "zero state (0 assets): friendly empty state, no sections, none of the other household's fixtures leak", (await p.getByTestId("kpi-grid").count()) === 0 && !(await p.content()).includes(`E2E렌탈A${rand}`) && !(await p.content()).includes(SP));
      await p.screenshot({ path: `${OUT}/analytics-empty-desktop.png`, fullPage: true });

      const { data: sp } = await stranger.from("profiles").select("household_id").eq("id", strangerId).single();
      const { error: sErr } = await stranger.from("assets").insert({ household_id: sp.household_id, owner_id: strangerId, visibility: "FAMILY", name: "E2E 타가구 소유", space: "거실", category: "TV", ownership_type: "OWNED" });
      if (sErr) throw new Error(`report stranger asset failed: ${sErr.message}`);
      await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
      await p.getByTestId("kpi-grid").waitFor();
      const kv = await p.getByTestId("kpi-value").allInnerTexts();
      record("analytics", "desktop", "zero state (0 rentals): billing + savings show neutral notes, quarter chart renders empty, KPIs fall back to —", (await p.getByTestId("billing-empty").count()) === 1 && (await p.getByTestId("savings-summary").innerText()).includes("렌탈·구독 자산이 없어요") && (await p.getByTestId("quarter-empty").count()) === 1 && kv[0].trim() === "—" && kv[1].trim() === "—" && kv[2].trim() === "—" && kv[3].trim() === "0건", kv.join(" | "));
      record("analytics", "desktop", "zero state (0 rentals): the owned asset still appears in the inventory matrix at 0% rental", (await p.getByTestId("matrix-row").filter({ hasText: "거실" }).count()) === 1 && (await p.getByTestId("ownership-share").innerText()).includes("(0%)"));
      await p.screenshot({ path: `${OUT}/analytics-norental-desktop.png`, fullPage: true });
      record("analytics", "desktop", "zero states: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
      await c.close();
    }
  } finally {
    for (const id of created) {
      await svc.from("tasks").delete().eq("asset_id", id);
      await svc.from("task_rules").delete().eq("asset_id", id);
      await svc.from("assets").delete().eq("id", id);
    }
    if (strangerId) {
      const hid = (await svc.from("profiles").select("household_id").eq("id", strangerId).maybeSingle()).data?.household_id;
      if (hid) {
        await svc.from("assets").delete().eq("household_id", hid);
        await svc.from("households").delete().eq("id", hid);
      }
      await svc.auth.admin.deleteUser(strangerId);
    }
  }
}

// ---------------------------------------------------------------- share metadata: OpenGraph / Twitter / icons (what KakaoTalk & Facebook scrapers read — anonymous fetches, no JS)
{
  const FAKE = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"; // plausible-looking, unknown token / code
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const metas = (html) => {
    const out = {};
    for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/g)) {
      const k = /(?:property|name)="([^"]+)"/.exec(m[1])?.[1];
      const v = /content="([^"]*)"/.exec(m[1])?.[1];
      if (k && v !== undefined) (out[k] ??= []).push(decode(v));
    }
    return out;
  };
  const links = (html) => [...html.matchAll(/<link\s+([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], decode(x[2])])));
  const titleOf = (html) => decode(/<title>(.*?)<\/title>/s.exec(html)?.[1] ?? "");
  const get = async (path) => {
    const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return { status: r.status, type: r.headers.get("content-type") ?? "", buf: Buffer.from(await r.arrayBuffer()), html: null };
  };
  const page = async (path) => {
    const r = await get(path);
    r.html = r.buf.toString("utf8");
    return r;
  };
  const pngSize = (buf) => (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);
  const pathOf = (u) => { try { const x = new URL(u, BASE); return x.pathname + x.search; } catch { return u; } };

  const DEF_TITLE = "MyLife Hub - 가전·렌탈 능동형 라이프 매니저";
  const DEF_DESC = "렌탈 약정 만료 추적, 3-Way 비용 비교, 소모품 최저가 검색, 가계 지출 리포트까지 한 번에 관리하는 스마트 가전 허브";

  // ---- global defaults (served on /login, the public landing page)
  const login = await page("/login");
  const lm = metas(login.html);
  record("share", "-", "global: <title>/description follow the brand copy (page title uses the ‘· MyLife Hub’ template)", login.status === 200 && titleOf(login.html) === "로그인 · MyLife Hub" && lm.description?.[0] === DEF_DESC, titleOf(login.html));
  record("share", "-", "global OpenGraph: title, description, type=website, site_name, locale=ko_KR", lm["og:title"]?.[0] === DEF_TITLE && lm["og:description"]?.[0] === DEF_DESC && lm["og:type"]?.[0] === "website" && lm["og:site_name"]?.[0] === "MyLife Hub" && lm["og:locale"]?.[0] === "ko_KR", JSON.stringify([lm["og:title"], lm["og:type"], lm["og:locale"]]));
  record("share", "-", "global Twitter card: summary_large_image with the same title/description/image", lm["twitter:card"]?.[0] === "summary_large_image" && lm["twitter:title"]?.[0] === DEF_TITLE && lm["twitter:description"]?.[0] === DEF_DESC && !!lm["twitter:image"]?.[0], lm["twitter:card"]?.[0]);
  record("share", "-", "global: og:image is an ABSOLUTE https/http URL declared 1200x630 with alt text", /^https?:\/\/[^/]+\/.+/.test(lm["og:image"]?.[0] ?? "") && lm["og:image:width"]?.[0] === "1200" && lm["og:image:height"]?.[0] === "630" && !!lm["og:image:alt"]?.[0], lm["og:image"]?.[0]);

  // ---- the image itself (fetched anonymously: must not be behind the login redirect)
  const ogImg = await get(pathOf(lm["og:image"]?.[0] ?? "/opengraph-image.png"));
  const ogSize = pngSize(ogImg.buf);
  record("share", "-", "OG image: reachable without login (200, image/png), real 1200x630 PNG under 300 KB", ogImg.status === 200 && ogImg.type.startsWith("image/png") && ogSize?.w === 1200 && ogSize?.h === 630 && ogImg.buf.length < 300_000, `${ogImg.status} ${ogImg.type} ${JSON.stringify(ogSize)} ${ogImg.buf.length}B`);
  const twImg = await get(pathOf(lm["twitter:image"]?.[0] ?? "/twitter-image.png"));
  record("share", "-", "Twitter image: reachable without login, 1200x630 PNG", twImg.status === 200 && pngSize(twImg.buf)?.w === 1200 && pngSize(twImg.buf)?.h === 630);

  // ---- invite page
  const inv = await page(`/invite/${FAKE}`);
  const im = metas(inv.html);
  record("share", "-", "invite: custom title/description in <title>, description, og:* and twitter:*", inv.status === 200 && titleOf(inv.html) === "MyLife Hub 가구 초대장이 도착했습니다" && im.description?.[0] === "가족과 함께 가전, 렌탈 약정, 소모품 교체 일정을 관리해 보세요." && im["og:title"]?.[0] === "MyLife Hub 가구 초대장이 도착했습니다" && im["og:description"]?.[0] === im.description?.[0] && im["twitter:title"]?.[0] === im["og:title"]?.[0] && im["twitter:card"]?.[0] === "summary_large_image", titleOf(inv.html));
  record("share", "-", "invite: still has the brand card (og:image 1200x630, site_name, locale, type) after overriding openGraph", /\/opengraph-image\.png/.test(im["og:image"]?.[0] ?? "") && im["og:image:width"]?.[0] === "1200" && im["og:site_name"]?.[0] === "MyLife Hub" && im["og:locale"]?.[0] === "ko_KR" && im["og:type"]?.[0] === "website" && /\/twitter-image\.png/.test(im["twitter:image"]?.[0] ?? ""), im["og:image"]?.[0]);
  record("share", "-", "invite: privacy kept — noindex/nofollow, no-referrer, and the code never appears in any meta tag", /noindex/.test(im.robots?.[0] ?? "") && /nofollow/.test(im.robots?.[0] ?? "") && im.referrer?.[0] === "no-referrer" && !Object.values(im).flat().some((v) => v.includes(FAKE)) && !titleOf(inv.html).includes(FAKE));

  // ---- magic link page
  const mg = await page(`/m/${FAKE}`);
  const mm = metas(mg.html);
  record("share", "-", "magic link: title ‘과업 완료 확인 | MyLife Hub’ (exact, no template suffix) in <title> and og/twitter", mg.status === 200 && titleOf(mg.html) === "과업 완료 확인 | MyLife Hub" && mm["og:title"]?.[0] === "과업 완료 확인 | MyLife Hub" && mm["twitter:title"]?.[0] === "과업 완료 확인 | MyLife Hub", titleOf(mg.html));
  record("share", "-", "magic link: robots noindex+nofollow and no-referrer kept; card has the brand image", /noindex/.test(mm.robots?.[0] ?? "") && /nofollow/.test(mm.robots?.[0] ?? "") && mm.referrer?.[0] === "no-referrer" && /\/opengraph-image\.png/.test(mm["og:image"]?.[0] ?? ""), mm.robots?.[0]);
  record("share", "-", "magic link: generic preview — token/task/asset details never appear in any meta tag", !Object.values(mm).flat().some((v) => v.includes(FAKE)) && !/<meta[^>]*content="[^"]*\/m\//.test(mg.html));
  const unrelated = await page("/login");
  record("share", "-", "the login/landing page is NOT noindex (only token pages are)", !/noindex/.test(metas(unrelated.html).robots?.[0] ?? ""));

  // ---- icons
  const ll = links(login.html);
  const icon32 = ll.filter((l) => /(^| )icon( |$)/.test(l.rel ?? ""));
  const apple = ll.find((l) => l.rel === "apple-touch-icon");
  record("share", "-", "icon <link> tags: favicon.ico, a PNG icon and an apple-touch-icon are declared", icon32.some((l) => /favicon\.ico/.test(l.href)) && icon32.some((l) => /icon\.png/.test(l.href)) && !!apple, JSON.stringify(ll.filter((l) => /icon/.test(l.rel ?? "")).map((l) => l.href)));
  const fav = await get("/favicon.ico");
  const nIco = fav.buf.length >= 6 ? fav.buf.readUInt16LE(4) : 0;
  let icoOk = fav.buf.readUInt16LE(0) === 0 && fav.buf.readUInt16LE(2) === 1 && nIco >= 1;
  for (let i = 0; icoOk && i < nIco; i++) {
    const size = fav.buf.readUInt32LE(6 + i * 16 + 8), off = fav.buf.readUInt32LE(6 + i * 16 + 12);
    icoOk = off + size <= fav.buf.length && pngSize(fav.buf.subarray(off, off + size)) !== null;
  }
  record("share", "-", "favicon.ico: 200, valid ICO with ≥3 embedded PNG sizes, anonymous", fav.status === 200 && icoOk && nIco >= 3, `${fav.status} ${fav.type} images=${nIco} ${fav.buf.length}B`);
  const ic = await get(pathOf(icon32.find((l) => /icon\.png/.test(l.href))?.href ?? "/icon.png"));
  record("share", "-", "icon.png is a real 512x512 PNG", ic.status === 200 && pngSize(ic.buf)?.w === 512 && pngSize(ic.buf)?.h === 512, JSON.stringify(pngSize(ic.buf)));
  const ap = await get(pathOf(apple?.href ?? "/apple-icon.png"));
  record("share", "-", "apple-icon.png is a real 180x180 PNG", ap.status === 200 && pngSize(ap.buf)?.w === 180 && pngSize(ap.buf)?.h === 180, JSON.stringify(pngSize(ap.buf)));
  const mf = JSON.parse((await get("/manifest.json")).buf.toString("utf8"));
  const i192 = await get("/icons/icon-192.png"), i512 = await get("/icons/icon-512.png");
  record("share", "-", "PWA manifest icons (192/512) are valid PNGs of the right size, theme colour matches the dark brand", pngSize(i192.buf)?.w === 192 && pngSize(i512.buf)?.w === 512 && mf.theme_color === "#09090b" && mf.background_color === "#09090b");
  const unauth = await fetch(`${BASE}/analytics`, { redirect: "manual" });
  record("share", "-", "regression: protected /analytics still redirects anonymous visitors to /login (middleware + layout)", unauth.status >= 300 && unauth.status < 400 && /\/login/.test(unauth.headers.get("location") ?? ""), `${unauth.status} ${unauth.headers.get("location")}`);
}

// ---------------------------------------------------------------- PWA install button (header) + installability checks
{
  // ---- pure: iOS detection
  const pi = await import("../src/shared/hooks/use-pwa-install.ts");
  const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    ipad: "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  record("pwa", "-", "iOS detection: iPhone and iPad UAs → true; iPadOS in desktop mode (MacIntel + touch) → true; real Mac / Android / Windows → false",
    pi.detectIOS(UA.iphone, "iPhone", 5) && pi.detectIOS(UA.ipad, "iPad", 5) && pi.detectIOS(UA.mac, "MacIntel", 5) && !pi.detectIOS(UA.mac, "MacIntel", 0) && !pi.detectIOS(UA.android, "Linux armv81", 5) && !pi.detectIOS(UA.win, "Win32", 0));

  const ctxFor = async (vp, { scheme = "light", ua, touch, init } = {}) => {
    const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme, ...(ua ? { userAgent: ua } : {}), ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    await c.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
    if (init) await c.addInitScript(init);
    return c;
  };
  const open = async (c, path = "/assets") => {
    const p = await c.newPage();
    p.__errors = [];
    p.on("pageerror", (e) => p.__errors.push(`pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && p.__errors.push(`console: ${m.text()}`));
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.getByTestId("theme-toggle").waitFor();
    await p.waitForTimeout(300);
    return p;
  };
  const fire = (p, outcome = "accepted") =>
    p.evaluate((o) => {
      window.__installCalls = 0;
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = async () => { window.__installCalls++; };
      e.userChoice = Promise.resolve({ outcome: o, platform: "web" });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }, outcome);
  const btn = (p) => p.getByTestId("pwa-install");

  // ---- browser mode (no install path yet): nothing is rendered
  for (const [vp, scheme] of [[VIEWPORTS[0], "light"], [VIEWPORTS[0], "dark"], [VIEWPORTS[1], "light"], [VIEWPORTS[1], "dark"]]) {
    const c = await ctxFor(vp, { scheme });
    const p = await open(c);
    const tag = `${scheme}/${vp.name}`;
    if (scheme === "light" && vp.name === "desktop") {
      record("pwa", vp.name, "browser mode, no install event yet (desktop UA): no install button is rendered", (await btn(p).count()) === 0);
      const prevented = await fire(p);
      await btn(p).waitFor();
      record("pwa", vp.name, "beforeinstallprompt is captured (default mini-infobar suppressed) → the button appears", prevented === true && (await btn(p).count()) === 1 && (await btn(p).getAttribute("data-mode")) === "native");
      const place = await btn(p).evaluate((el) => ({ next: el.nextElementSibling?.getAttribute("data-testid"), inHeader: !!el.closest("header"), label: el.getAttribute("aria-label"), size: [el.getBoundingClientRect().width, el.getBoundingClientRect().height] }));
      record("pwa", vp.name, "button sits in the header right cluster directly before the theme toggle, 32×32, labelled ‘앱 설치하기’", place.next === "theme-toggle" && place.inHeader && place.label === "앱 설치하기" && place.size[0] === 32 && place.size[1] === 32, JSON.stringify(place));
      const tip = p.getByTestId("pwa-install-tip");
      const o0 = await tip.evaluate((el) => getComputedStyle(el).opacity);
      await btn(p).hover();
      await p.waitForTimeout(350);
      const o1 = await tip.evaluate((el) => getComputedStyle(el).opacity);
      record("pwa", vp.name, "tooltip: hidden by default, ‘앱 설치하기’ fades in on hover", o0 === "0" && o1 === "1" && (await tip.innerText()).trim() === "앱 설치하기" && (await tip.getAttribute("role")) === "tooltip", `${o0}→${o1}`);
      await p.screenshot({ path: `${OUT}/pwa-install-hover-${scheme}-${vp.name}.png`, clip: { x: VIEWPORTS[0].width - 340, y: 0, width: 340, height: 120 } });
      const bdr = await btn(p).evaluate((el) => getComputedStyle(el).borderTopWidth);
      record("pwa", vp.name, "button uses the 1px-border ghost style (same as the theme toggle)", bdr === "1px");
      await btn(p).click();
      await p.waitForFunction(() => window.__installCalls === 1);
      await p.waitForTimeout(200);
      record("pwa", vp.name, "click → the stored deferredPrompt.prompt() runs exactly once; the used prompt hides the button", (await p.evaluate(() => window.__installCalls)) === 1 && (await btn(p).count()) === 0);
    } else {
      await fire(p);
      await btn(p).waitFor();
      record("pwa", vp.name, `${tag}: button renders with a visible icon and no horizontal scroll`, (await btn(p).locator("svg").count()) === 1 && (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
      await btn(p).hover();
      await p.waitForTimeout(300);
      const colors = await btn(p).evaluate((el) => ({ c: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
      const tipBg = await p.getByTestId("pwa-install-tip").evaluate((el) => getComputedStyle(el).backgroundColor);
      const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      record("pwa", vp.name, `${tag}: hover state and tooltip follow the theme`, scheme === "dark" ? lum(colors.c) > 0.5 && lum(tipBg) < 0.1 : lum(colors.c) < 0.2 && lum(tipBg) > 0.8, JSON.stringify({ colors, tipBg }));
      await p.screenshot({ path: `${OUT}/pwa-install-header-${scheme}-${vp.name}.png`, clip: { x: 0, y: 0, width: vp.width, height: 110 } });
    }
    record("pwa", vp.name, `${tag}: no console/page errors`, p.__errors.length === 0, p.__errors.slice(0, 2).join(" | "));
    await c.close();
  }

  // ---- appinstalled auto-hides the button
  {
    const c = await ctxFor(VIEWPORTS[0]);
    const p = await open(c);
    await fire(p);
    await btn(p).waitFor();
    await p.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await p.waitForTimeout(200);
    record("pwa", "desktop", "appinstalled → the button disappears automatically", (await btn(p).count()) === 0);
    await fire(p);
    await p.waitForTimeout(200);
    record("pwa", "desktop", "…and stays gone for the rest of the session even if another install event arrives", (await btn(p).count()) === 0);
    await c.close();
  }

  // ---- standalone (installed app): never rendered, even when an install event arrives or on iOS
  {
    const mm = () => { const real = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? real("all") : real(q)); };
    const c = await ctxFor(VIEWPORTS[0], { init: mm });
    const p = await open(c);
    const isStandalone = await p.evaluate(() => matchMedia("(display-mode: standalone)").matches);
    await fire(p);
    await p.waitForTimeout(300);
    record("pwa", "desktop", "standalone via display-mode media query: no button even after beforeinstallprompt", isStandalone && (await btn(p).count()) === 0);
    await c.close();

    const c2 = await ctxFor(VIEWPORTS[0], { init: () => Object.defineProperty(navigator, "standalone", { get: () => true }) });
    const p2 = await open(c2);
    await fire(p2);
    await p2.waitForTimeout(300);
    record("pwa", "desktop", "standalone via navigator.standalone === true: no button even after beforeinstallprompt", (await btn(p2).count()) === 0);
    await c2.close();

    const c3 = await ctxFor(VIEWPORTS[1], { ua: UA.iphone, touch: true, init: () => Object.defineProperty(navigator, "standalone", { get: () => true }) });
    const p3 = await open(c3);
    record("pwa", "mobile", "iOS home-screen app (navigator.standalone): no button, no guide", (await btn(p3).count()) === 0);
    await c3.close();
  }

  // ---- iOS Safari: manual guide (no native prompt exists)
  for (const scheme of ["light", "dark"]) {
    const c = await ctxFor(VIEWPORTS[1], { scheme, ua: UA.iphone, touch: true });
    const p = await open(c);
    await btn(p).waitFor();
    record("pwa", "mobile", `iOS ${scheme}: button is shown without any install event (data-mode=ios)`, (await btn(p).getAttribute("data-mode")) === "ios");
    await btn(p).click();
    const guide = p.getByTestId("pwa-install-ios-guide");
    await guide.waitFor();
    const txt = (await guide.innerText()).replace(/\s+/g, " ");
    record("pwa", "mobile", `iOS ${scheme}: popover explains Share (⎋) → ‘홈 화면에 추가’, fits the 375px viewport`, /공유/.test(txt) && /⎋/.test(txt) && /홈 화면에 추가/.test(txt) && (await guide.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })), txt);
    await p.waitForTimeout(400); // let the popover enter animation finish
    record("pwa", "mobile", `iOS ${scheme}: the hover tooltip does not overlap the guide on touch devices`, (await p.getByTestId("pwa-install-tip").evaluate((el) => getComputedStyle(el).opacity)) === "0");
    await p.screenshot({ path: `${OUT}/pwa-install-ios-${scheme}-mobile.png` });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(200);
    record("pwa", "mobile", `iOS ${scheme}: Escape closes the popover`, (await guide.count()) === 0);
    record("pwa", "mobile", `iOS ${scheme}: no console/page errors`, p.__errors.length === 0, p.__errors.slice(0, 2).join(" | "));
    await c.close();
  }
  {
    // iPadOS reporting itself as a Mac (desktop-class Safari): detected through MacIntel + touch points
    const c = await ctxFor(VIEWPORTS[0], { ua: UA.mac, init: () => { Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }); Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }); } });
    const p = await open(c);
    record("pwa", "desktop", "iPadOS (Mac UA + touch points): treated as iOS → manual-guide button shown", (await btn(p).count()) === 1 && (await btn(p).getAttribute("data-mode")) === "ios");
    await c.close();
  }
  {
    const c = await newContext(VIEWPORTS[0]);
    const p = await c.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await fire(p);
    await p.waitForTimeout(250);
    record("pwa", "desktop", "signed-out /login has no install button (header lives in the app shell only)", (await btn(p).count()) === 0);
    await c.close();
  }

  // ---- installability: manifest + service worker + icons
  {
    const mfRes = await fetch(`${BASE}/manifest.json`, { redirect: "manual" });
    const mf = await mfRes.json();
    record("pwa", "-", "manifest: id ‘/’, start_url ‘/’, scope ‘/’, display standalone, name + short_name, lang ko", mfRes.status === 200 && mf.id === "/" && mf.start_url === "/" && mf.scope === "/" && mf.display === "standalone" && !!mf.name && !!mf.short_name && mf.lang === "ko", JSON.stringify([mf.id, mf.start_url, mf.display]));
    const has = (size, purpose) => mf.icons?.some((i) => i.sizes === size && i.type === "image/png" && (i.purpose ?? "any").split(" ").includes(purpose));
    record("pwa", "-", "manifest icons: PNG 192 + 512 (purpose any) and a 512 maskable", has("192x192", "any") && has("512x512", "any") && has("512x512", "maskable"));
    const shot = async (src) => { const r = await fetch(`${BASE}${src}`, { redirect: "manual" }); const b = Buffer.from(await r.arrayBuffer()); return { s: r.status, w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
    const sizes = await Promise.all((mf.icons ?? []).map(async (i) => ({ i, r: await shot(i.src) })));
    record("pwa", "-", "every manifest icon is served (200) and its real pixel size matches the declared size", sizes.length >= 3 && sizes.every(({ i, r }) => r.s === 200 && `${r.w}x${r.h}` === i.sizes), sizes.map(({ i, r }) => `${i.src}:${r.s}:${r.w}x${r.h}`).join(" "));
    const home = await (await fetch(`${BASE}/login`)).text();
    record("pwa", "-", "pages link the manifest (<link rel=manifest>) and declare theme-color", /<link rel="manifest" href="\/manifest\.json"/.test(home) && /<meta name="theme-color"/.test(home));
    const startRes = await fetch(`${BASE}${mf.start_url}`, { redirect: "manual" });
    record("pwa", "-", "start_url ‘/’ is inside scope and resolves (signed-out → redirect to /login, never an error page)", startRes.status >= 300 && startRes.status < 400 && /\/login$/.test(startRes.headers.get("location") ?? ""), `${startRes.status} ${startRes.headers.get("location")}`);
    const sw = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
    record("pwa", "-", "service worker /sw.js: served from the root scope as JavaScript (no redirect); installability needs no fetch handler in current Chrome/Edge", sw.status === 200 && /javascript/.test(sw.headers.get("content-type") ?? ""));
    const mfCtx = await newContext(VIEWPORTS[0], storageState);
    const mp = await mfCtx.newPage();
    const r = await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
    record("pwa", "desktop", "signed-in launch at start_url ‘/’ lands on /assets (the app opens straight into the shell)", new URL(mp.url()).pathname === "/assets" && !!r, mp.url());
    await mfCtx.close();
  }
}

// ---------------------------------------------------------------- Smart Kitchen OS: live RLS household isolation (migration 14, real Supabase)
{
  const rand = Math.random().toString(36).slice(2, 10);
  const H1 = myProfile.household_id; // the signed-in E2E household
  const tables = ["kitchen_profiles", "kitchen_items", "kitchen_shopping_items", "kitchen_expenses"];
  let strangerId = null, H2 = null;
  const mine = { items: [], shop: [], exp: [] };
  try {
    // ---- probe: is migration 14 applied?
    const probes = await Promise.all(tables.map((t) => sb.from(t).select("*").limit(1)));
    const missing = tables.filter((_, i) => probes[i].error);
    record("kitchen-rls", "-", "migration 14 applied: all 4 kitchen tables are reachable through the API", missing.length === 0, missing.length ? `missing/blocked: ${missing.join(", ")} (${probes.find((p) => p.error)?.error.message})` : "");
    if (missing.length) throw new Error("kitchen tables missing");

    // ---- a second household (stranger)
    const strangerEmail = `mylife.e2e.kitchen+${rand}@example.com`;
    const strangerPw = `Pw-${rand}-${Date.now()}`;
    const { data: su, error: suErr } = await svc.auth.admin.createUser({ email: strangerEmail, password: strangerPw, email_confirm: true, user_metadata: { display_name: "E2E 키친타가구" } });
    if (suErr) throw new Error(`kitchen stranger createUser failed: ${suErr.message}`);
    strangerId = su.user.id;
    const stranger = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await stranger.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
    await stranger.rpc("create_household", { p_name: "E2E 키친타가구", p_display_name: "E2E 키친타가구" });
    H2 = (await svc.from("profiles").select("household_id").eq("id", strangerId).single()).data.household_id;
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    // ---- household 1 (the signed-in user) writes through RLS
    const N = (s) => `E2E키친${s}${rand}`;
    const i1 = await sb.from("kitchen_items").insert({ household_id: H1, name: N("두부"), expire_date: shift(5) }).select("*").single();
    const s1 = await sb.from("kitchen_shopping_items").insert({ household_id: H1, name: N("계란") }).select("*").single();
    const e1 = await sb.from("kitchen_expenses").insert({ household_id: H1, category: "human_groceries", amount: 12345, memo: N("메모") }).select("*").single();
    if (i1.data) mine.items.push(i1.data.id);
    if (s1.data) mine.shop.push(s1.data.id);
    if (e1.data) mine.exp.push(e1.data.id);
    record("kitchen-rls", "-", "own household: insert + read-back works on items / shopping / expenses", !i1.error && !s1.error && !e1.error && i1.data.household_id === H1, [i1.error, s1.error, e1.error].filter(Boolean).map((e) => e.message).join(" | "));
    record("kitchen-rls", "-", "defaults: item amount '1개' / FRIDGE / added_at = Seoul today / is_pet false; shopping is_done false; expense_date = today", i1.data?.amount === "1개" && i1.data?.storage_type === "FRIDGE" && i1.data?.added_at === today && i1.data?.is_pet === false && s1.data?.is_done === false && s1.data?.is_pet === false && e1.data?.expense_date === today, JSON.stringify({ a: i1.data?.added_at, d: e1.data?.expense_date, today }));

    // ---- household 2 (stranger): own data, and nothing of household 1
    const i2 = await stranger.from("kitchen_items").insert({ household_id: H2, name: N("타가구우유"), expire_date: shift(3), storage_type: "FREEZER" }).select("*").single();
    const s2 = await stranger.from("kitchen_shopping_items").insert({ household_id: H2, name: N("타가구장보기") }).select("*").single();
    const e2 = await stranger.from("kitchen_expenses").insert({ household_id: H2, category: "pet_care", amount: 999 }).select("*").single();
    const p2 = await stranger.from("kitchen_profiles").insert({ household_id: H2 }).select("*").single();
    record("kitchen-rls", "-", "stranger household: can create its own rows incl. its kitchen profile (defaults none / 350000 / 100000 / 0 / 0 / 0)", !i2.error && !s2.error && !e2.error && !p2.error && p2.data.pet_type === "none" && p2.data.human_monthly_budget === 350000 && p2.data.pet_monthly_budget === 100000 && p2.data.rescued_count === 0 && p2.data.discarded_count === 0 && Number(p2.data.saved_money) === 0, [i2.error, s2.error, e2.error, p2.error].filter(Boolean).map((e) => e.message).join(" | "));

    const sSee = await Promise.all([stranger.from("kitchen_items").select("id, household_id"), stranger.from("kitchen_shopping_items").select("id, household_id"), stranger.from("kitchen_expenses").select("id, household_id"), stranger.from("kitchen_profiles").select("household_id")]);
    record("kitchen-rls", "-", "isolation (read): the stranger sees ONLY its own rows in all 4 tables, never household 1's", sSee.every((r) => !r.error && r.data.length === 1 && r.data.every((x) => x.household_id === H2)), JSON.stringify(sSee.map((r) => r.data?.length)));
    const mSee = await Promise.all([sb.from("kitchen_items").select("id").eq("household_id", H2), sb.from("kitchen_shopping_items").select("id").eq("household_id", H2), sb.from("kitchen_expenses").select("id").eq("household_id", H2), sb.from("kitchen_profiles").select("household_id").eq("household_id", H2)]);
    record("kitchen-rls", "-", "isolation (read, reverse): household 1 asking for household 2's rows by id gets nothing", mSee.every((r) => !r.error && r.data.length === 0), JSON.stringify(mSee.map((r) => r.data?.length)));

    // ---- forged writes
    const forged = await Promise.all([
      stranger.from("kitchen_items").insert({ household_id: H1, name: N("위조"), expire_date: shift(1) }),
      stranger.from("kitchen_shopping_items").insert({ household_id: H1, name: N("위조") }),
      stranger.from("kitchen_expenses").insert({ household_id: H1, category: "pet_care", amount: 1 }),
      stranger.from("kitchen_profiles").insert({ household_id: H1 }),
    ]);
    record("kitchen-rls", "-", "isolation (insert): the stranger cannot create rows inside household 1 (RLS 42501) on any of the 4 tables", forged.every((r) => r.error?.code === "42501"), forged.map((r) => r.error?.code ?? "OK").join(","));
    const leaked = await svc.from("kitchen_items").select("id").eq("household_id", H1).like("name", `%위조%${rand}`);
    record("kitchen-rls", "-", "…and nothing was written (service-role check)", (leaked.data ?? []).length === 0);

    const upd = await stranger.from("kitchen_items").update({ name: "hacked" }).eq("id", i1.data.id).select("id");
    const updS = await stranger.from("kitchen_shopping_items").update({ is_done: true }).eq("id", s1.data.id).select("id");
    const updE = await stranger.from("kitchen_expenses").update({ amount: 1 }).eq("id", e1.data.id).select("id");
    const del = await stranger.from("kitchen_items").delete().eq("id", i1.data.id).select("id");
    const delS = await stranger.from("kitchen_shopping_items").delete().eq("id", s1.data.id).select("id");
    const delE = await stranger.from("kitchen_expenses").delete().eq("id", e1.data.id).select("id");
    record("kitchen-rls", "-", "isolation (update/delete): the stranger's UPDATE and DELETE on household 1's rows affect 0 rows", [upd, updS, updE, del, delS, delE].every((r) => !r.error && r.data.length === 0), JSON.stringify([upd, updS, updE, del, delS, delE].map((r) => r.data?.length ?? r.error?.code)));
    const intact = await Promise.all([svc.from("kitchen_items").select("name").eq("id", i1.data.id).single(), svc.from("kitchen_shopping_items").select("is_done").eq("id", s1.data.id).single(), svc.from("kitchen_expenses").select("amount").eq("id", e1.data.id).single()]);
    record("kitchen-rls", "-", "household 1's data is intact after the attack attempts (verified with the service role)", intact[0].data?.name === N("두부") && intact[1].data?.is_done === false && intact[2].data?.amount === 12345, JSON.stringify(intact.map((r) => r.data)));

    const move = await stranger.from("kitchen_items").update({ household_id: H1 }).eq("id", i2.data.id).select("id");
    const move2 = await sb.from("kitchen_items").update({ household_id: H2 }).eq("id", i1.data.id).select("id");
    record("kitchen-rls", "-", "a row cannot be moved to another household by either side (UPDATE WITH CHECK)", !!move.error && !!move2.error && move.error.code === "42501" && move2.error.code === "42501", `${move.error?.code} ${move2.error?.code}`);

    // ---- anonymous
    const an = await Promise.all(tables.map((t) => anon.from(t).select("*").limit(1)));
    const anIns = await anon.from("kitchen_items").insert({ household_id: H1, name: "x", expire_date: shift(1) });
    record("kitchen-rls", "-", "anonymous clients are denied on all 4 tables (read and write)", an.every((r) => !!r.error || (r.data ?? []).length === 0) && an.every((r) => r.error?.code === "42501") && anIns.error?.code === "42501", an.map((r) => r.error?.code ?? "OK").join(",") + ` ins=${anIns.error?.code}`);

    // ---- kitchen_profiles specifics
    const pUp = await stranger.from("kitchen_profiles").update({ pet_type: "dog", rescued_count: 3, discarded_count: 1, saved_money: 45000, human_monthly_budget: 400000 }).eq("household_id", H2).select("*").single();
    record("kitchen-rls", "-", "profile: owner household can update stats and budget", !pUp.error && pUp.data.pet_type === "dog" && pUp.data.rescued_count === 3 && Number(pUp.data.saved_money) === 45000 && pUp.data.human_monthly_budget === 400000, pUp.error?.message);
    const pDel = await stranger.from("kitchen_profiles").delete().eq("household_id", H2).select("household_id");
    const stillThere = await svc.from("kitchen_profiles").select("household_id").eq("household_id", H2);
    record("kitchen-rls", "-", "profile: DELETE is not allowed even for its own household (row survives)", (pDel.error?.code === "42501" || (pDel.data ?? []).length === 0) && (stillThere.data ?? []).length === 1, `${pDel.error?.code ?? "no-error"} rows=${pDel.data?.length}`);
    const pDup = await stranger.from("kitchen_profiles").insert({ household_id: H2 });
    record("kitchen-rls", "-", "profile: only one row per household (primary key)", pDup.error?.code === "23505", pDup.error?.code);
    const pCross = await sb.from("kitchen_profiles").update({ rescued_count: 999 }).eq("household_id", H2).select("household_id");
    const pAfter = await svc.from("kitchen_profiles").select("rescued_count").eq("household_id", H2).single();
    record("kitchen-rls", "-", "profile: another household cannot change this household's stats", !pCross.error && pCross.data.length === 0 && pAfter.data.rescued_count === 3);

    // ---- CHECK constraints through the API
    const code = (r) => r.error?.code ?? "OK";
    const checks = await Promise.all([
      stranger.from("kitchen_profiles").update({ pet_type: "bird" }).eq("household_id", H2),
      stranger.from("kitchen_profiles").update({ human_monthly_budget: -1 }).eq("household_id", H2),
      stranger.from("kitchen_items").insert({ household_id: H2, name: "x", expire_date: shift(1), storage_type: "GARAGE" }),
      stranger.from("kitchen_items").insert({ household_id: H2, name: "   ", expire_date: shift(1) }),
      stranger.from("kitchen_items").insert({ household_id: H2, name: "a".repeat(101), expire_date: shift(1) }),
      stranger.from("kitchen_items").insert({ household_id: H2, name: "x" }),
      stranger.from("kitchen_expenses").insert({ household_id: H2, category: "snacks", amount: 1000 }),
      stranger.from("kitchen_expenses").insert({ household_id: H2, category: "pet_care", amount: -5 }),
      stranger.from("kitchen_shopping_items").insert({ household_id: H2, name: "" }),
    ]);
    record("kitchen-rls", "-", "constraints enforced live: bad pet_type / negative budget / bad storage_type / blank + over-long name / missing expire_date / bad category / negative amount / blank shopping name", checks.every((r) => /^23/.test(code(r))), checks.map(code).join(","));

    // ---- cascade
    const before = (await svc.from("kitchen_items").select("id").eq("household_id", H2)).data.length;
    await svc.from("profiles").delete().eq("household_id", H2);
    await svc.auth.admin.deleteUser(strangerId);
    strangerId = null;
    await svc.from("households").delete().eq("id", H2);
    const after = await Promise.all(tables.map((t) => svc.from(t).select("household_id", { count: "exact", head: true }).eq("household_id", H2)));
    record("kitchen-rls", "-", "deleting a household cascades to all its kitchen rows (4 tables)", before >= 1 && after.every((r) => !r.error && r.count === 0), after.map((r) => r.count).join(","));
    H2 = null;
  } catch (err) {
    if (!/kitchen tables missing/.test(String(err))) record("kitchen-rls", "-", "live kitchen RLS suite ran to completion", false, String(err?.message ?? err));
  } finally {
    if (mine.items.length) await svc.from("kitchen_items").delete().in("id", mine.items);
    if (mine.shop.length) await svc.from("kitchen_shopping_items").delete().in("id", mine.shop);
    if (mine.exp.length) await svc.from("kitchen_expenses").delete().in("id", mine.exp);
    if (H2) {
      for (const t of tables) await svc.from(t).delete().eq("household_id", H2);
      await svc.from("profiles").delete().eq("household_id", H2);
      await svc.from("households").delete().eq("id", H2);
    }
    if (strangerId) await svc.auth.admin.deleteUser(strangerId);
  }
}

// ---------------------------------------------------------------- Smart Kitchen OS: /kitchen dashboard (UI + server actions, real Supabase)
// Runs entirely inside a throw-away second household so the E2E account's own data is never touched.
{
  const rand = Math.random().toString(36).slice(2, 10);
  let strangerId = null, H2 = null;
  const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
  try {
    const strangerEmail = `mylife.e2e.kui+${rand}@example.com`;
    const strangerPw = `Pw-${rand}-${Date.now()}`;
    const { data: su, error: suErr } = await svc.auth.admin.createUser({ email: strangerEmail, password: strangerPw, email_confirm: true, user_metadata: { display_name: "E2E 키친UI" } });
    if (suErr) throw new Error(`kitchen-ui createUser failed: ${suErr.message}`);
    strangerId = su.user.id;
    const cl = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cl.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
    await cl.rpc("create_household", { p_name: "E2E 키친UI", p_display_name: "E2E 키친UI" });
    H2 = (await svc.from("profiles").select("household_id").eq("id", strangerId).single()).data.household_id;

    const probe = await cl.from("kitchen_items").select("id").limit(1);
    if (probe.error) throw new Error("kitchen tables missing");

    // every column explicit: a bulk insert sends NULL for keys that only some rows carry (defaults would not apply)
    const seed = (name, storage_type, expire, extra = {}) => ({ household_id: H2, name, storage_type, expire_date: expire, amount: "1개", spot: null, added_at: today, is_pet: false, memo: null, ...extra });
    const leakName = `E2E누출확인${rand}`;
    const seedRows = [
      seed("지난요거트", "FRIDGE", shift(-2)),
      seed("두부", "FRIDGE", shift(1), { amount: "1모", spot: "선반 앞" }),
      seed("경계2", "FRIDGE", shift(2)),
      seed("경계3", "FRIDGE", shift(3)),
      seed("우유", "FRIDGE", shift(6)),
      seed("경계7", "FRIDGE", shift(7)),
      seed("경계8", "FRIDGE", shift(8)),
      seed("계란", "FRIDGE", shift(20)),
      seed("냉동삼겹살", "FREEZER", shift(60), { added_at: shift(-35) }),
      seed("냉동만두", "FREEZER", shift(60), { added_at: shift(-5) }),
      seed("라면", "ROOM_TEMP", shift(100)),
      seed("양파", "ROOM_TEMP", shift(20), { memo: "망 하나" }),
      seed(leakName, "FRIDGE", shift(15)),
    ];
    const ins = await svc.from("kitchen_items").insert(seedRows);
    if (ins.error) throw new Error(`kitchen-ui seed failed: ${ins.error.message}`);
    const rows = async () => (await svc.from("kitchen_items").select("*").eq("household_id", H2)).data ?? [];
    const prof = async () => (await svc.from("kitchen_profiles").select("*").eq("household_id", H2).maybeSingle()).data;
    const rowOf = async (name) => (await rows()).find((r) => r.name === name);

    // ---- sign in once, reuse the session
    let state;
    {
      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.fill('input[name="email"]', strangerEmail);
      await p.fill('input[name="password"]', strangerPw);
      await p.click('button[type="submit"]');
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      state = await c.storageState();
      await c.close();
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: "light" });
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch {} });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(`console: ${m.text()}`));
    const open = async () => {
      await p.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await p.getByTestId("kitchen-pulse").waitFor();
    };
    const card = (n) => p.locator(`[data-testid="kitchen-card"][data-name="${n}"]`);
    const pulse = async (id) => (await p.locator(`[data-pulse="${id}"] [data-testid="pulse-value"]`).innerText()).trim();
    const sub = async (id) => (await p.locator(`[data-pulse="${id}"]`).innerText()).replace(/\s+/g, " ");

    await open();
    record("kitchen-ui", "desktop", "page renders: title 키친, KPI tiles, storage tabs, 13 seeded cards", (await p.getByRole("heading", { name: "키친", level: 1 }).count()) === 1 && (await p.getByTestId("pulse-card").count()) === 4 && (await p.getByTestId("storage-tabs").count()) === 1 && (await p.getByTestId("kitchen-card").count()) === 13);
    const nav = p.locator('header nav[aria-label="주요 메뉴"]');
    const cur = await nav.locator('a[aria-current="page"]').allInnerTexts();
    record("kitchen-ui", "desktop", "nav: [키친] tab is present and marked aria-current on /kitchen", (await nav.locator("a").allInnerTexts()).some((t) => t.includes("키친")) && cur.length === 1 && cur[0].includes("키친"), cur.join("|"));

    // ---- Pulse numbers
    record("kitchen-ui", "desktop", "pulse: 13개 in the kitchen · 4개 expiring (D-3 or sooner, expired included) with 기한 지남 1건 · 1개 fossil · 0원 saved", (await pulse("total")) === "13개" && (await pulse("urgent")) === "4개" && /기한 지남 1건/.test(await sub("urgent")) && (await pulse("fossil")) === "1개" && (await pulse("saved")) === "0원", [await pulse("total"), await pulse("urgent"), await pulse("fossil"), await pulse("saved")].join(" "));

    // ---- D-Day traffic light (boundaries 2 / 3 / 7 / 8 + expired)
    const light = async (n) => card(n).getAttribute("data-light");
    const got = { 지난요거트: await light("지난요거트"), 두부: await light("두부"), 경계2: await light("경계2"), 경계3: await light("경계3"), 우유: await light("우유"), 경계7: await light("경계7"), 경계8: await light("경계8"), 계란: await light("계란") };
    record("kitchen-ui", "desktop", "D-Day badge colours: past=alert, D-1/D-2=red(rose), D-3/D-6/D-7=yellow(amber), D-8/D-20=green(emerald)", got.지난요거트 === "alert" && got.두부 === "red" && got.경계2 === "red" && got.경계3 === "yellow" && got.우유 === "yellow" && got.경계7 === "yellow" && got.경계8 === "green" && got.계란 === "green", JSON.stringify(got));
    const label = async (n) => (await card(n).getByTestId("dday-badge").innerText()).trim();
    record("kitchen-ui", "desktop", "badge text: ‘D+2 지남’ for the past date, ‘D-1’, ‘D-7’ and ‘D-20’ otherwise", (await label("지난요거트")) === "D+2 지남" && (await label("두부")) === "D-1" && (await label("경계7")) === "D-7" && (await label("계란")) === "D-20", [await label("지난요거트"), await label("두부"), await label("경계7"), await label("계란")].join(" "));
    const bg = async (n) => card(n).getByTestId("dday-badge").evaluate((el) => getComputedStyle(el).backgroundColor);
    const [bAlert, bRed, bYellow, bGreen] = [await bg("지난요거트"), await bg("경계2"), await bg("경계3"), await bg("경계8")];
    record("kitchen-ui", "desktop", "badge fills: alert = solid rose-600, red = rose-50 tint, yellow = amber-50 tint, green = emerald-50 tint", bAlert === "rgb(225, 29, 72)" && bRed === "rgb(255, 241, 242)" && bYellow === "rgb(255, 251, 235)" && bGreen === "rgb(236, 253, 245)", JSON.stringify({ bAlert, bRed, bYellow, bGreen }));
    const order = await p.getByTestId("kitchen-card-name").allInnerTexts();
    record("kitchen-ui", "desktop", "cards are ordered soonest-expiry first (past date on top)", order[0] === "지난요거트" && order[1] === "두부", order.slice(0, 4).join(","));
    record("kitchen-ui", "desktop", "card shows name, amount and the spot memo", (await card("두부").getByTestId("kitchen-card-amount").innerText()) === "1모" && (await card("두부").getByTestId("kitchen-card-spot").innerText()).includes("선반 앞"));

    // ---- fossil badge + defrost guide
    record("kitchen-ui", "desktop", "fossil badge ‘30일+ 냉동’ only on the item frozen ≥30 days (35d yes, 5d no, fridge no)", (await p.getByTestId("fossil-badge").count()) === 1 && (await card("냉동삼겹살").getByTestId("fossil-badge").count()) === 1 && (await card("냉동만두").getByTestId("fossil-badge").count()) === 0 && (await card("두부").getByTestId("fossil-badge").count()) === 0);
    await card("냉동삼겹살").getByTestId("fossil-badge").click();
    const dd = p.getByTestId("defrost-dialog");
    await dd.waitFor();
    record("kitchen-ui", "desktop", "fossil click → microwave guide for meat (200W thaw mode 3~4 min + odor tip)", (await dd.getByTestId("defrost-group").innerText()) === "육류/가금류" && /전자레인지 200W/.test(await dd.getByTestId("defrost-method").innerText()) && /청주/.test(await dd.getByTestId("defrost-odor").innerText()), (await dd.innerText()).replace(/\s+/g, " ").slice(0, 120));
    await p.keyboard.press("Escape");
    await dd.waitFor({ state: "detached" });

    // ---- storage tabs
    const tabCount = async (k) => Number((await p.locator(`[data-testid="storage-tab"][data-tab="${k}"] span`).innerText()).trim());
    record("kitchen-ui", "desktop", "storage tabs show counts: 전체 13 · 냉장 9 · 냉동 2 · 실온 2", (await tabCount("ALL")) === 13 && (await tabCount("FRIDGE")) === 9 && (await tabCount("FREEZER")) === 2 && (await tabCount("ROOM_TEMP")) === 2);
    await p.locator('[data-testid="storage-tab"][data-tab="FREEZER"]').click();
    record("kitchen-ui", "desktop", "냉동 tab filters the list to the 2 frozen items (aria-checked)", (await p.getByTestId("kitchen-card").count()) === 2 && (await p.locator('[data-tab="FREEZER"]').getAttribute("aria-checked")) === "true" && (await p.locator('[data-tab="ALL"]').getAttribute("aria-checked")) === "false");
    await p.locator('[data-testid="storage-tab"][data-tab="ROOM_TEMP"]').click();
    record("kitchen-ui", "desktop", "실온 tab → 라면 + 양파 only", (await p.getByTestId("kitchen-card").count()) === 2 && (await card("라면").count()) === 1);
    await p.locator('[data-testid="storage-tab"][data-tab="ALL"]').click();

    // ---- pet household: banner appears only with a pet AND a toxic item
    record("kitchen-ui", "desktop", "no pet set → NO toxic banner and no per-card warning even though 양파 is in the kitchen", (await p.getByTestId("pet-toxic-banner").count()) === 0 && (await card("양파").locator('[data-kind="toxic"]').count()) === 0);
    await p.locator('[data-testid="pet-setting"] [data-pet="dog"]').click();
    await p.getByTestId("pet-toxic-banner").waitFor();
    const banner = p.getByTestId("pet-toxic-banner");
    record("kitchen-ui", "desktop", "dog set → rose alert banner (role=alert) names the toxic item 양파", (await banner.getAttribute("role")) === "alert" && /양파/.test(await p.getByTestId("pet-toxic-names").innerText()) && /강아지/.test(await banner.innerText()), (await banner.innerText()).replace(/\s+/g, " "));
    record("kitchen-ui", "desktop", "pet household: toxic card gets the ‘반려동물 위험’ badge; safe items do not", (await card("양파").locator('[data-kind="toxic"]').count()) === 1 && (await card("두부").locator('[data-kind="toxic"]').count()) === 0);
    const bb = await banner.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, bd: getComputedStyle(el).borderTopColor, c: getComputedStyle(el).color }));
    record("kitchen-ui", "desktop", "banner is high-contrast rose (light tint background, dark rose text ≥ 7:1)", /^rgb\(25[0-9], 2[0-4][0-9], 2[0-4][0-9]\)/.test(bb.bg) && lum(bb.bg) / 1 > 0.85 && (lum(bb.bg) + 0.05) / (lum(bb.c) + 0.05) >= 7, JSON.stringify(bb));
    await p.screenshot({ path: `${OUT}/kitchen-pet-banner-light-desktop.png`, fullPage: true });
    record("kitchen-ui", "desktop", "pet type is persisted on the household profile", (await prof())?.pet_type === "dog");
    await p.getByTestId("pet-emergency-open").click();
    const em = p.getByTestId("pet-emergency-dialog");
    await em.waitFor();
    const vet = await em.getByTestId("vet-search-link").getAttribute("href");
    record("kitchen-ui", "desktop", "banner → 24시 emergency dialog: numbered steps, household's toxic foods, 24시 동물병원 search link (new tab, noopener), medical disclaimer", /24시 응급 대처법/.test(await em.innerText()) && /양파/.test(await em.innerText()) && vet === `https://map.naver.com/p/search/${encodeURIComponent("24시 동물병원")}` && (await em.getByTestId("vet-search-link").getAttribute("target")) === "_blank" && /noopener/.test((await em.getByTestId("vet-search-link").getAttribute("rel")) ?? "") && /수의학적 진단/.test(await em.innerText()), vet);
    await p.screenshot({ path: `${OUT}/kitchen-emergency-light-desktop.png` });
    await p.keyboard.press("Escape");
    await em.waitFor({ state: "detached" });
    await p.locator('[data-testid="pet-setting"] [data-pet="none"]').click();
    await p.getByTestId("pet-toxic-banner").waitFor({ state: "detached" });
    record("kitchen-ui", "desktop", "pet set back to 없음 → banner disappears again", (await prof())?.pet_type === "none");

    // ---- add dialog: dictionary suggestion
    await p.getByTestId("add-item").click();
    const fd = p.getByRole("dialog");
    await fd.getByLabel("재료 이름").fill("계란");
    const sg = fd.getByTestId("shelf-suggestion");
    await sg.waitFor();
    const exp21 = await fd.getByLabel("소비기한").inputValue();
    record("kitchen-ui", "desktop", "typing 계란 suggests 냉장 21일 and pre-fills the expiry (today + 21)", /냉장 21일/.test(await sg.innerText()) && (await sg.getAttribute("data-source")) === "dictionary" && exp21 === shift(21) && (await fd.locator('[data-testid="form-storage"][data-storage="FRIDGE"]').getAttribute("aria-checked")) === "true", `${exp21} ${await sg.innerText()}`);
    await fd.getByLabel("재료 이름").fill("냉동 삼겹살");
    await p.waitForTimeout(150);
    record("kitchen-ui", "desktop", "typing ‘냉동 삼겹살’ switches the storage to 냉동 with 90 days", (await fd.locator('[data-testid="form-storage"][data-storage="FREEZER"]').getAttribute("aria-checked")) === "true" && (await fd.getByLabel("소비기한").inputValue()) === shift(90) && /냉동 90일/.test(await sg.innerText()), await sg.innerText());
    await fd.getByLabel("재료 이름").fill("초코파이");
    await p.waitForTimeout(150);
    record("kitchen-ui", "desktop", "unknown ingredient → default suggestion (냉장 5일, source=default)", (await sg.getAttribute("data-source")) === "default" && /냉장 5일/.test(await sg.innerText()) && (await fd.getByLabel("소비기한").inputValue()) === shift(5));
    await fd.getByLabel("재료 이름").fill("");
    await fd.getByRole("button", { name: "재료 추가" }).click();
    await fd.getByRole("alert").waitFor();
    record("kitchen-ui", "desktop", "empty name → clear validation message, nothing created", /재료 이름/.test(await fd.getByRole("alert").innerText()) && (await rows()).length === 13);

    // create 계란 with the suggested date
    await fd.getByLabel("재료 이름").fill("당근");
    await fd.getByLabel("수량").fill("3개");
    await fd.getByLabel("위치 메모").fill("야채칸");
    await fd.getByRole("button", { name: "재료 추가" }).click();
    await fd.waitFor({ state: "detached" });
    const carrot = await until(async () => rowOf("당근"));
    record("kitchen-ui", "desktop", "create (suggested date): 당근 → FRIDGE, today + 14 (dictionary), amount 3개, spot 야채칸, added_at today", !!carrot && carrot.storage_type === "FRIDGE" && carrot.expire_date === shift(14) && carrot.amount === "3개" && carrot.spot === "야채칸" && carrot.added_at === today && carrot.is_pet === false, JSON.stringify(carrot));
    await card("당근").waitFor();
    record("kitchen-ui", "desktop", "the new card appears in the list without a manual reload and the totals update (14개)", (await card("당근").getByTestId("dday-badge").innerText()).trim() === "D-14" && (await pulse("total")) === "14개");

    // create with a manual date + pet item
    await p.getByTestId("add-item").click();
    const fd2 = p.getByRole("dialog");
    await fd2.getByLabel("재료 이름").fill("강아지간식");
    await fd2.getByLabel("소비기한").fill(shift(40));
    await fd2.getByLabel("반려동물 전용").check();
    await fd2.getByRole("button", { name: "재료 추가" }).click();
    await fd2.waitFor({ state: "detached" });
    const treat = await until(async () => rowOf("강아지간식"));
    record("kitchen-ui", "desktop", "create (manual date + pet-only): the typed date wins over the suggestion, is_pet=true, default amount ‘1개’", !!treat && treat.expire_date === shift(40) && treat.is_pet === true && treat.amount === "1개", JSON.stringify(treat));
    await card("강아지간식").waitFor();
    record("kitchen-ui", "desktop", "pet-only item shows the neutral ‘펫 전용’ badge", (await card("강아지간식").locator('[data-kind="pet"]').count()) === 1);

    // ---- edit
    await card("계란").getByTestId("edit-btn").click();
    const ed = p.getByRole("dialog");
    await ed.getByLabel("수량").fill("30구");
    await ed.getByLabel("위치 메모").fill("문 쪽");
    await ed.getByLabel("소비기한").fill(shift(25));
    await ed.getByRole("button", { name: "저장" }).click();
    await ed.waitFor({ state: "detached" });
    const egg = await until(async () => { const r = await rowOf("계란"); return r?.amount === "30구" ? r : null; });
    record("kitchen-ui", "desktop", "edit: amount, spot and expiry saved; storage untouched", !!egg && egg.spot === "문 쪽" && egg.expire_date === shift(25) && egg.storage_type === "FRIDGE", JSON.stringify(egg));
    await p.waitForFunction(() => document.querySelector('[data-name="계란"] [data-testid="dday-badge"]')?.textContent?.trim() === "D-25");
    record("kitchen-ui", "desktop", "edited card re-renders with the new badge (D-25)", (await card("계란").getByTestId("kitchen-card-amount").innerText()) === "30구");

    // ---- move storage
    await card("두부").getByTestId("move-btn").click();
    record("kitchen-ui", "desktop", "move menu offers only the OTHER two places", (await p.getByTestId("move-option").count()) === 2 && (await p.locator('[data-testid="move-option"][data-to="FRIDGE"]').count()) === 0);
    await p.locator('[data-testid="move-option"][data-to="FREEZER"]').click();
    const tofu = await until(async () => { const r = await rowOf("두부"); return r?.storage_type === "FREEZER" ? r : null; });
    record("kitchen-ui", "desktop", "fridge → freezer: storage changed, expiry extended to today + 30 (no freezer entry → default), added_at = today", !!tofu && tofu.expire_date === shift(30) && tofu.added_at === today, JSON.stringify(tofu));
    await p.waitForFunction(() => document.querySelector('[data-name="두부"]')?.getAttribute("data-storage") === "FREEZER");
    await p.locator('[data-testid="storage-tab"][data-tab="FREEZER"]').click();
    record("kitchen-ui", "desktop", "the moved card now lives under the 냉동 tab", (await card("두부").count()) === 1 && (await card("두부").getByTestId("fossil-badge").count()) === 0);
    await p.locator('[data-testid="storage-tab"][data-tab="ALL"]').click();
    await card("지난요거트").getByTestId("move-btn").click();
    await p.locator('[data-testid="move-option"][data-to="FREEZER"]').click();
    const yog = await until(async () => { const r = await rowOf("지난요거트"); return r?.storage_type === "FREEZER" ? r : null; });
    record("kitchen-ui", "desktop", "an already-expired item is NOT rescued by freezing: its past expiry date is kept", !!yog && yog.expire_date === shift(-2), JSON.stringify(yog));
    await card("냉동삼겹살").getByTestId("move-btn").click();
    await p.locator('[data-testid="move-option"][data-to="FRIDGE"]').click();
    const pork = await until(async () => { const r = await rowOf("냉동삼겹살"); return r?.storage_type === "FRIDGE" ? r : null; });
    record("kitchen-ui", "desktop", "thawing (freezer → fridge) never extends the life: expiry is the earlier of the old date and today + 3 (dictionary: 삼겹살 fridge 3 days); the fossil badge disappears", !!pork && pork.expire_date === shift(3) && pork.added_at === today, JSON.stringify(pork));
    await p.waitForFunction(() => !document.querySelector('[data-name="냉동삼겹살"] [data-testid="fossil-badge"]'));
    record("kitchen-ui", "desktop", "pulse recounts fossils after the move (0개)", (await pulse("fossil")) === "0개");

    // ---- consume → rescued_count + 1, saved_money + 3000, item deleted
    const beforeRows = (await rows()).length;
    await card("경계8").getByTestId("consume-btn").click();
    const p1 = await until(async () => { const r = await prof(); return r && r.rescued_count === 1 ? r : null; });
    record("kitchen-ui", "desktop", "consume: profile row created with rescued_count 1 and saved_money 3000, item deleted", !!p1 && Number(p1.saved_money) === 3000 && !(await rowOf("경계8")) && (await rows()).length === beforeRows - 1, JSON.stringify(p1));
    await p.getByTestId("kitchen-notice").waitFor();
    await p.waitForFunction(() => document.querySelector('[data-pulse="saved"] [data-testid="pulse-value"]')?.textContent?.trim() === "3,000원"); // the list refresh follows the action result
    record("kitchen-ui", "desktop", "success notice mentions the 3,000원 saved; the pulse tile shows 3,000원 and ‘구출 1번’", /3,000원/.test(await p.getByTestId("kitchen-notice").innerText()) && (await pulse("saved")) === "3,000원" && /구출 1번/.test(await sub("saved")), await pulse("saved"));
    await card("경계7").getByTestId("consume-btn").click();
    const p2 = await until(async () => { const r = await prof(); return r && r.rescued_count === 2 ? r : null; });
    record("kitchen-ui", "desktop", "consume again accumulates (2 rescued, 6,000원 saved)", !!p2 && Number(p2.saved_money) === 6000 && p2.discarded_count === 0, JSON.stringify(p2));
    await p.waitForFunction(() => document.querySelector('[data-pulse="saved"] [data-testid="pulse-value"]')?.textContent?.trim() === "6,000원");

    // ---- plain delete: two-step, no stats change
    await card("라면").getByTestId("delete-btn").click();
    await card("라면").getByTestId("delete-confirm").waitFor();
    await card("라면").getByRole("button", { name: "취소" }).click();
    record("kitchen-ui", "desktop", "delete asks for confirmation first; cancel keeps the item", (await card("라면").count()) === 1 && !!(await rowOf("라면")));
    await card("라면").getByTestId("delete-btn").click();
    await card("라면").getByTestId("delete-confirm").click();
    await card("라면").waitFor({ state: "detached" });
    const p3 = await prof();
    record("kitchen-ui", "desktop", "confirmed delete removes the row WITHOUT touching rescued_count / saved_money", !(await rowOf("라면")) && p3.rescued_count === 2 && Number(p3.saved_money) === 6000);

    // ---- cross-household isolation as seen by the E2E account
    {
      const c = await newContext(VIEWPORTS[0], storageState);
      const mp = await c.newPage();
      await mp.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      const html = await mp.content();
      record("kitchen-ui", "desktop", "another household (the E2E account) never sees this kitchen's items", !html.includes(leakName) && !html.includes("지난요거트") && !html.includes("강아지간식"));
      await c.close();
    }
    // ---- signed-out access
    {
      const c = await newContext(VIEWPORTS[0]);
      const ap = await c.newPage();
      await ap.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      record("kitchen-ui", "desktop", "signed-out visit to /kitchen redirects to /login", new URL(ap.url()).pathname.startsWith("/login") && (await ap.getByTestId("kitchen-pulse").count()) === 0, ap.url());
      await c.close();
    }

    record("kitchen-ui", "desktop", "no console/page errors across the whole flow", errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();

    // ---- light/dark × desktop/mobile captures (pet household so the banner is part of the picture)
    await svc.from("kitchen_profiles").update({ pet_type: "cat" }).eq("household_id", H2);
    for (const scheme of ["light", "dark"]) {
      for (const vp of VIEWPORTS) {
        const c2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
        await c2.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
        const q = await c2.newPage();
        const e2 = [];
        q.on("pageerror", (e) => e2.push(e.message));
        await q.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
        await q.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        await q.getByTestId("kitchen-pulse").waitFor();
        await q.waitForTimeout(400);
        await q.screenshot({ path: `${OUT}/kitchen-${scheme}-${vp.name}.png`, fullPage: true });
        const tag = `${scheme}/${vp.name}`;
        record("kitchen-ui", vp.name, `${tag}: no horizontal scroll and every card fits its column`, await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await q.getByTestId("kitchen-card").evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1))));
        const cbg = await q.getByTestId("kitchen-card").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        record("kitchen-ui", vp.name, `${tag}: theme applied (html.dark=${scheme === "dark"}), cards follow it`, (await q.evaluate(() => document.documentElement.classList.contains("dark"))) === (scheme === "dark") && (scheme === "dark" ? lum(cbg) < 0.1 : lum(cbg) > 0.8), cbg);
        const bn = await q.getByTestId("pet-toxic-banner").evaluate((el) => getComputedStyle(el).backgroundColor);
        record("kitchen-ui", vp.name, `${tag}: pet banner is visible and themed (cat household, 양파 present)`, (await q.getByTestId("pet-toxic-banner").isVisible()) && (scheme === "dark" ? lum(bn) < 0.2 : lum(bn) > 0.85), bn);
        if (vp.name === "mobile") {
          const bottom = q.locator('nav[aria-label="주요 메뉴"]').last();
          record("kitchen-ui", vp.name, `${tag}: 4-tab bottom bar with 키친 active`, (await bottom.locator("a").count()) === 4 && (await bottom.locator('a[aria-current="page"]').innerText()).includes("키친"));
          const cols = await q.getByTestId("kitchen-list").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
          record("kitchen-ui", vp.name, `${tag}: one-column card grid at 375px, 2×2 KPI tiles`, cols === 1 && (await q.getByTestId("kitchen-pulse").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)) === 2);
        } else {
          record("kitchen-ui", vp.name, `${tag}: 3-column card grid and 4-up KPI tiles on desktop`, (await q.getByTestId("kitchen-list").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)) === 3 && (await q.getByTestId("kitchen-pulse").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)) === 4);
        }
        record("kitchen-ui", vp.name, `${tag}: no page errors`, e2.length === 0, e2.slice(0, 2).join(" | "));
        await c2.close();
      }
    }

    // ---- zero state
    await svc.from("kitchen_items").delete().eq("household_id", H2);
    {
      const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul" });
      const q = await c3.newPage();
      await q.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      await q.getByTestId("kitchen-pulse").waitFor();
      const pv = async (id) => (await q.locator(`[data-pulse="${id}"] [data-testid="pulse-value"]`).innerText()).trim();
      record("kitchen-ui", "desktop", "zero state: friendly empty state, 0개 tiles, banner gone, the saved total survives (6,000원)", (await q.getByTestId("kitchen-empty").count()) === 1 && (await pv("total")) === "0개" && (await pv("urgent")) === "0개" && (await pv("fossil")) === "0개" && (await pv("saved")) === "6,000원" && (await q.getByTestId("pet-toxic-banner").count()) === 0);
      await q.screenshot({ path: `${OUT}/kitchen-empty-desktop.png`, fullPage: true });
      await c3.close();
    }
  } catch (err) {
    if (!/kitchen tables missing/.test(String(err))) record("kitchen-ui", "-", "kitchen UI suite ran to completion", false, String(err?.stack ?? err).slice(0, 400));
    else record("kitchen-ui", "-", "kitchen tables available (migration 14)", false, "tables missing");
  } finally {
    if (H2) {
      for (const t of ["kitchen_items", "kitchen_shopping_items", "kitchen_expenses", "kitchen_profiles"]) await svc.from(t).delete().eq("household_id", H2);
      await svc.from("profiles").delete().eq("household_id", H2);
      await svc.from("households").delete().eq("id", H2);
    }
    if (strangerId) await svc.auth.admin.deleteUser(strangerId);
  }
}

// ---------------------------------------------------------------- Smart Kitchen OS Phase 3: zero-typing intake (photo) + 말로 정리 — UI, Server Actions, mock Gemini
// A local mock of the Gemini REST API (port 4010) stands in for Google. The dev server must run with
//   GEMINI_API_KEY=<20+ chars>  GEMINI_API_BASE_URL=http://127.0.0.1:4010      (npm run dev:e2e)
// otherwise the AI-dependent checks are reported as SKIPPED and the "AI not available" branch is verified instead.
// Everything runs in a throw-away household; one extra row is created in the E2E household to prove cross-household writes fail.
{
  const rand = Math.random().toString(36).slice(2, 10);
  const http = await import("node:http");
  const sharp = (await import("sharp")).default;
  const MOCK_PORT = 4010;
  const mock = { hits: [], vision: "receipt" };
  const ai = (payload) => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  const visionPayloads = {
    receipt: { total_price: 33000, items: [
      { name: "숙주", amount: "1봉", category: "냉장", is_pet: false },
      { name: "고등어", amount: "2마리", category: "냉장", is_pet: false },
      { name: "냉동만두", amount: "1봉", category: "냉동", is_pet: false },
      { name: "강아지 간식", amount: "2개", category: "실온", is_pet: true },
    ] },
    nototal: { total_price: 0, items: [{ name: "당근", amount: "3개", category: "냉장", is_pet: false }] },
    pet: { total_price: 15000, items: [{ name: "강아지 사료", amount: "1포", category: "실온", is_pet: true }] },
    empty: { total_price: 0, items: [] },
  };
  const S1_ROWS = [
    { name: "대파", action: "consume", amount: "1대", target_location: "", category: "" },
    { name: "삼겹살", action: "move", amount: "", target_location: "냉동", category: "" },
    { name: "치킨", action: "expense", amount: "22000", target_location: "", category: "human_delivery" },
  ];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      const parts = body.contents?.[0]?.parts ?? [];
      const text = parts.find((p) => p.text)?.text ?? "";
      const image = parts.find((p) => p.inlineData)?.inlineData;
      mock.hits.push({ url: req.url, key: req.headers["x-goog-api-key"], image: image?.data ?? null, text });
      const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(payload); };
      if (image) {
        if (mock.vision === "fail429") return send(429, "{}");
        if (mock.vision === "garbage") return send(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "this is not json" }] } }] }));
        return send(200, ai(visionPayloads[mock.vision] ?? visionPayloads.empty));
      }
      const sentence = (() => { try { return JSON.parse(text.split("사용자 문장(데이터): ")[1] ?? '""'); } catch { return ""; } })();
      if (sentence.includes("AI장애")) return send(503, "{}");
      if (sentence.startsWith("대파 1대 쓰고")) return send(200, ai(S1_ROWS));
      return send(200, ai([]));
    });
  });
  await new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", resolve));

  let strangerId = null, H2 = null;
  const mainRowIds = [];
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
  try {
    const email = `mylife.e2e.kzt+${rand}@example.com`;
    const pw = `Pw-${rand}-${Date.now()}`;
    const { data: su, error: suErr } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: "E2E 키친ZT" } });
    if (suErr) throw new Error(`kitchen-zt createUser failed: ${suErr.message}`);
    strangerId = su.user.id;
    const cl = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cl.auth.signInWithPassword({ email, password: pw });
    await cl.rpc("create_household", { p_name: "E2E 키친ZT", p_display_name: "E2E 키친ZT" });
    H2 = (await svc.from("profiles").select("household_id").eq("id", strangerId).single()).data.household_id;
    if ((await cl.from("kitchen_items").select("id").limit(1)).error) throw new Error("kitchen tables missing");

    const seed = (name, storage_type, expire, amount = "1개") => ({ household_id: H2, name, storage_type, expire_date: expire, amount, spot: null, added_at: today, is_pet: false, memo: null });
    await svc.from("kitchen_items").insert([seed("대파", "FRIDGE", shift(10), "4대"), seed("삼겹살", "FRIDGE", shift(2), "600g"), seed("우유", "FRIDGE", shift(6), "1l"), seed("두부", "FRIDGE", shift(8), "1모")]);
    const rows = async () => (await svc.from("kitchen_items").select("*").eq("household_id", H2)).data ?? [];
    const rowOf = async (n) => (await rows()).find((r) => r.name === n);
    const expenses = async () => (await svc.from("kitchen_expenses").select("*").eq("household_id", H2)).data ?? [];
    const prof = async () => (await svc.from("kitchen_profiles").select("*").eq("household_id", H2).maybeSingle()).data;

    let state;
    {
      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', pw);
      await p.click('button[type="submit"]');
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      state = await c.storageState();
      await c.close();
    }
    const mk = async (vp, { scheme = "light", init } = {}) => {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
      await c.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
      if (init) await c.addInitScript(init);
      const p = await c.newPage();
      p.__errors = [];
      p.on("pageerror", (e) => p.__errors.push(`pageerror: ${e.message}`));
      p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && p.__errors.push(`console: ${m.text()}`));
      await p.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await p.getByTestId("kitchen-pulse").waitFor();
      return { c, p };
    };
    // a big noisy photo (several MB) generated by the browser itself
    const bigPhoto = async (p) => {
      const b64 = await p.evaluate(() => {
        const cv = document.createElement("canvas");
        cv.width = 3200; cv.height = 2400;
        const g = cv.getContext("2d");
        const img = g.createImageData(cv.width, cv.height);
        for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
        g.putImageData(img, 0, 0);
        return cv.toDataURL("image/jpeg", 0.95).split(",")[1];
      });
      return Buffer.from(b64, "base64");
    };

    const { c, p } = await mk(VIEWPORTS[0]);
    record("kitchen-zt", "desktop", "page shows the [찰칵 입고] button and the one-line 말로 정리 bar (input + submit)", (await p.getByTestId("snap-open").count()) === 1 && (await p.getByTestId("checkout-input").count()) === 1 && (await p.getByTestId("checkout-submit").count()) === 1 && (await p.getByTestId("checkout-submit").isDisabled()));

    // ================================================================ 찰칵 입고
    await p.getByTestId("snap-open").click();
    const sd = p.getByTestId("snap-dialog");
    await sd.waitFor();
    record("kitchen-zt", "desktop", "snap dialog: camera input has capture=environment, gallery input has none; both accept images", (await sd.getByTestId("snap-camera-input").getAttribute("capture")) === "environment" && (await sd.getByTestId("snap-camera-input").getAttribute("accept")) === "image/*" && (await sd.getByTestId("snap-gallery-input").getAttribute("capture")) === null && (await sd.getByTestId("snap-gallery-input").getAttribute("accept")) === "image/*");
    record("kitchen-zt", "desktop", "privacy note: the photo goes only to Google Gemini and is not stored", /Gemini/.test(await sd.innerText()) && /저장되지 않아요/.test(await sd.innerText()));

    // non-image file is rejected before anything is sent
    const hitsBefore = mock.hits.length;
    await sd.getByTestId("snap-gallery-input").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await sd.getByRole("alert").waitFor();
    record("kitchen-zt", "desktop", "a non-image file is refused with a clear message and nothing is sent to the AI", /사진 파일만/.test(await sd.getByRole("alert").innerText()) && mock.hits.length === hitsBefore);

    const photo = await bigPhoto(p);
    record("kitchen-zt", "desktop", "test photo is genuinely large (≥ 2 MB, 3200×2400) so the compression check below means something", photo.length > 2_000_000, `${(photo.length / 1e6).toFixed(1)} MB`);
    mock.vision = "receipt";
    await sd.getByTestId("snap-camera-input").setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: photo });
    await sd.locator('[data-testid="snap-list"], [data-testid="snap-unavailable"]').first().waitFor({ timeout: 30_000 });
    const mocked = mock.hits.length > hitsBefore;

    if (!mocked) {
      // dev server is not wired to the mock: verify the friendly "not available" branch (no key configured) instead
      const un = sd.getByTestId("snap-unavailable");
      record("kitchen-zt", "desktop", "no AI key (or not mocked): friendly guidance, no fake sample data, manual routes suggested", (await un.count()) === 1 && /GEMINI_API_KEY|AI/.test(await un.innerText()) && (await sd.getByTestId("snap-row").count()) === 0 && /직접 넣거나/.test(await un.innerText()), (await un.innerText()).replace(/\s+/g, " ").slice(0, 160));
      for (const n of ["snap compression", "snap review rows", "snap batch intake + receipt total", "snap pet-only receipt", "snap AI failure notes", "checkout AI path", "checkout rules fallback", "checkout execute", "checkout cross-household write"]) record("kitchen-zt", "-", `SKIPPED (dev server not started with the mock Gemini env — use npm run dev:e2e): ${n}`, true);
    } else {
      // ---- compression: what Google would have received
      const hit = mock.hits[mock.hits.length - 1];
      const sent = Buffer.from(hit.image, "base64");
      const meta = await sharp(sent).metadata();
      record("kitchen-zt", "desktop", "client compression: a multi-MB photo reaches the AI as a JPEG with long side 1024px and under 600 KB", meta.format === "jpeg" && Math.max(meta.width, meta.height) === 1024 && meta.width === 1024 && meta.height === 768 && sent.length < 600_000 && sent.length < photo.length / 5, `${meta.format} ${meta.width}x${meta.height} ${(sent.length / 1024).toFixed(0)} KB (from ${(photo.length / 1e6).toFixed(1)} MB)`);
      record("kitchen-zt", "desktop", "the API key travels in the x-goog-api-key header only (never in the URL), the request goes to the configured base", typeof hit.key === "string" && hit.key.length >= 20 && !hit.url.includes(hit.key) && /\/v1beta\/models\/[^/]+:generateContent$/.test(hit.url));

      // ---- review step
      const list = sd.getByTestId("snap-list");
      record("kitchen-zt", "desktop", "review: one row per detected item (4), all checked, with the CTA ‘4개 품목 한 번에 입고’", (await sd.getByTestId("snap-row").count()) === 4 && (await sd.getByTestId("snap-row-check").evaluateAll((els) => els.every((e) => e.checked))) && (await sd.getByTestId("snap-submit").innerText()).includes("4개 품목 한 번에 입고"));
      const mackerel = sd.locator('[data-testid="snap-row"][data-name="고등어"]');
      record("kitchen-zt", "desktop", "each row shows the dictionary default (고등어 fridge 2일) and the detected amount (2마리)", /2일/.test(await mackerel.getByTestId("snap-row-expire").innerText()) && (await mackerel.getByTestId("snap-row-amount").inputValue()) === "2마리" && (await mackerel.locator('[data-storage="FRIDGE"]').getAttribute("aria-checked")) === "true");
      record("kitchen-zt", "desktop", "receipt total 33,000원 is offered as a checked ‘지출 기록’ option", (await sd.getByTestId("snap-total").innerText()).trim() === "33,000원" && (await sd.getByTestId("snap-total-check").isChecked()));
      await p.screenshot({ path: `${OUT}/kitchen-snap-review-light-desktop.png` });

      // ---- fine tuning
      await sd.locator('[data-testid="snap-row"][data-name="숙주"] [data-testid="snap-row-check"]').uncheck();
      record("kitchen-zt", "desktop", "unchecking a row updates the CTA to 3개 and dims the row", (await sd.getByTestId("snap-submit").innerText()).includes("3개 품목 한 번에 입고"));
      await mackerel.locator('[data-storage="FREEZER"]').click();
      record("kitchen-zt", "desktop", "moving 고등어 to 냉동 recalculates its expiry (frozen 60일 from the dictionary)", /60일/.test(await mackerel.getByTestId("snap-row-expire").innerText()));
      await mackerel.getByTestId("snap-row-amount").fill("1마리");

      // ---- one-tap intake
      await sd.getByTestId("snap-submit").click();
      await sd.waitFor({ state: "detached" });
      const fish = await until(async () => rowOf("고등어"));
      const dumpling = await rowOf("냉동만두"), treat = await rowOf("강아지 간식");
      record("kitchen-zt", "desktop", "batch intake: exactly the 3 checked items were created (숙주 was not)", !!fish && !!dumpling && !!treat && !(await rowOf("숙주")) && (await rows()).length === 4 + 3, (await rows()).map((r) => r.name).join(","));
      record("kitchen-zt", "desktop", "batch intake: tuned values stored — 고등어 FREEZER, amount 1마리, expiry today + 60; 냉동만두 FREEZER; pet treat is_pet with ROOM_TEMP default", fish?.storage_type === "FREEZER" && fish.amount === "1마리" && fish.expire_date === shift(60) && fish.added_at === today && dumpling?.storage_type === "FREEZER" && treat?.is_pet === true && treat.storage_type === "ROOM_TEMP", JSON.stringify({ fish, treat: treat && { s: treat.storage_type, p: treat.is_pet } }));
      const e1 = await until(async () => { const e = await expenses(); return e.length ? e : null; });
      record("kitchen-zt", "desktop", "receipt total went to the ledger: 33,000원, 장보기, today, memo ‘영수증 입고 3개’", e1?.length === 1 && e1[0].amount === 33000 && e1[0].category === "human_groceries" && e1[0].expense_date === today && e1[0].memo === "영수증 입고 3개", JSON.stringify(e1));
      await p.getByTestId("kitchen-notice").waitFor();
      record("kitchen-zt", "desktop", "success notice: ‘3개를 입고했어요’ + the recorded payment; new cards appear without a manual reload", /3개를 입고했어요/.test(await p.getByTestId("kitchen-notice").innerText()) && /33,000원/.test(await p.getByTestId("kitchen-notice").innerText()) && (await p.locator('[data-testid="kitchen-card"][data-name="고등어"]').waitFor().then(() => true)));

      // ---- without a total: nothing is invented
      await p.getByTestId("snap-open").click();
      mock.vision = "nototal";
      await sd.getByTestId("snap-gallery-input").setInputFiles({ name: "veg.jpg", mimeType: "image/jpeg", buffer: await bigPhoto(p) });
      await sd.getByTestId("snap-list").waitFor({ timeout: 30_000 });
      record("kitchen-zt", "desktop", "total_price 0 → no ‘지출 기록’ option is shown", (await sd.getByTestId("snap-total-check").count()) === 0);
      await sd.getByTestId("snap-submit").click();
      await sd.waitFor({ state: "detached" });
      await until(async () => rowOf("당근"));
      record("kitchen-zt", "desktop", "…and no expense is written (still 1 ledger row)", (await expenses()).length === 1 && !!(await rowOf("당근")));

      // ---- pet-only receipt → pet budget
      await p.getByTestId("snap-open").click();
      mock.vision = "pet";
      await sd.getByTestId("snap-camera-input").setInputFiles({ name: "pet.jpg", mimeType: "image/jpeg", buffer: await bigPhoto(p) });
      await sd.getByTestId("snap-list").waitFor({ timeout: 30_000 });
      await sd.getByTestId("snap-submit").click();
      await sd.waitFor({ state: "detached" });
      const e2 = await until(async () => { const e = await expenses(); return e.length === 2 ? e : null; });
      record("kitchen-zt", "desktop", "a receipt with only pet items books the total to the pet budget (pet_care, 15,000원, memo 영수증 입고 1개)", !!e2 && e2.some((e) => e.category === "pet_care" && e.amount === 15000 && e.memo === "영수증 입고 1개"), JSON.stringify(e2));

      // ---- AI failures are explained, nothing is created
      const nBefore = (await rows()).length;
      for (const [scenario, re, label] of [["fail429", /한도/, "quota exceeded (429)"], ["garbage", /읽지 못했어요/, "unreadable reply"]]) {
        await p.getByTestId("snap-open").click();
        mock.vision = scenario;
        await sd.getByTestId("snap-gallery-input").setInputFiles({ name: "x.jpg", mimeType: "image/jpeg", buffer: await bigPhoto(p) });
        await sd.getByTestId("snap-unavailable").waitFor({ timeout: 45_000 });
        record("kitchen-zt", "desktop", `AI failure (${label}): explained in plain Korean, no rows, nothing written`, re.test(await sd.getByTestId("snap-unavailable").innerText()) && (await sd.getByTestId("snap-row").count()) === 0 && (await rows()).length === nBefore);
        await p.keyboard.press("Escape");
        await sd.waitFor({ state: "detached" });
      }
      mock.vision = "empty";
      await p.getByTestId("snap-open").click();
      await sd.getByTestId("snap-gallery-input").setInputFiles({ name: "x.jpg", mimeType: "image/jpeg", buffer: await bigPhoto(p) });
      await sd.getByRole("alert").waitFor({ timeout: 30_000 });
      record("kitchen-zt", "desktop", "a photo with no food → ‘찾지 못했어요’ hint, back to the picker", /찾지 못했어요/.test(await sd.getByRole("alert").innerText()) && (await sd.getByTestId("snap-camera-input").count()) === 1);
      await p.keyboard.press("Escape");
      await sd.waitFor({ state: "detached" });
    }

    // ================================================================ 말로 정리
    const input = p.getByTestId("checkout-input");
    const cd = p.getByTestId("checkout-dialog");
    const ask = async (sentence) => {
      await input.fill(sentence);
      await p.getByTestId("checkout-submit").click();
      await cd.waitFor();
      await cd.locator('[data-testid="checkout-row"], [data-testid="checkout-empty"], [role="alert"]').first().waitFor({ timeout: 30_000 });
    };
    const texts = async () => cd.getByTestId("checkout-row-text").allInnerTexts();

    // rules path works regardless of the mock (AI failure sentence, or no key)
    await ask("AI장애 우유 버렸어, 대파 다 썼어");
    record("kitchen-zt", "desktop", "AI down / no key → the offline rules read the sentence and the dialog says so", (await cd.getByTestId("checkout-source").getAttribute("data-source")) === "rules" && (mocked ? /바빠요/.test(await cd.getByTestId("checkout-source").innerText()) : /GEMINI_API_KEY|AI/.test(await cd.getByTestId("checkout-source").innerText())), (await cd.getByTestId("checkout-source").innerText()).slice(0, 120));
    record("kitchen-zt", "desktop", "preview cards: ‘우유 폐기’ and ‘대파 소진 +3,000원’ (action icons per type)", JSON.stringify(await texts()) === JSON.stringify(["우유 폐기", "대파 소진 +3,000원"]) && (await cd.getByTestId("checkout-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-action")))).join() === "discard,consume");
    record("kitchen-zt", "desktop", "nothing changed yet (preview only): both items still exist", !!(await rowOf("우유")) && !!(await rowOf("대파")));
    await cd.getByTestId("checkout-row-check").nth(1).uncheck();
    record("kitchen-zt", "desktop", "unchecking a card lowers the run button to ‘1건 일괄 실행’", (await cd.getByTestId("checkout-run").innerText()).includes("1건 일괄 실행"));
    await cd.getByTestId("checkout-run").click();
    await cd.waitFor({ state: "detached" });
    const profA = await until(async () => { const r = await prof(); return r && r.discarded_count === 1 ? r : null; });
    record("kitchen-zt", "desktop", "only the checked action ran: 우유 discarded (row gone, discarded_count 1), 대파 untouched, no savings", !(await rowOf("우유")) && !!(await rowOf("대파")) && !!profA && profA.rescued_count === 0 && Number(profA.saved_money) === 0, JSON.stringify(profA));
    await p.getByTestId("kitchen-notice").waitFor();
    record("kitchen-zt", "desktop", "summary notice ‘반영 완료: 폐기 1’", /반영 완료/.test(await p.getByTestId("kitchen-notice").innerText()) && /폐기 1/.test(await p.getByTestId("kitchen-notice").innerText()), await p.getByTestId("kitchen-notice").innerText());

    // unknown ingredient / nothing understood
    await ask("AI장애 피자 1판 먹었어");
    record("kitchen-zt", "desktop", "an ingredient that is not in the kitchen is shown as ‘찾지 못했어요’, its checkbox is disabled and the run button is 0건/disabled", /냉장고에서 찾지 못했어요/.test((await texts())[0]) && (await cd.getByTestId("checkout-row-check").first().isDisabled()) && (await cd.getByTestId("checkout-run").isDisabled()) && (await cd.getByTestId("checkout-row").first().getAttribute("data-ok")) === "false");
    await p.keyboard.press("Escape");
    await cd.waitFor({ state: "detached" });
    await ask("AI장애 아무 말 대잔치");
    record("kitchen-zt", "desktop", "nothing understood → helpful examples, no run button", (await cd.getByTestId("checkout-empty").count()) === 1 && (await cd.getByTestId("checkout-run").count()) === 0 && /대파 1대 썼어/.test(await cd.getByTestId("checkout-empty").innerText()));
    await p.keyboard.press("Escape");
    await cd.waitFor({ state: "detached" });

    if (mocked) {
      // AI path — the headline sentence
      await ask("대파 1대 쓰고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달");
      record("kitchen-zt", "desktop", "AI path: source shown as AI, 3 cards — ‘대파 1대 차감 (3대 남음)’, ‘삼겹살 냉동 이동’, ‘치킨 22,000원 지출’", (await cd.getByTestId("checkout-source").getAttribute("data-source")) === "gemini" && JSON.stringify(await texts()) === JSON.stringify(["대파 1대 차감 (3대 남음)", "삼겹살 냉동 이동", "치킨 22,000원 지출"]), JSON.stringify(await texts()));
      const req = mock.hits[mock.hits.length - 1];
      record("kitchen-zt", "desktop", "the AI prompt carries the kitchen's ingredient names and the sentence as quoted data", /냉장고 재료: .*대파/.test(req.text) && req.text.includes(JSON.stringify("대파 1대 쓰고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달")));
      await p.screenshot({ path: `${OUT}/kitchen-checkout-light-desktop.png` });
      await cd.getByTestId("checkout-run").click();
      await cd.waitFor({ state: "detached" });
      const scallion = await until(async () => { const r = await rowOf("대파"); return r?.amount === "3대" ? r : null; });
      const pork = await rowOf("삼겹살");
      const ex = (await expenses()).find((e) => e.memo === "치킨");
      record("kitchen-zt", "desktop", "batch apply: 대파 4대 → 3대 (still in stock), 삼겹살 → freezer with expiry today + 90, 치킨 22,000원 booked as 배달", !!scallion && pork?.storage_type === "FREEZER" && pork.expire_date === shift(90) && pork.added_at === today && ex?.amount === 22000 && ex.category === "human_delivery" && ex.expense_date === today, JSON.stringify({ a: scallion?.amount, p: pork?.storage_type, e: ex }));
      const profB = await prof();
      record("kitchen-zt", "desktop", "a partial deduction is not a ‘rescue’: counters unchanged (rescued 0, saved 0, discarded 1)", profB.rescued_count === 0 && Number(profB.saved_money) === 0 && profB.discarded_count === 1);

      // using it all up credits the saving
      await ask("AI장애 대파 다 썼어");
      await cd.getByTestId("checkout-run").click();
      await cd.waitFor({ state: "detached" });
      const profC = await until(async () => { const r = await prof(); return r && r.rescued_count === 1 ? r : null; });
      record("kitchen-zt", "desktop", "using the rest up deletes the item and credits +3,000원 (rescued 1)", !!profC && Number(profC.saved_money) === 3000 && !(await rowOf("대파")), JSON.stringify(profC));
      await p.waitForFunction(() => document.querySelector('[data-pulse="saved"] [data-testid="pulse-value"]')?.textContent?.trim() === "3,000원");

      // ---- tampering: a modified request cannot touch another household's rows
      const other = await svc.from("kitchen_items").insert({ household_id: myProfile.household_id, name: `타가구대파${rand}`, storage_type: "FRIDGE", expire_date: shift(9), amount: "1개", spot: null, added_at: today, is_pet: false, memo: null }).select("id").single();
      mainRowIds.push(other.data.id);
      const mine = await rowOf("두부"); // my own row; the request will be rewritten to point at the OTHER household's row
      let swapped = false;
      await p.route("**/kitchen", async (route) => {
        const r = route.request();
        const post = r.postData();
        if (r.method() === "POST" && post && post.includes(mine.id) && !swapped) {
          swapped = true;
          return route.continue({ postData: post.split(mine.id).join(other.data.id) });
        }
        return route.continue();
      });
      await ask("AI장애 두부 버렸어");
      await cd.getByTestId("checkout-run").click();
      await p.waitForFunction(() => !document.querySelector('[data-testid="checkout-run"]') || document.querySelector('[data-testid="checkout-results"]'), null, { timeout: 15_000 }).catch(() => {});
      await p.waitForTimeout(800);
      record("kitchen-zt", "desktop", "tampered request (item id swapped for ANOTHER household's row): the action reports it as not found, the foreign row is untouched, my row is not deleted", swapped && !!(await svc.from("kitchen_items").select("id").eq("id", other.data.id).maybeSingle()).data && !!(await rowOf("두부")), `swapped=${swapped}`);
      const resultsText = await p.getByTestId("checkout-results").innerText().catch(() => "");
      record("kitchen-zt", "desktop", "…and the dialog lists the failure (‘찾지 못했어요’) instead of pretending success", /찾지 못했어요/.test(resultsText), resultsText);
      await p.unroute("**/kitchen");
      if ((await p.getByTestId("checkout-dialog").count()) > 0) { await p.keyboard.press("Escape"); await cd.waitFor({ state: "detached" }); }
    }
    record("kitchen-zt", "desktop", "no console/page errors in the whole desktop flow", p.__errors.length === 0, p.__errors.slice(0, 2).join(" | "));
    await c.close();

    // ================================================================ speech (Web Speech API)
    {
      const noSpeech = () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true }); Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true }); };
      const a = await mk(VIEWPORTS[0], { init: noSpeech });
      record("kitchen-zt", "desktop", "browser without the Web Speech API: the mic button is not shown (typing still works)", (await a.p.getByTestId("checkout-mic").count()) === 0 && (await a.p.getByTestId("checkout-input").count()) === 1);
      await a.c.close();

      const fakeSpeech = () => {
        class FakeRecognition {
          constructor() { this.lang = ""; this.interimResults = false; this.continuous = false; window.__rec = this; }
          start() { window.__recStarted = { lang: this.lang, interim: this.interimResults }; setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: "대파 1대 썼어" }], { isFinal: false })] }); }, 30); setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: "대파 1대 썼어 우유 버렸어" }], { isFinal: true })] }); this.onend?.(); }, 120); }
          stop() { this.onend?.(); }
          abort() {}
        }
        window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
      };
      const b = await mk(VIEWPORTS[0], { init: fakeSpeech });
      const mic = b.p.getByTestId("checkout-mic");
      record("kitchen-zt", "desktop", "browser with the Web Speech API: a mic button appears next to the input", (await mic.count()) === 1 && (await mic.getAttribute("aria-label")) === "음성으로 말하기");
      await mic.click();
      await b.p.getByTestId("checkout-listening").waitFor();
      record("kitchen-zt", "desktop", "mic click starts Korean recognition (ko-KR, interim results) and shows ‘듣고 있어요’", (await b.p.evaluate(() => window.__recStarted?.lang)) === "ko-KR" && (await b.p.evaluate(() => window.__recStarted?.interim)) === true && (await mic.getAttribute("aria-pressed")) === "true");
      await b.p.waitForFunction(() => document.querySelector('[data-testid="checkout-input"]')?.value === "대파 1대 썼어 우유 버렸어");
      await b.p.waitForTimeout(200);
      record("kitchen-zt", "desktop", "the transcript fills the input live and listening ends by itself", (await b.p.getByTestId("checkout-input").inputValue()) === "대파 1대 썼어 우유 버렸어" && (await b.p.getByTestId("checkout-listening").count()) === 0 && (await mic.getAttribute("aria-pressed")) === "false");
      await b.p.getByTestId("checkout-submit").click();
      await b.p.getByTestId("checkout-dialog").waitFor();
      await b.p.locator('[data-testid="checkout-row"], [data-testid="checkout-empty"]').first().waitFor({ timeout: 30_000 }); // (the mock AI only knows one sentence; the dialog still opens with the spoken text)
      record("kitchen-zt", "desktop", "the spoken sentence flows into the same confirmation dialog", (await b.p.getByTestId("checkout-sentence").innerText()).includes("대파 1대 썼어 우유 버렸어"));
      await b.c.close();
    }

    // ================================================================ light/dark × desktop/mobile
    await svc.from("kitchen_items").insert([seed("대파", "FRIDGE", shift(10), "4대"), seed("삼겹살", "FRIDGE", shift(2), "600g")]);
    for (const scheme of ["light", "dark"]) {
      for (const vp of VIEWPORTS) {
        const z = await mk(vp, { scheme });
        const q = z.p;
        const tag = `${scheme}/${vp.name}`;
        record("kitchen-zt", vp.name, `${tag}: header actions + 말로 정리 bar fit the viewport (no horizontal scroll)`, await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await q.getByTestId("snap-open").isVisible()) && (await q.getByTestId("checkout-submit").isVisible()));
        await q.getByTestId("checkout-input").fill("AI장애 대파 1대 썼고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달");
        await q.getByTestId("checkout-submit").click();
        const dlg = q.getByTestId("checkout-dialog");
        await dlg.locator('[data-testid="checkout-row"], [data-testid="checkout-empty"], [role="alert"]').first().waitFor({ timeout: 30_000 });
        if ((await dlg.getByTestId("checkout-row").count()) === 0) record("kitchen-zt", vp.name, `${tag}: 말로 정리 parsed the sentence into cards`, false, (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 200));
        const box = await dlg.evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth, sw: el.scrollWidth, cw: el.clientWidth }; });
        record("kitchen-zt", vp.name, `${tag}: 말로 정리 dialog (3 preview cards) fits inside the viewport`, box.l >= 0 && box.r <= box.w + 1 && box.sw <= box.cw + 1 && (await dlg.getByTestId("checkout-row").count()) === 3, JSON.stringify(box));
        const bg = await dlg.evaluate((el) => getComputedStyle(el).backgroundColor);
        const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        record("kitchen-zt", vp.name, `${tag}: dialog follows the theme`, scheme === "dark" ? lum(bg) < 0.1 : lum(bg) > 0.8, bg);
        await q.screenshot({ path: `${OUT}/kitchen-checkout-${scheme}-${vp.name}.png` });
        await q.keyboard.press("Escape");
        await dlg.waitFor({ state: "detached" });
        await q.getByTestId("snap-open").click();
        const sdlg = q.getByTestId("snap-dialog");
        await sdlg.waitFor();
        await q.waitForTimeout(450); // let the dialog enter animation finish before measuring
        const sb2 = await sdlg.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; });
        record("kitchen-zt", vp.name, `${tag}: snap dialog (camera / gallery picker) fits the viewport`, sb2);
        await q.screenshot({ path: `${OUT}/kitchen-snap-${scheme}-${vp.name}.png` });
        record("kitchen-zt", vp.name, `${tag}: no console/page errors`, q.__errors.length === 0, q.__errors.slice(0, 2).join(" | "));
        await z.c.close();
      }
    }
  } catch (err) {
    if (/kitchen tables missing/.test(String(err))) record("kitchen-zt", "-", "kitchen tables available (migration 14)", false, "tables missing");
    else record("kitchen-zt", "-", "zero-typing suite ran to completion", false, String(err?.stack ?? err).slice(0, 500));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (mainRowIds.length) await svc.from("kitchen_items").delete().in("id", mainRowIds);
    if (H2) {
      for (const t of ["kitchen_items", "kitchen_shopping_items", "kitchen_expenses", "kitchen_profiles"]) await svc.from(t).delete().eq("household_id", H2);
      await svc.from("profiles").delete().eq("household_id", H2);
      await svc.from("households").delete().eq("id", H2);
    }
    if (strangerId) await svc.auth.admin.deleteUser(strangerId);
  }
}

// ---------------------------------------------------------------- Smart Kitchen OS Phase 4: dual money log on /kitchen + combined cash-flow on /analytics (real Supabase)
{
  const rand = Math.random().toString(36).slice(2, 10);
  let strangerId = null, H2 = null;
  const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
  const [ty, tm, td] = today.split("-").map(Number);
  const daysLeft = new Date(Date.UTC(ty, tm, 0)).getUTCDate() - td + 1;
  try {
    const email = `mylife.e2e.kbud+${rand}@example.com`;
    const pw = `Pw-${rand}-${Date.now()}`;
    const { data: su, error: suErr } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: "E2E 머니로그" } });
    if (suErr) throw new Error(`kitchen-budget createUser failed: ${suErr.message}`);
    strangerId = su.user.id;
    const cl = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cl.auth.signInWithPassword({ email, password: pw });
    await cl.rpc("create_household", { p_name: "E2E 머니로그", p_display_name: "E2E 머니로그" });
    H2 = (await svc.from("profiles").select("household_id").eq("id", strangerId).single()).data.household_id;
    if ((await cl.from("kitchen_expenses").select("id").limit(1)).error) throw new Error("kitchen tables missing");

    // budgets 100,000 / 50,000, saved 6,000 (2 rescues); this month: groceries 40,000 + delivery 45,000 (human 85% = warn), pet 52,000 (104% = danger); last month: 999,999 (must be ignored)
    await svc.from("kitchen_profiles").insert({ household_id: H2, human_monthly_budget: 100_000, pet_monthly_budget: 50_000, rescued_count: 2, saved_money: 6000 });
    const exp = (d, category, amount, memo, createdAt) => ({ household_id: H2, expense_date: d, category, amount, memo, created_at: createdAt });
    const base = Date.now();
    const iso = (n) => new Date(base + n * 1000).toISOString();
    const lastMonth = new Date(Date.UTC(ty, tm - 2, 15)).toISOString().slice(0, 10);
    await svc.from("kitchen_expenses").insert([
      exp(today, "human_groceries", 40_000, `장보기${rand}`, iso(1)),
      exp(today, "human_delivery", 45_000, `치킨${rand}`, iso(2)),
      exp(today, "pet_care", 52_000, `사료${rand}`, iso(3)),
      exp(lastMonth, "human_groceries", 999_999, `지난달${rand}`, iso(0)),
    ]);
    const exps = async () => (await svc.from("kitchen_expenses").select("*").eq("household_id", H2)).data ?? [];
    const prof = async () => (await svc.from("kitchen_profiles").select("*").eq("household_id", H2).single()).data;

    let state;
    {
      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', pw);
      await p.click('button[type="submit"]');
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      state = await c.storageState();
      await c.close();
    }
    const mk = async (vp, path = "/kitchen", scheme = "light") => {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
      await c.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
      const p = await c.newPage();
      p.__errors = [];
      p.on("pageerror", (e) => p.__errors.push(`pageerror: ${e.message}`));
      p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && p.__errors.push(`console: ${m.text()}`));
      await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await p.getByTestId(path === "/kitchen" ? "budget-card" : "kitchen-strip").waitFor();
      return { c, p };
    };

    // ================================================================ /kitchen budget card
    const { c, p } = await mk(VIEWPORTS[0]);
    const card = p.getByTestId("budget-card");
    const nextTo = await p.evaluate(() => { const pulse = document.querySelector('[data-testid="kitchen-pulse"]'); return pulse?.nextElementSibling?.getAttribute("data-testid") ?? pulse?.nextElementSibling?.querySelector?.("[data-testid]")?.getAttribute("data-testid"); });
    record("kitchen-budget", "desktop", "budget card sits directly below the KitchenPulse tiles", nextTo === "budget-card", String(nextTo));
    const gauge = (id) => card.locator(`[data-gauge="${id}"]`);
    record("kitchen-budget", "desktop", "human gauge: 85,000 / 100,000원 = 85% → warn (orange, 80%+); 15,000원 남음", (await gauge("human").getAttribute("data-level")) === "warn" && (await gauge("human").getByTestId("gauge-pct").innerText()) === "85%" && /85,000원 \/ 100,000원/.test(await gauge("human").getByTestId("gauge-amounts").innerText()) && /15,000원 남음/.test(await gauge("human").getByTestId("gauge-note").innerText()));
    record("kitchen-budget", "desktop", "pet gauge: 52,000 / 50,000원 = 104% → danger (red); ‘2,000원 초과’; bar capped at 100% width", (await gauge("pet").getAttribute("data-level")) === "danger" && (await gauge("pet").getByTestId("gauge-pct").innerText()) === "104%" && /2,000원 초과/.test(await gauge("pet").getByTestId("gauge-note").innerText()) && (await gauge("pet").getByTestId("gauge-fill").evaluate((el) => el.style.width)) === "100%");
    const fill = (id) => gauge(id).getByTestId("gauge-fill").evaluate((el) => getComputedStyle(el).backgroundColor);
    record("kitchen-budget", "desktop", "gauge colours: warn = sunny amber-400, danger = coral rose-400 (chunky 16px bars)", (await fill("human")) === "rgb(251, 191, 36)" && (await fill("pet")) === "rgb(251, 113, 133)" && (await gauge("human").getByRole("progressbar").evaluate((el) => el.getBoundingClientRect().height)) >= 15, `${await fill("human")} ${await fill("pet")}`);
    const bar = await gauge("human").getByRole("progressbar").evaluate((el) => ({ now: el.getAttribute("aria-valuenow"), text: el.getAttribute("aria-valuetext") }));
    record("kitchen-budget", "desktop", "gauges are accessible progress bars (aria-valuenow, readable valuetext)", bar.now === "85" && /85,000원 \/ 100,000원 \(85%\)/.test(bar.text), JSON.stringify(bar));
    const expectedToday = Math.floor(15_000 / daysLeft);
    const tb = card.getByTestId("today-budget");
    record("kitchen-budget", "desktop", `‘오늘의 권장 식비’ badge = floor(15,000 ÷ ${daysLeft} days left incl. today) = ${expectedToday.toLocaleString("ko-KR")}원, shown in the sky→mint gradient pill`, (await tb.getAttribute("data-state")) === "ok" && /오늘의 권장 식비/.test(await tb.innerText()) && (await card.getByTestId("today-budget-value").innerText()).trim() === `${expectedToday.toLocaleString("ko-KR")}원` && /gradient/.test(await tb.evaluate((el) => getComputedStyle(el).backgroundImage)), await tb.innerText());
    record("kitchen-budget", "desktop", "saved badge: 냉파 누적 방어액 6,000원 · 구출 2번", /6,000원/.test(await card.getByTestId("saved-badge").innerText()) && /구출 2번/.test(await card.innerText()));
    const recent = await card.getByTestId("recent-row").allInnerTexts();
    record("kitchen-budget", "desktop", "recent expenses: exactly the 3 newest of this month (last month's 999,999원 excluded), newest first", recent.length === 3 && /사료/.test(recent[0]) && /치킨/.test(recent[1]) && /장보기/.test(recent[2]) && !(await card.innerText()).includes("지난달"), recent.join(" | ").replace(/\s+/g, " "));
    await p.screenshot({ path: `${OUT}/kitchen-budget-light-desktop.png`, fullPage: true });

    // ---- dialog: list, add, validation, delete, settings
    await card.getByTestId("expense-open").click();
    const dlg = p.getByTestId("expense-dialog");
    await dlg.waitFor();
    record("kitchen-budget", "desktop", "ledger dialog lists all 3 of this month's expenses (count 3건), not last month's", (await dlg.getByTestId("expense-row").count()) === 3 && /3건/.test(await dlg.getByTestId("expense-count").innerText()) && !(await dlg.innerText()).includes("지난달"));
    const submit = dlg.getByTestId("expense-submit");
    const err = dlg.getByTestId("expense-error");
    for (const [val, re, label] of [["", /숫자/, "empty"], ["abc", /숫자/, "text"], ["0", /1원 이상/, "zero"], ["-500", /숫자/, "negative"], ["1.5", /숫자/, "decimal"], ["999999999", /너무 커요/, "over the cap"]]) {
      await dlg.getByLabel("금액 (원)").fill(val);
      await submit.click();
      await err.waitFor();
      record("kitchen-budget", "desktop", `validation (${label}): ‘${val}’ is rejected with a clear message, nothing written`, re.test(await err.innerText()) && (await exps()).length === 4, await err.innerText());
    }
    await dlg.getByLabel("금액 (원)").fill("5000");
    await dlg.getByLabel("날짜").evaluate((el) => { el.removeAttribute("max"); });
    await dlg.getByLabel("날짜").fill(shift(2));
    await submit.click();
    await err.waitFor();
    record("kitchen-budget", "desktop", "a future date is refused by the server (‘미래 날짜’)", /미래 날짜/.test(await err.innerText()) && (await exps()).length === 4, await err.innerText());
    await dlg.getByLabel("날짜").fill(today);

    await dlg.locator('[data-testid="expense-cat-option"][data-category="human_delivery"]').click();
    await dlg.getByLabel("금액 (원)").fill("20,000");
    await dlg.getByLabel("메모 (선택)").fill(`피자${rand}`);
    await submit.click();
    const pizza = await until(async () => (await exps()).find((e) => e.memo === `피자${rand}`));
    record("kitchen-budget", "desktop", "add: 20,000원 배달·외식 ‘피자’ saved with today's date (commas in the amount accepted)", !!pizza && pizza.amount === 20_000 && pizza.category === "human_delivery" && pizza.expense_date === today, JSON.stringify(pizza));
    await p.waitForFunction(() => document.querySelector('[data-testid="expense-count"]')?.textContent?.includes("4건"));
    record("kitchen-budget", "desktop", "the dialog list and the card refresh without reload (4건; human now 105% → danger)", (await dlg.getByTestId("expense-row").count()) === 4 && (await gauge("human").getAttribute("data-level")) === "danger" && (await gauge("human").getByTestId("gauge-pct").innerText()) === "105%");
    record("kitchen-budget", "desktop", "overspent: the badge switches to the rose warning style with ‘예산 초과’ and recommends 0원", (await tb.getAttribute("data-state")) === "over" && /예산 초과/.test(await tb.innerText()) && (await card.getByTestId("today-budget-value").innerText()).trim() === "0원" && /5,000원 넘겼어요/.test(await card.getByTestId("today-budget-hint").innerText()), await tb.innerText());
    const overBg = await tb.evaluate((el) => getComputedStyle(el).backgroundColor);
    record("kitchen-budget", "desktop", "warning badge switches to the soft coral tint (rose-100) — not the sky/mint gradient", lum(overBg) > 0.8 && overBg === "rgb(255, 228, 230)", overBg);
    await p.screenshot({ path: `${OUT}/kitchen-budget-overspent-light-desktop.png` });

    // delete: two steps
    const row = dlg.locator(`[data-testid="expense-row"]`).filter({ hasText: `피자${rand}` });
    await row.getByTestId("expense-delete").click();
    await row.getByTestId("expense-delete-confirm").waitFor();
    await row.getByRole("button", { name: "취소" }).click();
    record("kitchen-budget", "desktop", "delete asks for confirmation; cancel keeps the row", (await row.count()) === 1 && (await exps()).length === 5);
    await row.getByTestId("expense-delete").click();
    await row.getByTestId("expense-delete-confirm").click();
    await row.waitFor({ state: "detached" });
    record("kitchen-budget", "desktop", "confirmed delete removes the ledger row (back to 4 rows) and the gauge returns to 85%", (await exps()).length === 4 && !(await exps()).some((e) => e.memo === `피자${rand}`) && (await until(async () => (await gauge("human").getByTestId("gauge-pct").innerText()) === "85%")) === true);

    // settings
    await dlg.getByTestId("budget-settings-toggle").click();
    await dlg.getByLabel("사람 식비 (월)").fill("-1");
    await dlg.getByTestId("budget-save").click();
    await dlg.getByTestId("budget-error").waitFor();
    record("kitchen-budget", "desktop", "budget settings: a negative budget is rejected, DB unchanged", /숫자|0원 이상/.test(await dlg.getByTestId("budget-error").innerText()) && (await prof()).human_monthly_budget === 100_000);
    await dlg.getByLabel("사람 식비 (월)").fill("200000");
    await dlg.getByLabel("댕냥이 케어비 (월)").fill("60,000");
    await dlg.getByTestId("budget-save").click();
    const p2 = await until(async () => { const r = await prof(); return r.human_monthly_budget === 200_000 ? r : null; });
    record("kitchen-budget", "desktop", "budget settings saved (200,000 / 60,000); stats counters untouched (rescued 2, saved 6,000)", !!p2 && p2.pet_monthly_budget === 60_000 && p2.rescued_count === 2 && Number(p2.saved_money) === 6000, JSON.stringify(p2));
    await p.waitForFunction(() => document.querySelector('[data-gauge="human"] [data-testid="gauge-pct"]')?.textContent === "43%");
    record("kitchen-budget", "desktop", "gauges recompute against the new budgets: human 85,000/200,000 = 43% (ok, green), pet 52,000/60,000 = 87% (warn)", (await gauge("human").getAttribute("data-level")) === "ok" && (await gauge("pet").getByTestId("gauge-pct").innerText()) === "87%" && (await gauge("pet").getAttribute("data-level")) === "warn");
    await p.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });

    // exact 100% boundary & 0-won budget
    await svc.from("kitchen_profiles").update({ human_monthly_budget: 85_000 }).eq("household_id", H2);
    await p.reload({ waitUntil: "networkidle" });
    await card.waitFor();
    record("kitchen-budget", "desktop", "spent == budget (85,000 / 85,000) is already ‘danger’ (100%), with ‘0원 남음’ and a 0원 recommendation", (await gauge("human").getAttribute("data-level")) === "danger" && (await gauge("human").getByTestId("gauge-pct").innerText()) === "100%" && /0원 남음/.test(await gauge("human").getByTestId("gauge-note").innerText()) && (await card.getByTestId("today-budget-value").innerText()).trim() === "0원");
    await svc.from("kitchen_profiles").update({ human_monthly_budget: 0, pet_monthly_budget: 0 }).eq("household_id", H2);
    await p.reload({ waitUntil: "networkidle" });
    await card.waitFor();
    record("kitchen-budget", "desktop", "a 0-won budget with spending: ‘예산 미설정’, gauge full/red, no division by zero, no NaN anywhere", /예산 미설정/.test(await card.innerText()) && (await gauge("human").getAttribute("data-level")) === "danger" && !/NaN|Infinity/.test(await card.innerText()));

    record("kitchen-budget", "desktop", "no console/page errors in the /kitchen money-log flow", p.__errors.length === 0, p.__errors.slice(0, 2).join(" | "));
    await c.close();

    // isolation: the E2E household's kitchen page never shows this ledger
    {
      const cx = await newContext(VIEWPORTS[0], storageState);
      const px = await cx.newPage();
      await px.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
      const html = await px.content();
      record("kitchen-budget", "desktop", "another household never sees this ledger (no memos, no 6,000원 saved leak)", !html.includes(`치킨${rand}`) && !html.includes(`사료${rand}`) && !html.includes("999,999"));
      await cx.close();
    }

    // ================================================================ /analytics integration
    await svc.from("kitchen_profiles").update({ human_monthly_budget: 100_000, pet_monthly_budget: 50_000 }).eq("household_id", H2);
    // zero-asset household WITH kitchen data: the report is not the empty state any more
    const a0 = await mk(VIEWPORTS[0], "/analytics");
    record("kitchen-budget", "desktop", "analytics: a household with kitchen spending but 0 assets still gets a report (no empty state), with the kitchen strip", (await a0.p.getByTestId("analytics-empty").count()) === 0 && (await a0.p.getByTestId("kitchen-strip").count()) === 1);
    await a0.c.close();

    // add a rental (30,000 / month) so fixed + variable can be checked
    const ownerId = strangerId;
    const ins = await svc.from("assets").insert({ household_id: H2, owner_id: ownerId, visibility: "FAMILY", name: `E2E렌탈${rand}`, space: "거실", category: "정수기", ownership_type: "RENTAL", rental_provider: "코웨이", monthly_fee: 30_000, billing_day: 15 }).select("id").single();
    if (ins.error) throw new Error(`rental fixture failed: ${ins.error.message}`);
    for (const vp of VIEWPORTS) {
      for (const scheme of ["light", "dark"]) {
        const { c: ac, p: ap } = await mk(vp, "/analytics", scheme);
        const tag = `${scheme}/${vp.name}`;
        const strip = ap.getByTestId("kitchen-strip");
        const tile = (id) => strip.locator(`[data-tile="${id}"] [data-testid="kitchen-tile-value"]`).innerText();
        if (scheme === "light" && vp.name === "desktop") {
          record("kitchen-budget", vp.name, "analytics strip: 식비 85,000원 · 양육비 52,000원 (this month only) · 냉파로 아낀 금액 6,000원", (await tile("human")).trim() === "85,000원" && (await tile("pet")).trim() === "52,000원" && (await tile("defended")).trim() === "6,000원", `${await tile("human")} ${await tile("pet")} ${await tile("defended")}`);
          const t = (id) => strip.getByTestId(id).innerText();
          record("kitchen-budget", vp.name, "종합 캐시플로우: 렌탈 고정 30,000원 + 식비·양육비 변동 137,000원 = 합계 167,000원", (await t("cash-fixed")).trim() === "30,000원" && (await t("cash-variable")).trim() === "137,000원" && (await t("cash-total")).trim() === "167,000원", `${await t("cash-fixed")} ${await t("cash-variable")} ${await t("cash-total")}`);
          const segs = await strip.getByTestId("cash-bar").locator("[data-seg]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-seg"), Math.round(parseFloat(e.style.width))]));
          record("kitchen-budget", vp.name, "stacked bar: 렌탈 18% · 식비 51% · 양육비 31% of the total, labelled for screen readers", JSON.stringify(segs) === JSON.stringify([["fixed", 18], ["human", 51], ["pet", 31]]) && /렌탈 18%, 식비 51%, 양육비 31%/.test((await strip.getByTestId("cash-bar").getAttribute("aria-label")) ?? ""), JSON.stringify(segs));
          record("kitchen-budget", vp.name, "defended line: ‘냉파로 지금까지 6,000원을 지켰어요 (… 4%)’ — cumulative defended vs. variable spending", /6,000원을 지켰어요/.test(await t("cash-defended")) && /4%/.test(await t("cash-defended")), await t("cash-defended"));
          record("kitchen-budget", vp.name, "the rental sections of the report are still there (KPI grid, billing strip, savings card)", (await ap.getByTestId("kpi-grid").count()) === 1 && (await ap.getByTestId("billing-strip").count()) === 1 && (await ap.getByTestId("savings-card").count()) === 1);
          const kv = await ap.getByTestId("kpi-value").first().innerText();
          record("kitchen-budget", vp.name, "the rental KPI still shows only the rental total (30,000원) — kitchen money does not leak into it", kv.trim() === "30,000원", kv);
        }
        record("kitchen-budget", vp.name, `${tag}: analytics page has no horizontal scroll; strip tiles and summary fit`, await ap.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)));
        const sbg = await strip.evaluate((el) => getComputedStyle(el).backgroundColor);
        record("kitchen-budget", vp.name, `${tag}: strip follows the theme`, scheme === "dark" ? lum(sbg) < 0.1 : lum(sbg) > 0.8, sbg);
        await ap.screenshot({ path: `${OUT}/analytics-kitchen-${scheme}-${vp.name}.png`, fullPage: true });
        record("kitchen-budget", vp.name, `${tag}: no console/page errors`, ap.__errors.length === 0, ap.__errors.slice(0, 2).join(" | "));
        await ac.close();
      }
    }

    // kitchen card on mobile / dark
    for (const [vp, scheme] of [[VIEWPORTS[1], "light"], [VIEWPORTS[1], "dark"], [VIEWPORTS[0], "dark"]]) {
      const { c: kc, p: kp } = await mk(vp, "/kitchen", scheme);
      const tag = `${scheme}/${vp.name}`;
      const kcard = kp.getByTestId("budget-card");
      record("kitchen-budget", vp.name, `${tag}: money-log card fits (no horizontal scroll, gauges stack on mobile)`, await kp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await kcard.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)) && (vp.name !== "mobile" || (await kcard.locator('[data-gauge="human"]').evaluate((a, ) => { const b = document.querySelector('[data-gauge="pet"]'); return b.getBoundingClientRect().top > a.getBoundingClientRect().bottom - 1; }))));
      const kbg = await kcard.evaluate((el) => getComputedStyle(el).backgroundColor);
      record("kitchen-budget", vp.name, `${tag}: card follows the theme`, scheme === "dark" ? lum(kbg) < 0.1 : lum(kbg) > 0.8, kbg);
      await kcard.getByTestId("expense-open").click();
      const d2 = kp.getByTestId("expense-dialog");
      await d2.waitFor();
      await kp.waitForTimeout(450);
      record("kitchen-budget", vp.name, `${tag}: ledger dialog fits the viewport`, await d2.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; }));
      await kp.screenshot({ path: `${OUT}/kitchen-ledger-${scheme}-${vp.name}.png` });
      await kc.close();
    }
  } catch (err) {
    if (/kitchen tables missing/.test(String(err))) record("kitchen-budget", "-", "kitchen tables available (migration 14)", false, "tables missing");
    else record("kitchen-budget", "-", "money-log suite ran to completion", false, String(err?.stack ?? err).slice(0, 500));
  } finally {
    if (H2) {
      await svc.from("assets").delete().eq("household_id", H2);
      for (const t of ["kitchen_items", "kitchen_shopping_items", "kitchen_expenses", "kitchen_profiles"]) await svc.from(t).delete().eq("household_id", H2);
      await svc.from("profiles").delete().eq("household_id", H2);
      await svc.from("households").delete().eq("id", H2);
    }
    if (strangerId) await svc.auth.admin.deleteUser(strangerId);
  }
}

// ---------------------------------------------------------------- Smart Kitchen OS Phase 5: AI chef, local life radar, fridge-asset deep link (real Supabase; mock Gemini on :4011 when the dev server is wired to it)
// Wiring: `npm run dev:e2e` points the server at http://127.0.0.1:4010 (the zero-typing block's mock). This block starts its own
// recipe mock on that port only if the zero-typing block is not running (it is closed by then), so it can run standalone.
{
  const rand = Math.random().toString(36).slice(2, 10);
  const http = await import("node:http");
  const mock = { hits: [], mode: "ok" };
  const ai = (payload) => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  const HUMAN = { recipes: [
    { title: "AI 대파 계란 볶음밥", cookTime: "12분", difficulty: "초급", mainIngredients: ["대파", "계란"], condiments: ["진간장 1숟가락"], steps: ["대파를 송송 썰어요.", "계란을 풀어 3분 볶아요.", "밥을 넣고 5분 볶아요.", "간장으로 마무리해요."], chefTip: "센 불에서 빠르게", substituteTip: "양파 대체 가능", calories: 520 },
    { title: "AI 두부 조림", cookTime: "15분", difficulty: "중급", mainIngredients: ["두부", "양파"], condiments: ["진간장 2숟가락"], steps: ["두부를 부쳐요.", "양념장을 만들어요.", "졸여요 5분."], chefTip: "약불로", substituteTip: "없음", calories: 210 },
  ] };
  const PET_UNSAFE = { recipes: [{ title: "양파 닭가슴살 찜", cookTime: "20분", difficulty: "초급", mainIngredients: ["닭가슴살", "양파"], condiments: [], steps: ["찌고", "식혀서 급여해요."], chefTip: "소량", substituteTip: "", calories: 100 }] };
  const PET_OK = { recipes: [{ title: "AI 닭가슴살 단호박 찜", cookTime: "25분", difficulty: "초급", mainIngredients: ["닭가슴살", "단호박"], condiments: ["소금 1꼬집"], steps: ["손질해요.", "소금 없이 15분 쪄요.", "잘게 다져요."], chefTip: "맛있어요", substituteTip: "고구마", calories: 140 }] };
  let server = null;
  try {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
        const text = body.contents?.[0]?.parts?.[0]?.text ?? "";
        mock.hits.push({ text });
        const send = (s, p) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(p); };
        if (!text.includes("재료(데이터)")) return send(200, ai([]));
        if (mock.mode === "fail") return send(503, "{}");
        const pet = text.includes("반려동물(강아지·고양이) 수제 화식");
        if (pet) return send(200, ai(mock.mode === "petunsafe" ? PET_UNSAFE : PET_OK));
        return send(200, ai(HUMAN));
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(4010, "127.0.0.1", resolve); });
  } catch { server = null; } // port busy: the earlier block's server is still up — nothing to do, mock.hits just stays empty

  let strangerId = null, H2 = null;
  const lum = (rgb) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
  try {
    const email = `mylife.e2e.chef+${rand}@example.com`;
    const pw = `Pw-${rand}-${Date.now()}`;
    const { data: su, error: suErr } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: "E2E 셰프" } });
    if (suErr) throw new Error(`chef createUser failed: ${suErr.message}`);
    strangerId = su.user.id;
    const cl = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cl.auth.signInWithPassword({ email, password: pw });
    await cl.rpc("create_household", { p_name: "E2E 셰프", p_display_name: "E2E 셰프" });
    H2 = (await svc.from("profiles").select("household_id").eq("id", strangerId).single()).data.household_id;
    if ((await cl.from("kitchen_items").select("id").limit(1)).error) throw new Error("kitchen tables missing");

    const seed = (name, storage_type, expire, extra = {}) => ({ household_id: H2, name, storage_type, expire_date: expire, amount: "1개", spot: null, added_at: today, is_pet: false, memo: null, ...extra });
    await svc.from("kitchen_items").insert([
      seed("대파", "FRIDGE", shift(2), { amount: "2대" }), seed("계란", "FRIDGE", shift(3), { amount: "10구" }), seed("두부", "FRIDGE", shift(15)), seed("양파", "FRIDGE", shift(20)),
      seed("닭가슴살", "FRIDGE", shift(6), { amount: "300g" }), seed("단호박", "ROOM_TEMP", shift(30)),
      seed("지난우유", "FRIDGE", shift(-2)), seed("강아지간식", "ROOM_TEMP", shift(60), { is_pet: true }),
    ]);
    const rows = async () => (await svc.from("kitchen_items").select("*").eq("household_id", H2)).data ?? [];
    const rowOf = async (n) => (await rows()).find((r) => r.name === n);
    const prof = async () => (await svc.from("kitchen_profiles").select("*").eq("household_id", H2).maybeSingle()).data;

    let state;
    {
      const c = await newContext(VIEWPORTS[0]);
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', pw);
      await p.click('button[type="submit"]');
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      state = await c.storageState();
      await c.close();
    }
    const mk = async (vp, scheme = "light", path = "/kitchen") => {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: scheme });
      await c.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
      const p = await c.newPage();
      p.__errors = [];
      p.on("pageerror", (e) => p.__errors.push(`pageerror: ${e.message}`));
      p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && p.__errors.push(`console: ${m.text()}`));
      await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      return { c, p };
    };

    // ================================================================ AI chef — no pet yet
    const { c, p } = await mk(VIEWPORTS[0]);
    await p.getByTestId("ai-chef").waitFor();
    const chef = p.getByTestId("ai-chef");
    const tabs = await chef.locator('[data-testid="chef-tab"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-tab"), e.disabled, e.getAttribute("aria-checked")]));
    record("kitchen-chef", "desktop", "AI chef has the two modes; ‘댕냥이 특식’ is disabled while the household has no pet", JSON.stringify(tabs) === JSON.stringify([["fridge", false, "true"], ["pet", true, "false"]]), JSON.stringify(tabs));
    const sectionOrder = await p.evaluate(() => [...document.querySelectorAll('[data-testid="budget-card"], [data-testid="ai-chef"], [data-testid="local-radar"], [data-testid="kitchen-list"]')].map((e) => e.getAttribute("data-testid")));
    record("kitchen-chef", "desktop", "layout order: money log → AI chef → … → item list → 동네 생활 레이더 at the very bottom", JSON.stringify(sectionOrder) === JSON.stringify(["budget-card", "ai-chef", "kitchen-list", "local-radar"]) || JSON.stringify(sectionOrder) === JSON.stringify(["ai-chef", "kitchen-list", "local-radar"]), JSON.stringify(sectionOrder));

    // ================================================================ 동네 생활 레이더
    const radar = p.getByTestId("local-radar");
    const hrefs = await radar.locator('[data-testid="radar-chip"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-chip"), e.getAttribute("href"), e.getAttribute("target"), e.getAttribute("rel")]));
    const kakao = (q) => `https://m.map.kakao.com/actions/searchView?q=${encodeURIComponent(q)}`;
    record("kitchen-chef", "desktop", "no pet → only the 3 human chips: 대형마트 · 전통시장 · 24시 편의점, each a Kakao Map search link", hrefs.length === 3 && hrefs[0][1] === kakao("대형마트") && hrefs[1][1] === kakao("전통시장") && hrefs[2][1] === kakao("24시 편의점") && (await radar.getByTestId("radar-pet").count()) === 0, JSON.stringify(hrefs.map((h) => h[0])));
    record("kitchen-chef", "desktop", "links open a new tab safely (target=_blank, rel=noopener noreferrer) and the query is URL-encoded", hrefs.every((h) => h[2] === "_blank" && /noopener/.test(h[3] ?? "") && /noreferrer/.test(h[3] ?? "")) && hrefs[2][1].includes("%EC%B5%9C") === false && hrefs[2][1].includes("24%EC%8B%9C%20%ED%8E%B8%EC%9D%98%EC%A0%90"));
    const popupPromise = ctxPopup(c);
    await radar.locator('[data-chip="mart"]').click();
    const popup = await popupPromise;
    record("kitchen-chef", "desktop", "clicking a chip opens Kakao Map in a NEW tab (the kitchen page stays)", !!popup && /m\.map\.kakao\.com\/actions\/searchView\?q=/.test(popup.url()) && /kitchen/.test(p.url()), popup?.url());
    await popup?.close().catch(() => {});
    record("kitchen-chef", "desktop", "the radar never asks for the visitor's location (no geolocation prompt/permission use)", await p.evaluate(() => !document.body.innerHTML.includes("geolocation")) && (await p.evaluate(async () => (await navigator.permissions.query({ name: "geolocation" })).state)) !== "granted");

    // ================================================================ AI chef — fridge (AI or fallback)
    await chef.getByTestId("chef-generate").click();
    await chef.getByTestId("chef-result").waitFor({ timeout: 30_000 });
    const mocked = mock.hits.length > 0;
    const src = await chef.getByTestId("chef-result").getAttribute("data-source");
    const cards = chef.getByTestId("recipe-card");
    const titles = await cards.getByTestId("recipe-title").allInnerTexts();
    const ingChips = await chef.getByTestId("chef-ingredients").innerText();
    record("kitchen-chef", "desktop", "fridge recipes: ingredients considered are soonest-expiry first, urgent (D-3) ones marked, expired and pet items excluded", /대파 · D-2/.test(ingChips) && /계란 · D-3/.test(ingChips) && !/지난우유/.test(ingChips) && !/강아지간식/.test(ingChips) && (await chef.getByTestId("chef-expired").innerText()).includes("1개는 제외"), ingChips.replace(/\s+/g, " "));
    const order = await chef.locator('[data-testid="chef-ingredients"] > span').allInnerTexts();
    record("kitchen-chef", "desktop", "ingredient chips are listed by expiry (대파 D-2 → 계란 D-3 → …)", order.findIndex((t) => t.includes("대파")) < order.findIndex((t) => t.includes("계란")) && order.findIndex((t) => t.includes("계란")) < order.findIndex((t) => t.includes("닭가슴살")), order.join(" | "));
    record("kitchen-chef", "desktop", `recipes returned (${src === "gemini" ? "AI" : "offline fallback"}): 1–3 cards, each with time, difficulty, ingredients and 1–4 numbered steps`, titles.length >= 1 && titles.length <= 3 && (await cards.evaluateAll((els) => els.every((e) => e.querySelector('[data-testid="recipe-time"]') && e.querySelector('[data-testid="recipe-level"]') && e.querySelectorAll('[data-testid="recipe-steps"] li').length >= 1 && e.querySelectorAll('[data-testid="recipe-steps"] li').length <= 4 && (e.querySelectorAll('[data-testid="ing-have"]').length + e.querySelectorAll('[data-testid="ing-missing"]').length) >= 1))), titles.join(" | "));
    if (mocked) {
      record("kitchen-chef", "desktop", "AI mode: source ‘AI 셰프’, the AI's titles and calories shown (520kcal)", src === "gemini" && titles[0] === "AI 대파 계란 볶음밥" && (await cards.first().getByTestId("recipe-kcal").innerText()).includes("520kcal") && (await chef.getByTestId("chef-source").innerText()).includes("AI 셰프"));
      const req = mock.hits[mock.hits.length - 1].text;
      record("kitchen-chef", "desktop", "the AI prompt lists the fridge's names as quoted data, urgent first, without the expired / pet items", /재료\(데이터\): \["대파","계란"/.test(req) && !req.includes("지난우유") && !req.includes("강아지간식"), req.split("재료(데이터): ")[1]?.slice(0, 120));
    } else {
      record("kitchen-chef", "desktop", "no AI key (or not mocked): the offline recipes are served, labelled ‘기본 레시피’ with the reason", src === "fallback" && (await chef.getByTestId("chef-source").innerText()).includes("기본 레시피") && (await chef.getByTestId("chef-note").count()) === 1);
    }
    await p.screenshot({ path: `${OUT}/kitchen-chef-light-desktop.png`, fullPage: true });

    // AI failure → fallback ranked by matching ingredients
    if (mocked) {
      mock.mode = "fail";
      await chef.getByTestId("chef-generate").click();
      await p.waitForFunction(() => document.querySelector('[data-testid="chef-result"]')?.getAttribute("data-source") === "fallback", null, { timeout: 30_000 });
    }
    const fbTitles = await chef.getByTestId("recipe-title").allInnerTexts();
    record("kitchen-chef", "desktop", "fallback: named offline dishes ranked by how many of the fridge's ingredients they use (된장찌개 uses 3 of the fridge's items, so it ranks first)", fbTitles.length >= 2 && /계란|대파|두부|된장|양파/.test(fbTitles[0]), fbTitles.join(" | "));
    record("kitchen-chef", "desktop", "fallback result says why (AI unavailable) and is labelled ‘기본 레시피’", (await chef.getByTestId("chef-source").innerText()).includes("기본 레시피") && ((await chef.getByTestId("chef-note").count()) === 1 ? /AI|키|바빠/.test(await chef.getByTestId("chef-note").innerText()) : false), await chef.getByTestId("chef-note").innerText().catch(() => ""));
    const have = await cards.first().getByTestId("ing-have").allInnerTexts();
    const miss = await cards.first().getByTestId("ing-missing").allInnerTexts();
    record("kitchen-chef", "desktop", "recipe cards separate ingredients you have from the missing ones (‘… · 없음’)", have.length >= 1 && (miss.length === 0 || miss.every((m) => /없음/.test(m))), `have=${have} missing=${miss}`);

    // use up → rescued_count / saved_money
    const card0 = cards.first();
    const btn = card0.getByTestId("recipe-consume");
    const usedNames = await card0.evaluate((el) => [...el.querySelectorAll('[data-testid="ing-have"]')].map((e) => e.textContent.trim()));
    const before = await prof();
    const nBefore = (await rows()).length;
    record("kitchen-chef", "desktop", "the use-up button names the items it will consume", /이 재료들 소진 처리/.test(await btn.innerText()) && (await btn.isEnabled()));
    await btn.click();
    await card0.getByTestId("recipe-done").waitFor();
    const after = await until(async () => { const r = await prof(); return r && (!before || r.rescued_count > (before?.rescued_count ?? 0)) ? r : null; });
    const removed = nBefore - (await rows()).length;
    record("kitchen-chef", "desktop", "‘😋 이 재료들 소진 처리’ deletes exactly the recipe's fridge items and credits rescued_count + N, saved_money + 3,000원 × N", removed >= 1 && removed === usedNames.length && !!after && after.rescued_count === removed && Number(after.saved_money) === removed * 3000, `removed=${removed} used=${usedNames} prof=${JSON.stringify(after)}`);
    record("kitchen-chef", "desktop", "the unrelated items (expired milk, pet treat, other ingredients) are untouched", !!(await rowOf("지난우유")) && !!(await rowOf("강아지간식")));
    record("kitchen-chef", "desktop", "the card shows the result and the button is gone (no double use)", /절약/.test(await card0.getByTestId("recipe-done").innerText()) && (await card0.getByTestId("recipe-consume").count()) === 0);
    await p.waitForFunction(() => /원/.test(document.querySelector('[data-pulse="saved"] [data-testid="pulse-value"]')?.textContent ?? "") && document.querySelector('[data-pulse="saved"] [data-testid="pulse-value"]')?.textContent?.trim() !== "0원");
    record("kitchen-chef", "desktop", "the KitchenPulse saved tile updates to the new total", (await p.locator('[data-pulse="saved"] [data-testid="pulse-value"]').innerText()).trim() === `${(removed * 3000).toLocaleString("ko-KR")}원`);

    // ================================================================ pet household
    await p.locator('[data-testid="pet-setting"] [data-pet="dog"]').click();
    await p.waitForFunction(() => !document.querySelector('[data-testid="chef-tab"][data-tab="pet"]')?.disabled);
    const petRadar = await radar.locator('[data-testid="radar-pet"] [data-testid="radar-chip"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-chip"), e.getAttribute("href")]));
    record("kitchen-chef", "desktop", "pet household: 3 extra chips — 🚨 24시 동물병원 · 동네 동물병원 · 펫용품점 (Kakao search links); the human chips stay", petRadar.length === 3 && petRadar[0][1] === kakao("24시 동물병원") && petRadar[1][1] === kakao("동물병원") && petRadar[2][1] === kakao("반려동물용품") && (await radar.getByTestId("radar-human").locator("a").count()) === 3, JSON.stringify(petRadar.map((x) => x[0])));
    record("kitchen-chef", "desktop", "the urgent vet chip is rose-styled", /rgb\(190, 18, 60\)|rgb\(159, 18, 57\)|rgb\(225, 29, 72\)|rgb\(244, 63, 94\)/.test(await radar.locator('[data-chip="vet24"]').evaluate((el) => getComputedStyle(el).color)), await radar.locator('[data-chip="vet24"]').evaluate((el) => getComputedStyle(el).color));

    await chef.locator('[data-testid="chef-tab"][data-tab="pet"]').click();
    record("kitchen-chef", "desktop", "pet tab shows the 0%-salt note and its own generate button", (await chef.getByTestId("pet-rule-note").count()) === 1 && /소금·기름·양념 없이/.test(await chef.getByTestId("pet-rule-note").innerText()) && /댕냥이 특식 만들기/.test(await chef.getByTestId("chef-generate").innerText()));
    if (mocked) mock.mode = "ok";
    await chef.getByTestId("chef-generate").click();
    await chef.getByTestId("chef-result").waitFor({ timeout: 30_000 });
    const petCards = chef.getByTestId("recipe-card");
    const petText = (await petCards.allInnerTexts()).join(" ").replace(/\s+/g, "");
    const toxic = ["양파", "대파", "쪽파", "마늘", "부추", "포도", "건포도", "초콜릿", "초콜렛", "코코아", "아보카도", "자일리톨", "마카다미아", "커피", "맥주", "와인"];
    record("kitchen-chef", "desktop", "pet recipes contain NO toxic food anywhere (cards render 닭가슴살·단호박 …, never 양파·대파·마늘 from the fridge)", (await petCards.count()) >= 1 && !toxic.some((t) => petText.includes(t)), petText.slice(0, 160));
    record("kitchen-chef", "desktop", "pet recipes: 0% salt note on each card, no condiments, boiled/steamed, last step says to cool before serving, small first portions", (await petCards.evaluateAll((els) => els.every((e) => e.querySelector('[data-testid="recipe-condiments"]') === null && /염분 0%/.test(e.textContent) && /삶|쪄|찜/.test(e.querySelector('[data-testid="recipe-steps"]').textContent) && /식혀/.test([...e.querySelectorAll('[data-testid="recipe-steps"] li')].pop().textContent) && /소량/.test(e.textContent)))), petText.slice(0, 120));
    const usedPet = await chef.getByTestId("chef-ingredients").innerText();
    record("kitchen-chef", "desktop", "only PET_SAFE fridge items were considered (닭가슴살, 단호박; not 대파·양파·두부 humans' items or pet treats)", /닭가슴살/.test(usedPet) && /단호박/.test(usedPet) && !/양파|대파|강아지간식|지난우유/.test(usedPet), usedPet.replace(/\s+/g, " "));
    if (mocked) {
      record("kitchen-chef", "desktop", "AI pet mode: the AI's recipe is shown only after the safety gate (its ‘소금 1꼬집’ condiment was dropped)", (await chef.getByTestId("chef-result").getAttribute("data-source")) === "gemini" && (await petCards.count()) === 1 && (await petCards.first().getByTestId("recipe-condiments").count()) === 0 && /AI 닭가슴살 단호박 찜/.test(await petCards.first().innerText()));
      record("kitchen-chef", "desktop", "the pet prompt carries the 0%-salt rules and ONLY pet-safe names (계란·닭가슴살·단호박 — no 대파/양파/두부 from the fridge), soonest expiry first", /염분\(소금·간장·된장·고추장 등\) 0%/.test(mock.hits[mock.hits.length - 1].text) && /재료\(데이터\): \["계란","닭가슴살","단호박"\]/.test(mock.hits[mock.hits.length - 1].text), mock.hits[mock.hits.length - 1].text.split("재료(데이터): ")[1]);
      mock.mode = "petunsafe";
      await chef.getByTestId("chef-generate").click();
      await p.waitForFunction(() => document.querySelector('[data-testid="chef-result"]')?.getAttribute("data-source") === "fallback", null, { timeout: 30_000 });
      const safeText = (await chef.getByTestId("recipe-card").allInnerTexts()).join(" ").replace(/\s+/g, "");
      record("kitchen-chef", "desktop", "an AI pet recipe with onion is REJECTED by the gate → safe offline specials are shown instead", !safeText.includes("양파") && (await chef.getByTestId("chef-source").innerText()).includes("기본 레시피") && /닭가슴살/.test(safeText));
      mock.mode = "ok";
    }
    // no safe ingredients at all
    await svc.from("kitchen_items").delete().eq("household_id", H2).in("name", ["닭가슴살", "단호박", "계란"]);
    await p.reload({ waitUntil: "networkidle" });
    await p.getByTestId("ai-chef").waitFor();
    await p.locator('[data-testid="chef-tab"][data-tab="pet"]').click();
    await p.getByTestId("chef-generate").click();
    await p.getByTestId("chef-note").waitFor({ timeout: 30_000 });
    record("kitchen-chef", "desktop", "no feedable ingredient in the fridge → basic specials as a shopping idea, with an explanation", /급여할 수 있는 재료가 없어/.test(await p.getByTestId("chef-note").innerText()) && (await p.getByTestId("recipe-card").count()) >= 1 && (await p.getByTestId("recipe-card").first().getByTestId("recipe-consume").isDisabled()));
    // pet set back to none: the server refuses pet recipes
    await p.locator('[data-testid="pet-setting"] [data-pet="none"]').click();
    await p.waitForFunction(() => document.querySelector('[data-testid="chef-tab"][data-tab="pet"]')?.disabled === true);
    record("kitchen-chef", "desktop", "pet set back to 없음 → the pet tab is disabled again and the pet radar chips disappear", (await radar.getByTestId("radar-pet").count()) === 0);

    // server-side guard (not only the UI): the page still believes the household has a dog, the DB says it has none
    await svc.from("kitchen_items").insert([seed("닭가슴살", "FRIDGE", shift(6))]);
    await svc.from("kitchen_profiles").update({ pet_type: "dog" }).eq("household_id", H2);
    await p.reload({ waitUntil: "networkidle" });
    await p.getByTestId("ai-chef").waitFor();
    await p.locator('[data-testid="chef-tab"][data-tab="pet"]').click();
    await svc.from("kitchen_profiles").update({ pet_type: "none" }).eq("household_id", H2);
    await p.getByTestId("chef-generate").click();
    await p.getByTestId("chef-error").waitFor({ timeout: 30_000 });
    record("kitchen-chef", "desktop", "server guard: a pet request from a household that has no pet (stale page) is refused (‘반려동물을 먼저 설정’)", /반려동물을 먼저 설정/.test(await p.getByTestId("chef-error").innerText()), await p.getByTestId("chef-error").innerText());

    // empty fridge
    await svc.from("kitchen_items").delete().eq("household_id", H2);
    await p.reload({ waitUntil: "networkidle" });
    await p.getByTestId("ai-chef").waitFor();
    record("kitchen-chef", "desktop", "empty fridge: the fridge-recipe button is disabled with a hint instead of calling the AI", (await p.getByTestId("chef-generate").isDisabled()) && /재료를 추가하면/.test(await p.getByTestId("ai-chef").innerText()));
    record("kitchen-chef", "desktop", "no console/page errors in the chef/radar flow", p.__errors.length === 0, p.__errors.slice(0, 2).join(" | "));
    await c.close();

    // ================================================================ 가전 자산 딥링크 (fridge chip on /assets)
    await svc.from("kitchen_items").insert([seed("대파", "FRIDGE", shift(1)), seed("우유", "FRIDGE", shift(2)), seed("계란", "FRIDGE", shift(3)), seed("두부", "FRIDGE", shift(20)), seed("라면", "ROOM_TEMP", shift(100)), seed("지난빵", "ROOM_TEMP", shift(-1))]);
    const mkAsset = (name, category, extra = {}) => ({ household_id: H2, owner_id: strangerId, visibility: "FAMILY", name, category, space: "주방", ...extra });
    const ins = await svc.from("assets").insert([mkAsset(`삼성 냉장고${rand}`, "냉장고"), mkAsset(`딤채 김치냉장고${rand}`, "주방가전"), mkAsset(`미니 냉동고${rand}`, null), mkAsset(`로봇청소기${rand}`, "청소가전")]).select("id, name");
    if (ins.error) throw new Error(`asset fixture failed: ${ins.error.message}`);
    for (const [vp, scheme] of [[VIEWPORTS[0], "light"], [VIEWPORTS[0], "dark"], [VIEWPORTS[1], "light"], [VIEWPORTS[1], "dark"]]) {
      const { c: ac, p: ap } = await mk(vp, scheme, "/assets");
      await ap.locator("li", { hasText: `삼성 냉장고${rand}` }).waitFor();
      const tag = `${scheme}/${vp.name}`;
      const li = (n) => ap.locator("li").filter({ hasText: `${n}${rand}` });
      if (scheme === "light" && vp.name === "desktop") {
        const chip = li("삼성 냉장고").getByTestId("fridge-chip");
        record("kitchen-chef", vp.name, "fridge asset (category ‘냉장고’) shows ‘보관 6개 (임박 4개)’: D-1, D-2, D-3 and the already-expired bread count as imminent", (await chip.innerText()).replace(/\s+/g, " ").trim() === "보관 6개 (임박 4개)", await chip.innerText());
        record("kitchen-chef", vp.name, "name-based detection: ‘김치냉장고’ and ‘냉동고’ assets get the chip too; the robot vacuum does not", (await li("딤채 김치냉장고").getByTestId("fridge-chip").count()) === 1 && (await li("미니 냉동고").getByTestId("fridge-chip").count()) === 1 && (await li("로봇청소기").getByTestId("fridge-chip").count()) === 0 && (await ap.getByTestId("fridge-chip").count()) === 3);
        record("kitchen-chef", vp.name, "urgent chip is amber-tinted with a warning icon", (await chip.getAttribute("data-urgent")) === "4" && (await chip.locator("svg").count()) === 2 && lum(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)) > 0.9);
        const fridgeId = ins.data.find((a) => a.name.startsWith("삼성"))?.id;
        await chip.click();
        await ap.waitForURL(/\/kitchen/, { timeout: 15_000 });
        await ap.getByTestId("kitchen-pulse").waitFor();
        record("kitchen-chef", vp.name, "clicking the chip navigates to /kitchen (client-side deep link, page renders)", new URL(ap.url()).pathname === "/kitchen" && (await ap.getByTestId("kitchen-pulse").count()) === 1 && !!fridgeId);
        await ap.goBack();
        await ap.locator("li", { hasText: `삼성 냉장고${rand}` }).waitFor();
      }
      const w = await ap.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const cbg = await li("삼성 냉장고").getByTestId("fridge-chip").evaluate((el) => getComputedStyle(el).backgroundColor);
      record("kitchen-chef", vp.name, `${tag}: assets page with fridge chips has no horizontal scroll; chip follows the theme`, w && (scheme === "dark" ? lum(cbg) < 0.2 : lum(cbg) > 0.85), cbg);
      await ap.screenshot({ path: `${OUT}/assets-fridge-chip-${scheme}-${vp.name}.png`, fullPage: true });
      record("kitchen-chef", vp.name, `${tag}: no page errors on /assets`, ap.__errors.length === 0, ap.__errors.slice(0, 2).join(" | "));
      await ac.close();
    }
    // a household with no kitchen items still gets a chip (0개), and one with the kitchen unreadable simply hides it (covered by the null path)
    await svc.from("kitchen_items").delete().eq("household_id", H2);
    {
      const { c: zc, p: zp } = await mk(VIEWPORTS[0], "light", "/assets");
      await zp.locator("li", { hasText: `삼성 냉장고${rand}` }).waitFor();
      record("kitchen-chef", "desktop", "empty kitchen: the fridge chip reads ‘보관 0개’ (no warning)", (await zp.locator("li", { hasText: `삼성 냉장고${rand}` }).getByTestId("fridge-chip").innerText()).trim() === "보관 0개");
      await zc.close();
    }

    // ================================================================ light/dark × desktop/mobile captures of the chef + radar
    await svc.from("kitchen_profiles").upsert({ household_id: H2, pet_type: "cat" }, { onConflict: "household_id" });
    await svc.from("kitchen_items").insert([seed("대파", "FRIDGE", shift(2)), seed("계란", "FRIDGE", shift(3)), seed("닭가슴살", "FRIDGE", shift(5))]);
    for (const scheme of ["light", "dark"]) {
      for (const vp of VIEWPORTS) {
        const { c: kc, p: kp } = await mk(vp, scheme);
        const tag = `${scheme}/${vp.name}`;
        await kp.getByTestId("ai-chef").waitFor();
        await kp.getByTestId("chef-generate").click();
        await kp.getByTestId("chef-result").waitFor({ timeout: 30_000 });
        await kp.waitForTimeout(300);
        record("kitchen-chef", vp.name, `${tag}: chef cards + radar fit the viewport (no horizontal scroll, cards inside the section)`, (await kp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && (await kp.getByTestId("ai-chef").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)) && (await kp.getByTestId("local-radar").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)));
        const cols = await kp.getByTestId("chef-result").locator(".grid").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
        record("kitchen-chef", vp.name, `${tag}: recipe grid is ${vp.name === "mobile" ? "1 column" : "3 columns"}`, cols === (vp.name === "mobile" ? 1 : 3), String(cols));
        const bg = await kp.getByTestId("ai-chef").evaluate((el) => getComputedStyle(el).backgroundColor);
        record("kitchen-chef", vp.name, `${tag}: sections follow the theme`, scheme === "dark" ? lum(bg) < 0.1 : lum(bg) > 0.8, bg);
        await kp.getByTestId("local-radar").scrollIntoViewIfNeeded();
        await kp.screenshot({ path: `${OUT}/kitchen-chef-${scheme}-${vp.name}.png`, fullPage: true });
        record("kitchen-chef", vp.name, `${tag}: no page errors`, kp.__errors.length === 0, kp.__errors.slice(0, 2).join(" | "));
        await kc.close();
      }
    }
  } catch (err) {
    if (/kitchen tables missing/.test(String(err))) record("kitchen-chef", "-", "kitchen tables available (migration 14)", false, "tables missing");
    else record("kitchen-chef", "-", "chef/radar suite ran to completion", false, String(err?.stack ?? err).slice(0, 500));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (H2) {
      await svc.from("assets").delete().eq("household_id", H2);
      for (const t of ["kitchen_items", "kitchen_shopping_items", "kitchen_expenses", "kitchen_profiles"]) await svc.from(t).delete().eq("household_id", H2);
      await svc.from("profiles").delete().eq("household_id", H2);
      await svc.from("households").delete().eq("id", H2);
    }
    if (strangerId) await svc.auth.admin.deleteUser(strangerId);
  }
}
// helper used above: resolves with the next popup page opened from any page of the context
function ctxPopup(context) { return new Promise((resolve) => { const t = setTimeout(() => resolve(null), 8000); context.once("page", (pg) => { clearTimeout(t); resolve(pg); }); }); }

// ---------------------------------------------------------------- global footer (CookSaver heritage) + legal pages
{
  const pages = ["/assets", "/timeline", "/kitchen", "/analytics"];
  for (const vp of VIEWPORTS) {
    const ctx = await newContext(vp, storageState);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
    const present = [];
    for (const path of pages) {
      await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      present.push([path, await p.getByTestId("app-footer").count()]);
    }
    record("footer", vp.name, "the footer renders exactly once on every main page (/assets, /timeline, /kitchen, /analytics)", present.every(([, n]) => n === 1), JSON.stringify(present));

    await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const f = p.getByTestId("app-footer");
    const txt = (await f.innerText()).replace(/\s+/g, " ");
    record("footer", vp.name, "content: ‘MyLife Hub × CookSaver’ + slogan ‘우리 집 스마트 키친 & 가전 자산 케어 OS’", txt.includes("MyLife Hub × CookSaver") && txt.includes("우리 집 스마트 키친 & 가전 자산 케어 OS"), txt.slice(0, 80));
    record("footer", vp.name, "pet-safety notice: reference only, go to a 24-hour animal hospital in an emergency", /반려동물 독성 및 레시피 정보는 참고용이며, 응급 상황 시 즉시 24시 동물병원을 방문하세요/.test(await f.getByTestId("footer-pet-notice").innerText()));
    record("footer", vp.name, "household isolation (RLS) notice, privacy + terms links, ‘© 2026 MyLife Hub. All rights reserved.’ and the version", /가구 단위로 격리\(RLS\)/.test(txt) && (await f.getByTestId("footer-privacy").getAttribute("href")) === "/privacy" && (await f.getByTestId("footer-terms").getAttribute("href")) === "/terms" && /© 2026 MyLife Hub\. All rights reserved\. · v\d+\.\d+\.\d+/.test(txt), txt.slice(-70));

    const style = await f.evaluate((el) => {
      const link = el.querySelector('[data-testid="footer-privacy"]');
      const brand = el.querySelector("p");
      const cs = getComputedStyle(el);
      return { bt: cs.borderTopWidth, bc: cs.borderTopColor, linkColor: getComputedStyle(link).color, brandColor: getComputedStyle(brand).color };
    });
    record("footer", vp.name, "tone: quiet slate-500 text/links (AA contrast) on the off-white page, a soft slate-100 hairline on top (not a hard black rule)", style.linkColor === "rgb(100, 116, 139)" && style.bt === "1px" && style.bc === "rgb(241, 245, 249)", JSON.stringify(style));
    await f.getByTestId("footer-privacy").hover();
    await p.waitForTimeout(250);
    record("footer", vp.name, "link hover turns slate-700", (await f.getByTestId("footer-privacy").evaluate((el) => getComputedStyle(el).color)) === "rgb(51, 65, 85)");

    if (vp.name === "mobile") {
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(300);
      const geo = await p.evaluate(() => {
        const f = document.querySelector('[data-testid="app-footer"]');
        const nav = [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].find((n) => getComputedStyle(n).position === "fixed");
        const last = f.querySelector("p:last-of-type").getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        return { lastBottom: last.bottom, navTop: n.top, pb: parseFloat(getComputedStyle(f).paddingBottom), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
      });
      record("footer", vp.name, "at the very bottom of the page the footer's last line sits ABOVE the fixed 4-tab bar (not hidden behind it)", geo.lastBottom <= geo.navTop, JSON.stringify(geo));
      record("footer", vp.name, "mobile bottom padding clears the tab bar (≥ 96px = pb-24) and there is no horizontal scroll", geo.pb >= 96 && geo.scrollW <= geo.innerW, JSON.stringify(geo));
      // tapping a tab while scrolled to the bottom still works (the footer never intercepts the bar)
      const tab = p.locator('nav[aria-label="주요 메뉴"]').last().getByRole("link", { name: "리포트" });
      await tab.click();
      await p.waitForURL(/\/analytics/, { timeout: 15_000 });
      record("footer", vp.name, "tapping the 리포트 tab from the bottom of /assets navigates normally (no overlap / blocked tap)", new URL(p.url()).pathname === "/analytics");
      const fp = await p.getByTestId("app-footer").boundingBox();
      await p.evaluate(() => window.scrollTo(0, 0));
      record("footer", vp.name, "the footer follows the page content (below the main content, not floating over it)", !!fp);
    } else {
      const geo = await f.evaluate((el) => ({ pb: parseFloat(getComputedStyle(el).paddingBottom), top: el.getBoundingClientRect().top + window.scrollY, doc: document.documentElement.scrollHeight }));
      record("footer", vp.name, "desktop: compact 32px bottom padding (md:pb-8), footer sits at the end of the document", geo.pb === 32 && Math.abs(geo.top + (await f.evaluate((el) => el.getBoundingClientRect().height)) - geo.doc) <= 2, JSON.stringify(geo));
    }
    await p.screenshot({ path: `${OUT}/footer-light-${vp.name}.png`, fullPage: true });
    record("footer", vp.name, "no console/page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }

  // dark mode
  {
    const c = await browser.newContext({ viewport: { width: 375, height: 812 }, storageState, locale: "ko-KR", colorScheme: "dark" });
    await c.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
    const p = await c.newPage();
    await p.goto(`${BASE}/kitchen`, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const col = await p.getByTestId("footer-privacy").evaluate((el) => getComputedStyle(el).color);
    record("footer", "mobile", "dark theme: footer links stay quiet but readable (zinc-500 on the dark page)", col === "rgb(113, 113, 122)", col);
    await p.screenshot({ path: `${OUT}/footer-dark-mobile.png`, fullPage: true });
    await c.close();
  }

  // legal pages are public and readable
  {
    const c = await newContext(VIEWPORTS[0]);
    const p = await c.newPage();
    for (const [path, title] of [["/privacy", "개인정보 처리방침"], ["/terms", "이용약관"]]) {
      const r = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      record("footer", "desktop", `${path} opens WITHOUT login (200, no redirect) with its title and a way back`, r.status() === 200 && new URL(p.url()).pathname === path && (await p.getByTestId("legal-title").innerText()) === title && (await p.getByRole("link", { name: /앱으로 돌아가기/ }).count()) === 1 && (await p.title()).includes(title), `${r.status()} ${p.url()}`);
    }
    await p.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
    const body = await p.locator("main").innerText();
    record("footer", "desktop", "privacy page states the real behaviour: household isolation, Gemini photo transfer (not stored), no location use", /가구 단위로 격리/.test(body) && /Google Gemini/.test(body) && /저장하지 않아요/.test(body) && /위치를 묻거나 저장하지 않아요/.test(body));
    await c.close();
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
