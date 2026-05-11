// Browser smoke for the M1 landing + setup wizard.
//
// Walks: landing → click "Set it up" → wizard steps 1, 5, 6.
// Asserts provider-switch behavior in step 5, brand → ?welcome=1 nav,
// returning-user redirect logic, and zero console errors throughout.
//
// Skips the FS Access folder picker (no API to dismiss an OS dialog
// from Playwright). That portion still requires manual testing.
//
// Usage:
//   1. npm run dev    (or another server on $MARGINS_URL)
//   2. node scripts/smoke-landing.mjs
//
// One-time setup:
//   npx playwright install chromium

import { chromium } from "playwright-core";

const URL = process.env.MARGINS_URL || "http://localhost:5173/";
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

function summary() {
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.ok) {
      console.log(`  ✓ ${c.name}`);
      pass += 1;
    } else {
      console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
      fail += 1;
    }
  }
  console.log("");
  console.log(`Result: ${pass} passed / ${fail} failed`);
  return fail === 0;
}

async function quickHttpCheck() {
  try {
    const r = await fetch(URL);
    if (!r.ok) {
      console.error(`[smoke] HTTP ${URL} returned ${r.status}`);
      return false;
    }
    const html = await r.text();
    if (!html.includes("<title>Margins</title>")) {
      console.error("[smoke] Did not look like the Margins landing.");
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[smoke] HTTP check failed: ${err.message}`);
    console.error("[smoke] Start `npm run dev` first.");
    return false;
  }
}

async function main() {
  if (!await quickHttpCheck()) process.exit(2);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`[smoke] Could not launch Chromium: ${err.message}`);
    console.error("[smoke] Run: npx playwright install chromium");
    process.exit(1);
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
  });

  try {
    // ── 1. Landing renders ───────────────────────────────────────────
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("section.hero", { timeout: 5000 });
    check("Landing hero renders", true);

    const heroTitle = (await page.locator(".hero-title").first().textContent()) || "";
    check(
      "Hero title contains 'brilliant'",
      heroTitle.includes("brilliant"),
      `got: "${heroTitle.slice(0, 80)}"`
    );

    // Demo-nav must be absent
    const demoNavCount = await page.locator(".demo-nav").count();
    check("Demo-nav (Landing/Setup/App pills) absent", demoNavCount === 0);

    // Hero CTAs
    const heroBtnTexts = (await page.locator(".hero-cta-row .cta").allTextContents()).map(
      (t) => t.trim()
    );
    check("Hero primary 'Set it up'", heroBtnTexts.includes("Set it up"));
    check("Hero ghost 'Open Margins'", heroBtnTexts.includes("Open Margins"));

    // Hero meta line
    const heroMeta = (await page.locator(".hero-meta").first().textContent()) || "";
    check("Hero meta says 'Bring your own AI key'", heroMeta.includes("Bring your own AI key"));
    check("Hero meta NOT 'Uses your Claude subscription'", !heroMeta.includes("Claude subscription"));

    // ── 2. Click "Set it up" → wizard visible ────────────────────────
    await page.locator('.hero-cta-row button.cta.large:has-text("Set it up")').click();
    await page.waitForSelector('section.wizard[id="wizard"]', { state: "visible", timeout: 3000 });
    const step1Visible = await page.locator('.step[data-step="1"]').isVisible();
    check("Wizard step 1 visible after 'Set it up'", step1Visible);

    const step1Label = (await page.locator('.step[data-step="1"] .step-label').textContent()) || "";
    check("Step 1 label is 'Step 1 of 6'", step1Label.includes("Step 1 of 6"));

    // Template cards present (4 from prototype)
    const cardCount = await page.locator(".template-card").count();
    check("Step 1 renders 4 template cards", cardCount === 4, `got ${cardCount}`);

    // ── 3. Jump to step 5 via the wizard's own showStep() ────────────
    await page.evaluate(() => window.showStep(5));
    await page.waitForSelector(
      '.step[data-step="5"]:not([style*="display:none"])',
      { timeout: 2000 }
    );
    const step5Title = (await page.locator('.step[data-step="5"] .step-title').textContent()) || "";
    check(
      "Step 5 title 'Bring your own AI key.'",
      step5Title.includes("Bring your own AI key"),
      `got: "${step5Title}"`
    );
    check("Step 5 NOT 'Sign in with your AI'", !step5Title.includes("Sign in with"));

    // Form fields present
    check("Provider select present", await page.locator("#setup-provider").count() === 1);
    check("Model input present", await page.locator("#setup-model").count() === 1);
    check("API key input present", await page.locator("#setup-api-key").count() === 1);
    check("'Get a key' link present", await page.locator("#setup-key-link").count() === 1);

    // Default provider is Gemini
    const defaultProvider = await page.locator("#setup-provider").inputValue();
    check("Default provider is 'gemini'", defaultProvider === "gemini");
    const defaultPlaceholder = await page.locator("#setup-model").getAttribute("placeholder");
    check(
      "Default model placeholder is 'gemini-2.5-flash'",
      defaultPlaceholder === "gemini-2.5-flash",
      `got: "${defaultPlaceholder}"`
    );
    const defaultLink = (await page.locator("#setup-key-link").textContent()) || "";
    check("Default key link mentions Gemini", defaultLink.toLowerCase().includes("gemini"));

    // ── 4. Provider swap behavior ────────────────────────────────────
    await page.locator("#setup-provider").selectOption("openai");
    const oaPlaceholder = await page.locator("#setup-model").getAttribute("placeholder");
    check(
      "OpenAI placeholder is 'gpt-5-mini'",
      oaPlaceholder === "gpt-5-mini",
      `got: "${oaPlaceholder}"`
    );
    const oaLink = (await page.locator("#setup-key-link").textContent()) || "";
    check("OpenAI key link mentions OpenAI", oaLink.toLowerCase().includes("openai"));

    await page.locator("#setup-provider").selectOption("anthropic");
    const anPlaceholder = await page.locator("#setup-model").getAttribute("placeholder");
    check(
      "Anthropic placeholder is 'claude-3-5-haiku-latest'",
      anPlaceholder === "claude-3-5-haiku-latest",
      `got: "${anPlaceholder}"`
    );
    const anLink = (await page.locator("#setup-key-link").textContent()) || "";
    check("Anthropic key link mentions Anthropic", anLink.toLowerCase().includes("anthropic"));

    // Switch back to Gemini
    await page.locator("#setup-provider").selectOption("gemini");
    // Type a value into the key field — verify it lands in window.state.api.apiKey
    await page.locator("#setup-api-key").fill("test-key-do-not-use");
    const apiKeyInState = await page.evaluate(() => window.state?.api?.apiKey || null);
    check(
      "Typed API key reaches window.state.api.apiKey",
      apiKeyInState === "test-key-do-not-use",
      `got: ${apiKeyInState}`
    );

    // ── 5. Step 6 renders ────────────────────────────────────────────
    await page.evaluate(() => window.showStep(6));
    await page.waitForSelector('.step[data-step="6"]:not([style*="display:none"])', { timeout: 2000 });
    const step6Btn = (await page.locator("#open-margins-btn").textContent()) || "";
    check("Step 6 'Open Margins' button present", step6Btn.includes("Open Margins"));
    check(
      "Step 6 status element present",
      await page.locator("#open-margins-status").count() === 1
    );

    // ── 6. Returning-user redirect logic ─────────────────────────────
    // No setup flag yet → no redirect.
    await page.evaluate(() => localStorage.removeItem("margins.setupCompleted.v1"));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400); // give the IIFE time to maybe redirect
    const noFlagUrl = page.url();
    check(
      "With no setup flag, landing stays on /",
      !noFlagUrl.includes("app.html"),
      `url: ${noFlagUrl}`
    );

    // Set flag → still no redirect because IndexedDB has no handle.
    await page.evaluate(() => localStorage.setItem("margins.setupCompleted.v1", "1"));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const flagOnlyUrl = page.url();
    check(
      "Flag set + no IndexedDB handle → stays on landing (gracefully)",
      !flagOnlyUrl.includes("app.html"),
      `url: ${flagOnlyUrl}`
    );

    // ?welcome=1 must suppress redirect even with flag set
    await page.goto(`${URL.replace(/\/$/, "")}/?welcome=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const welcomeUrl = page.url();
    check(
      "?welcome=1 keeps user on landing regardless of flag",
      welcomeUrl.includes("welcome=1") && !welcomeUrl.includes("app.html"),
      `url: ${welcomeUrl}`
    );

    // ── 7. App.html structure + brand link ───────────────────────────
    const appUrl = `${URL.replace(/\/$/, "")}/app.html`;
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 3000 });
    const brandHref = await page.locator("a.brand").getAttribute("href");
    check(
      "App brand link → ./?welcome=1",
      brandHref === "./?welcome=1",
      `got: "${brandHref}"`
    );

    // Drop zone has both default + connect modes
    check(
      "Drop zone has default copy block",
      await page.locator("#drop-copy-default").count() === 1
    );
    check(
      "Drop zone has connect-mode copy block",
      await page.locator("#drop-copy-connect").count() === 1
    );
    check(
      "Connect-mode CTA button present",
      await page.locator("#connect-prompt-btn").count() === 1
    );
    // API gate (hard modal) replaces the old soft no-key banner
    check("API gate modal exists in DOM", await page.locator("#api-gate").count() === 1);
    check("Gate form has provider/model/key inputs",
      await page.locator("#gate-provider").count() === 1 &&
      await page.locator("#gate-model").count() === 1 &&
      await page.locator("#gate-api-key").count() === 1);
    check("Gate has spend-limit fields",
      await page.locator("#gate-max-request-usd").count() === 1 &&
      await page.locator("#gate-max-session-usd").count() === 1 &&
      await page.locator("#gate-max-output-tokens").count() === 1);
    check(
      "Old no-key banner removed",
      await page.locator("#no-key-banner").count() === 0
    );
    check(
      "Reconnect banner removed (replaced by drop-zone mode)",
      await page.locator("#reconnect-banner").count() === 0
    );

    // ── 8. No console errors anywhere ────────────────────────────────
    check(
      `No console errors across walkthrough`,
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : ""
    );
  } catch (err) {
    check("Walkthrough completed without exception", false, err.message);
  } finally {
    await browser.close();
  }

  const ok = summary();
  process.exit(ok ? 0 : 3);
}

main();
