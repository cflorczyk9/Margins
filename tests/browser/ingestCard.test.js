import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

const rootDir = path.resolve(import.meta.dirname, "../..");
const chromePath = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium"
].find((candidate) => existsSync(candidate));
const shouldRunBrowser = process.env.MARGINS_BROWSER_TEST === "1" && chromePath;

test("ingest card expands summaries and persists question answers", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const fullSummary = [
      "This uploaded source summarizes a phone call about an investment idea, the people involved, and why the note should be filed for later recall.",
      "It includes context about the opportunity, potential diligence questions, and next actions that should connect back to the user's existing wiki.",
      "The full summary should be visible when expanded and should not retain a fake trailing ellipsis."
    ].join(" ");

    await page.evaluate((summary) => {
      window.__marginsTest.seedIngestCard({
        summary,
        questions: [
          {
            question: "Should this become a follow-up task?",
            options: ["Yes", "No", "Skip"],
            recommendation: "My take: yes, if this needs another conversation."
          }
        ]
      });
    }, fullSummary);

    await page.getByRole("button", { name: "Show more" }).click();
    const expandedSummary = await page.locator(".run-summary p").innerText();
    assert.equal(expandedSummary, fullSummary);
    assert.equal(expandedSummary.endsWith("..."), false);

    await page.locator(".run-question .quick-answer", { hasText: "Yes" }).click();
    await assertSelected(page, "Yes");
    await assertAnswered(page, "Answered: Yes");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("vault raw sources without source notes appear in the pending inbox", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const pendingNames = await page.evaluate(() => window.__marginsTest.seedVaultPendingSources());
    assert.deepEqual(pendingNames, ["unfiled-note.md"]);

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /unfiled-note\.md/);
    assert.doesNotMatch(pendingText, /^filed-note\.md$/m);
    assert.match(await page.locator("#vault-tree").innerText(), /Pending\s+1|1\s+Pending/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("pending source cards stay minimal before processing", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const pendingText = await page.evaluate(() => window.__marginsTest.seedSourceStatusCards());
    assert.match(pendingText, /pending-word\.docx/);
    assert.match(pendingText, /pending-statement\.pdf/);
    assert.match(pendingText, /script\/build\.py/);
    assert.equal((pendingText.match(/Process/g) || []).length, 3);
    assert.equal(await page.locator("#source-list .source-timestamp").count(), 3);
    assert.doesNotMatch(pendingText, /LLM attachment|0 words|DOCX text extraction|Word text|PDF text|words ready|raw source saved/i);
  } finally {
    await browser.close();
    await server.close();
  }
});

async function assertSelected(page, label) {
  const pressed = await page.locator(".run-question .quick-answer", { hasText: label }).getAttribute("aria-pressed");
  assert.equal(pressed, "true");
}

async function assertAnswered(page, text) {
  await page.getByText(text).waitFor();
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const resolvedPath = path.resolve(rootDir, relativePath);
      if (!resolvedPath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await readFile(resolvedPath);
      response.writeHead(200, { "Content-Type": contentType(resolvedPath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".mjs")) return "text/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
