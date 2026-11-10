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
        const allActive = await page.getByRole("group", { name: "필터" }).getByRole("button", { name: /^전체/ }).evaluate((el) => el.className.includes("bg-slate-900"));
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
      record("theme", "desktop", `system ${scheme}: html.dark=${scheme === "dark"} and page background is ${scheme === "dark" ? "pure black" : "white"}`, info.dark === (scheme === "dark") && info.wrap === (scheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)"), JSON.stringify(info));
      record("theme", "desktop", `system ${scheme}: no hydration / console errors`, errs.length === 0, errs.join(" | ").slice(0, 200));
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
      record("theme", "desktop", "header is sticky glass (backdrop blur + translucent bg + 1px border)", await p.locator("header").evaluate((h) => { const s = getComputedStyle(h); return s.position === "sticky" && /blur/.test(s.backdropFilter) && s.borderBottomWidth === "1px" && /rgba/.test(s.backgroundColor); }));
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
              const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const v = parse(getComputedStyle(e).backgroundColor); if (v.length >= 3 && (v[3] === undefined || v[3] > 0.9)) return v; } return [255, 255, 255]; };
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
