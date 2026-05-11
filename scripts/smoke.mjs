// Browser smoke test for Margins after a refactor commit.
// Walks all 7 tabs, captures any console errors, exits non-zero if any.
//
// Usage:
//   1. Make sure `npm run dev` is running (port 5173)
//   2. node scripts/smoke.mjs
//
// Default URL is /app.html — the functional Margins app. The landing
// + wizard at / are covered by scripts/smoke-landing.mjs.
//
// One-time setup (if Chromium isn't installed):
//   npx playwright install chromium
//
// Exit codes:
//   0 — all tabs render without console errors
//   1 — Playwright Chromium not installed (run the npx command above)
//   2 — page didn't reach loaded state (server not running?)
//   3 — console errors found (printed to stderr)

import { chromium } from "playwright-core";

const URL = process.env.MARGINS_URL || "http://localhost:5173/app.html";
const TABS = ["inbox", "dream", "entities", "wiki", "graph", "llm", "ops"];

async function quickHttpCheck() {
  // Fast first-pass check: does the server return index.html?
  try {
    const r = await fetch(URL);
    if (!r.ok) {
      console.error(`[smoke] HTTP check: ${URL} returned ${r.status}`);
      return false;
    }
    const html = await r.text();
    if (!html.includes("<title>Margins</title>")) {
      console.error("[smoke] HTTP check: index.html doesn't look like Margins");
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[smoke] HTTP check failed: ${err.message}`);
    console.error("[smoke] Start the dev server with `npm run dev` first.");
    return false;
  }
}

const httpOk = await quickHttpCheck();
if (!httpOk) process.exit(2);

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(`[smoke] Could not launch Chromium: ${err.message.split("\n")[0]}`);
  console.error("[smoke] Run `npx playwright install chromium` once, then retry.");
  process.exit(1);
}

const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on("pageerror", (err) => {
  errors.push(`pageerror: ${err.message}`);
});
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (text.includes("favicon.ico")) return; // known noise
  errors.push(`console.error: ${text}`);
});

try {
  await page.goto(URL, { waitUntil: "load", timeout: 8000 });
} catch (err) {
  console.error(`[smoke] Page didn't reach loaded state: ${err.message}`);
  await browser.close();
  process.exit(2);
}

// Give .env hydration + initial renders time to complete
await page.waitForTimeout(1500);

for (const tab of TABS) {
  const found = await page.evaluate((view) => {
    const btn = document.querySelector(`[data-view="${view}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, tab);
  if (!found) {
    console.error(`[smoke] Warning: tab "${tab}" button not found`);
    continue;
  }
  await page.waitForTimeout(200);
}

await browser.close();

if (errors.length === 0) {
  console.log(`[smoke] OK — all ${TABS.length} tabs walked, no console errors`);
  process.exit(0);
}

console.error(`[smoke] FAIL — ${errors.length} console error${errors.length === 1 ? "" : "s"}:`);
for (const err of errors) console.error("  " + err);
process.exit(3);
