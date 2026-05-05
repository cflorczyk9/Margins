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
        connections: [
          { title: "Claude Code", path: "wiki/coding/claude-code.md", reason: "Connect this note to existing agentic coding workflow notes." },
          { title: "Setup Efficiency", path: "wiki/concepts/setup-efficiency.md", reason: "Useful for later setup improvements." }
        ],
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
    const expandedSummary = normalizeText(await page.locator(".run-summary").innerText());
    assert.match(expandedSummary, /This uploaded source summarizes a phone call/);
    assert.match(expandedSummary, /The full summary should be visible/);
    assert.equal(expandedSummary.endsWith("..."), false);

    await page.locator(".run-question .quick-answer", { hasText: "Yes" }).click();
    await assertSelected(page, "Yes");
    await assertAnswered(page, "Answered: Yes");
    assert.equal(await page.locator(".connection-chip").count(), 2);
    assert.equal(await page.locator(".source-item.ready-to-write > .source-process-btn").count(), 0);
    await page.locator(".run-action-row").getByRole("button", { name: "Approve" }).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("process button processes only the selected pending source", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedSourceStatusCards());
    await page.locator(".source-item", { hasText: "script/build.py" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "script/build.py" }).waitFor();

    assert.deepEqual(await page.evaluate(() => window.__marginsTest.processedReviewNames()), ["script/build.py"]);
    assert.equal(await page.locator(".source-item.ready-to-write").count(), 1);
    assert.match(await page.locator(".source-item", { hasText: "pending-word.docx" }).innerText(), /Process/);
    assert.match(await page.locator(".source-item", { hasText: "pending-statement.pdf" }).innerText(), /Process/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("approve files the selected processed source", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedSourceStatusCards());
    await page.locator(".source-item", { hasText: "script/build.py" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "script/build.py" }).getByRole("button", { name: "Approve" }).click();

    await page.waitForFunction(() => !document.querySelector("#source-list")?.innerText.includes("script/build.py"));
    const pendingText = await page.locator("#source-list").innerText();
    assert.doesNotMatch(pendingText, /script\/build\.py/);
    assert.match(pendingText, /pending-word\.docx/);
    assert.match(pendingText, /pending-statement\.pdf/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("model-required sources do not show a fake successful summary", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedModelRequiredSource());
    await page.locator(".source-item", { hasText: "scanned-source.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.getByText("Review did not finish").waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Retry/);
    assert.doesNotMatch(pendingText, /Margins saved the original source and is ready to review it with the model/);
    assert.doesNotMatch(pendingText, /Review complete\. Approve to file it/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("vault PDF review refreshes the saved raw file before model attachment", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiBodies = [];
      window.fetch = async (_url, options = {}) => {
        window.__geminiBodies.push(JSON.parse(options.body || "{}"));
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: "This PDF was read directly from the saved raw source and connected to the current vault.",
                  connections: [
                    {
                      path: "wiki/concepts/pdf-ingest.md",
                      title: "PDF ingest",
                      type: "existing",
                      reason: "The source should connect to the PDF ingest workflow."
                    }
                  ],
                  questions: []
                })
              }]
            }
          }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      window.__marginsTest.seedVaultPdfAttachmentSource();
    });

    await page.locator(".source-item", { hasText: "saved-report.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "saved-report.pdf" }).waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.doesNotMatch(pendingText, /Review did not finish/);
    assert.match(pendingText, /This PDF was read directly/);
    assert.equal(await page.locator(".connection-chip", { hasText: "PDF ingest" }).count(), 1);
    await page.locator(".run-action-row").getByRole("button", { name: "Approve" }).waitFor();

    const bodies = await page.evaluate(() => window.__geminiBodies);
    const parts = bodies[0]?.contents?.[0]?.parts || [];
    assert.equal(parts.some((part) => part.inline_data?.mime_type === "application/pdf" && part.inline_data?.data), true);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("readable PDFs fall back to local review when Gemini is rate limited", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({
        error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedReadablePdfSource();
    });

    await page.locator(".source-item", { hasText: "text-layer-report.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "text-layer-report.pdf" }).waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.doesNotMatch(pendingText, /Review did not finish/);
    assert.match(pendingText, /Gemini is rate-limited right now/);
    await page.locator(".run-action-row").getByRole("button", { name: "Approve" }).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("image-only PDFs show a friendly Gemini rate-limit retry state", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({
        error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedVaultPdfAttachmentSource();
    });

    await page.locator(".source-item", { hasText: "saved-report.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.getByText("Review did not finish").waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Gemini free-tier limit reached/);
    assert.match(pendingText, /Retry/);
    assert.doesNotMatch(pendingText, /HTTP 429/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("bulk ingest processes the whole pending queue", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedSourceStatusCards());
    await page.getByRole("button", { name: "Bulk ingest" }).click();
    await page.waitForFunction(() => window.__marginsTest.processedReviewNames().length === 3);

    assert.deepEqual(await page.evaluate(() => window.__marginsTest.processedReviewNames()), [
      "pending-statement.pdf",
      "pending-word.docx",
      "script/build.py"
    ]);
    await page.waitForFunction(() => document.querySelector("#source-list")?.classList.contains("empty"));
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

test("pending source cards can be removed after confirmation", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__confirmMessages = [];
      window.confirm = (message) => {
        window.__confirmMessages.push(message);
        return true;
      };
      window.__marginsTest.seedSourceStatusCards();
    });

    await page.getByRole("button", { name: "Remove pending-word.docx" }).click();
    const pendingText = await page.locator("#source-list").innerText();
    assert.doesNotMatch(pendingText, /pending-word\.docx/);
    assert.match(pendingText, /pending-statement\.pdf/);
    assert.equal((pendingText.match(/Process/g) || []).length, 2);
    assert.deepEqual(await page.evaluate(() => window.__confirmMessages), ["Remove pending-word.docx from pending?"]);
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".bcmap")) return "application/octet-stream";
  if (filePath.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}
