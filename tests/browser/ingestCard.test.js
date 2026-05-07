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

    const card = page.locator(".source-item.ready-to-write", { hasText: "browser-smoke-source.txt" });
    await card.getByText("Needs your call").waitFor();
    await card.getByText("sources/source-browser-smoke-source.md").waitFor();
    await openReceiptDetails(card);
    await card.getByRole("button", { name: "Show more" }).click();
    const expandedSummary = normalizeText(await card.locator(".run-summary").innerText());
    assert.match(expandedSummary, /This uploaded source summarizes a phone call/);
    assert.match(expandedSummary, /The full summary should be visible/);
    assert.equal(expandedSummary.endsWith("..."), false);

    await card.locator(".receipt-decision .quick-answer", { hasText: "Yes" }).click();
    await assertSelected(page, "Yes");
    await assertAnswered(page, "Answered: Yes");
    await card.locator(".receipt-log .filing-pill", { hasText: "Claude Code" }).waitFor();
    await card.locator(".receipt-log .filing-pill", { hasText: "Setup Efficiency" }).waitFor();
    assert.equal(await page.locator(".source-item.ready-to-write > .source-process-btn").count(), 0);
    await card.locator(".receipt-footer").getByRole("button", { name: "Approve" }).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("filing bucket questions render as bucket choices instead of paths", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__marginsTest.seedIngestCard({
        summary: "This source should be filed after choosing the most appropriate bucket.",
        questions: [
          {
            question: "File this in coding or use another proposed bucket?",
            options: [
              "wiki/coding/source-2001-tavanti-3d-spatial-memory.md",
              "wiki/ideas/source-2001-tavanti-3d-spatial-memory.md",
              "Skip"
            ]
          }
        ]
      });
    });

    const card = page.locator(".source-item.ready-to-write", { hasText: "browser-smoke-source.txt" });
    await card.locator(".receipt-decision").getByText("Does this belong in coding or ideas?").waitFor();
    await card.locator(".receipt-decision").getByRole("button", { name: "Coding" }).waitFor();
    await card.locator(".receipt-decision").getByRole("button", { name: "Ideas" }).click();
    await card.locator(".receipt-decision").getByText("Answered: Ideas").waitFor();

    const receiptText = normalizeText(await card.locator(".receipt-decision").innerText());
    assert.doesNotMatch(receiptText, /wiki\/coding\/source-2001/);
    assert.doesNotMatch(receiptText, /wiki\/ideas\/source-2001/);
    assert.match(await page.locator("#review-reply").inputValue(), /wiki\/ideas\/source-2001-tavanti-3d-spatial-memory\.md/);
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

    await page.evaluate(() => {
      window.__marginsTest.clearProcessTimings();
      window.__marginsTest.seedSourceStatusCards();
    });
    await page.locator(".source-item", { hasText: "script/build.py" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "script/build.py" }).waitFor();
    await page.waitForFunction(() => window.__marginsTest.processTimings().length === 1);

    assert.deepEqual(await page.evaluate(() => window.__marginsTest.processedReviewNames()), ["script/build.py"]);
    assert.equal(await page.locator(".source-item.ready-to-write").count(), 1);
    assert.match(await page.locator(".source-item", { hasText: "pending-word.docx" }).innerText(), /Process/);
    assert.match(await page.locator(".source-item", { hasText: "pending-statement.pdf" }).innerText(), /Process/);
    const timings = await page.evaluate(() => window.__marginsTest.processTimings());
    assert.equal(timings[0].purpose, "ingest_process");
    assert.equal(timings[0].fileName, "script/build.py");
    assert.equal(timings[0].readyToApprove, true);
    assert.equal(timings[0].ok, true);
    assert.ok(Number.isFinite(timings[0].totalMs));
    assert.ok(Number.isFinite(timings[0].renderReadyMs));
    const storedTimings = await page.evaluate(() => JSON.parse(localStorage.getItem("margins.processTimings.v1") || "[]"));
    assert.equal(storedTimings.length, 1);
    assert.equal(storedTimings[0].fileName, "script/build.py");
    const card = page.locator(".source-item.ready-to-write", { hasText: "script/build.py" });
    await openReceiptDetails(card);
    await card.getByText(/Processed in \d+(?:\.\d)?s/).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("processing checklist advances while Gemini is still reviewing", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.fetch = async () => new Promise((resolve) => {
        setTimeout(() => resolve(new Response(JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{ text: JSON.stringify({
                summary: {
                  overview: "Saved report should become a source note.",
                  bullets: ["The report has enough context to file."]
                },
                takeaways: [],
                connections: [],
                asks: []
              }) }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 80,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 0,
            totalTokenCount: 120
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })), 180);
      });
      window.__marginsTest.setIngestProgressDelays([0, 25, 60, 95]);
      window.__marginsTest.seedVaultPdfAttachmentSource();
    });

    const card = page.locator(".source-item", { hasText: "saved-report.pdf" });
    await card.getByRole("button", { name: "Process" }).click();
    await card.getByText("Saving PDF source file").waitFor();
    await card.getByText(/Reading PDF/).waitFor();
    await card.getByText("Margins is comparing it against your brain").waitFor();
    await card.getByText("Converting to Markdown file structure").waitFor();
    const readyCard = page.locator(".source-item.ready-to-write", { hasText: "saved-report.pdf" });
    await readyCard.waitFor();
    const lines = await readyCard.locator(".receipt-log-line").evaluateAll((nodes) => (
      nodes.map((node) => node.querySelector(".receipt-log-content")?.innerText.trim() || "")
    ));
    assert.equal(lines[0], "Saving PDF source file");
    assert.match(lines[1], /^Reading PDF/);
    assert.equal(lines[2], "Margins is comparing it against your brain");
    assert.equal(lines[3], "Converting to Markdown file structure");
    assert.ok(lines.findIndex((line) => /Created|Updated|Prepared source page/.test(line)) > 3);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("markdown sources do not say they are being converted to Markdown", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedIngestCard({
      fileName: "browser-smoke-source.md",
      summary: "Markdown source ready for filing."
    }));
    const readyCard = page.locator(".source-item.ready-to-write", { hasText: "browser-smoke-source.md" });
    await readyCard.waitFor();
    const cardText = normalizeText(await readyCard.innerText());
    assert.match(cardText, /Preparing Markdown file for filing/);
    assert.doesNotMatch(cardText, /Converting to Markdown file structure/);
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
    assert.equal(await page.locator(".tab.active").innerText(), "Activity");
    assert.equal(await page.locator("#inbox-view").evaluate((node) => node.classList.contains("active")), true);
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
    await page.locator("#source-list").getByText("Review did not finish", { exact: true }).waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Retry/);
    assert.doesNotMatch(pendingText, /Margins saved the original source and is ready to review it with the model/);
    assert.doesNotMatch(pendingText, /Review complete\. Approve to file it/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("vault PDF review refreshes the saved source file before model attachment", {
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
                  summary: "This PDF was read directly from the saved source file and connected to the current vault.",
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
    const card = page.locator(".source-item.ready-to-write", { hasText: "saved-report.pdf" });
    assert.equal(await card.locator(".receipt-log .filing-pill", { hasText: "PDF ingest" }).count(), 1);
    await card.locator(".receipt-footer").getByRole("button", { name: "Approve" }).waitFor();

    const bodies = await page.evaluate(() => window.__geminiBodies);
    const parts = bodies[0]?.contents?.[0]?.parts || [];
    assert.equal(parts.some((part) => part.inline_data?.mime_type === "application/pdf" && part.inline_data?.data), true);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("calendar invites are reviewed as prompt text instead of unsupported Gemini MIME", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiCalls = [];
      window.fetch = async (_url, options = {}) => {
        window.__geminiCalls.push(JSON.parse(options.body || "{}"));
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: {
                    overview: "Calendar invite was reviewed as readable event text.",
                    bullets: ["The invite schedules Discussion with Connor."]
                  },
                  takeaways: [],
                  connections: [],
                  filingSteps: [
                    "Saving ICS source file",
                    "Reading ICS — ~18 words",
                    "Margins is comparing it against your brain",
                    "Prepared source page"
                  ],
                  asks: []
                })
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 140,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 0,
            totalTokenCount: 180
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
    });

    const imported = await page.evaluate(() => window.__marginsTest.importCalendarInviteSource());
    assert.equal(imported.fileType, "text");
    assert.match(imported.fileText, /BEGIN:VCALENDAR/);
    assert.match(imported.rawBody, /SUMMARY:Discussion with Connor/);

    await page.locator(".source-item", { hasText: "invite.ics" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "invite.ics" });
    await card.waitFor();

    const calls = await page.evaluate(() => window.__geminiCalls);
    assert.equal(calls.length, 1);
    const parts = calls[0].contents[0].parts;
    assert.match(parts[0].text, /BEGIN:VCALENDAR/);
    assert.match(parts[0].text, /SUMMARY:Discussion with Connor/);
    assert.equal(parts.some((part) => part.inline_data?.mime_type === "text/calendar"), false);
    assert.equal(parts.some((part) => part.inline_data), false);
    assert.match(await card.innerText(), /Calendar invite was reviewed as readable event text/);
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

    const card = page.locator(".source-item.ready-to-write", { hasText: "text-layer-report.pdf" });
    await openReceiptDetails(card);
    const pendingText = await page.locator("#source-list").innerText();
    assert.doesNotMatch(pendingText, /Review did not finish/);
    assert.match(pendingText, /Margins review is rate-limited right now/);
    assert.match(pendingText, /showing the local review/);
    assert.match(pendingText, /Retry later for model-generated questions/);
    assert.match(pendingText, /Local review ready/);
    assert.doesNotMatch(pendingText, /Margins reviewed/);
    await card.locator(".receipt-footer").getByRole("button", { name: "Approve" }).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("malformed Gemini fallback does not invent financial extraction", {
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
        candidates: [{
          content: {
            parts: [{ text: "I reviewed the PDF, but this is not JSON." }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 80,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 0,
          totalTokenCount: 100
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedFinancialPdfSource();
    });

    await page.locator(".source-item", { hasText: "coleman-brokerage-2026-03.pdf" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "coleman-brokerage-2026-03.pdf" });
    await card.waitFor();

    let cardText = normalizeText(await card.innerText());
    assert.doesNotMatch(cardText, /Financial details/);
    assert.doesNotMatch(cardText, /Financial source/);
    assert.doesNotMatch(cardText, /Should Margins keep extracted figures and account details/);
    assert.doesNotMatch(cardText, /Keep demo figures/);
    await openReceiptDetails(card);
    const detailsText = normalizeText(await card.locator(".receipt-details-body").textContent());
    assert.match(detailsText, /Margins received a malformed review/);
    assert.doesNotMatch(detailsText, /Financial details/);
    const sourceNote = await page.evaluate(() => window.__marginsTest.sourceNoteBody("coleman-brokerage-2026-03.pdf"));
    assert.doesNotMatch(sourceNote, /## Financial Details/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini ingest review retries once when output is cut off", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiCalls = [];
      window.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        window.__geminiCalls.push(body.generationConfig);
        const first = window.__geminiCalls.length === 1;
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: first ? "MAX_TOKENS" : "STOP",
            content: {
              parts: [{
                text: first
                  ? "{\"summary\":{\"overview\":\"cut off before the object closed\""
                  : JSON.stringify({
                    summary: {
                      overview: "Saved report should become a source note.",
                      bullets: ["The retry returned a complete JSON review."]
                    },
                    takeaways: [],
                    connections: [],
                    filingSteps: [
                      "Reading PDF — 2 pages, ~20 words",
                      "Created Saved Report as a new source",
                      "Prepared source page · 1 flagged for review"
                    ],
                    asks: []
                  })
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 80,
            candidatesTokenCount: first ? 2048 : 80,
            thoughtsTokenCount: 0,
            totalTokenCount: first ? 2128 : 160
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      window.__marginsTest.setApiGuard({
        enabled: true,
        maxRequests: 20,
        maxOutputTokens: 512,
        maxSessionTokens: 250000,
        maxSessionUsd: 1,
        minRequestDelaySeconds: 0,
        maxRequestsPerWindow: 10,
        requestWindowSeconds: 1
      });
      window.__marginsTest.seedVaultPdfAttachmentSource();
    });

    await page.locator(".source-item", { hasText: "saved-report.pdf" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "saved-report.pdf" });
    await card.waitFor();

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Saved report should become a source note/);
    assert.doesNotMatch(cardText, /malformed review/);
    assert.doesNotMatch(cardText, /cut off before complete JSON/);
    await openReceiptDetails(card);
    assert.match(normalizeText(await card.innerText()), /The retry returned a complete JSON review/);
    const calls = await page.evaluate(() => window.__geminiCalls);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].maxOutputTokens >= 8192, true);
    assert.equal(calls[1].maxOutputTokens >= 12288, true);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("partial Gemini review uses local summary without misclassifying business DOCX as financial", {
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
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                asks: [{
                  kind: "Follow-up",
                  question: "Should this Booth conversation stay active for follow-up tracking?",
                  whyAsk: "That changes whether the source is just context or an active relationship/project thread.",
                  recommendation: "My take: track it if another Booth conversation is expected.",
                  options: ["Track it", "Just file it", "Skip"]
                }]
              })
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 90,
          candidatesTokenCount: 35,
          thoughtsTokenCount: 0,
          totalTokenCount: 125
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedBusinessDocxSource();
    });

    await page.locator(".source-item", { hasText: "Zoom in on Booth" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "Zoom in on Booth" });
    await card.waitFor();

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Zoom transcript from April 2026/);
    assert.match(cardText, /Should this Booth conversation stay active for follow-up tracking/);
    assert.doesNotMatch(cardText, /Model review failed/);
    assert.doesNotMatch(cardText, /financial account document/);
    assert.doesNotMatch(cardText, /Financial source/);
    await openReceiptDetails(card);
    const detailsText = normalizeText(await card.locator(".receipt-details-body").textContent());
    assert.match(detailsText, /Margins reviewed the source, but no card summary came back/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("local fallback does not label motivational money talk as financial", {
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
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ asks: [] }) }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 90,
          candidatesTokenCount: 15,
          thoughtsTokenCount: 0,
          totalTokenCount: 105
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedMotivationalVideoSource();
    });

    await page.locator(".source-item", { hasText: "16 Brutal Life Lessons" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "16 Brutal Life Lessons" });
    await card.waitFor();

    let cardText = normalizeText(await card.innerText());
    assert.match(cardText, /16 Brutal Life Lessons for Ambitious People - Michael Smoak/);
    await openReceiptDetails(card);
    const detailsText = normalizeText(await card.locator(".receipt-details-body").textContent());
    const summaryText = normalizeText(await card.locator(".run-summary").innerText());
    assert.match(detailsText, /Margins reviewed the source, but no card summary came back/);
    assert.match(summaryText, /16 Brutal Life Lessons for Ambitious People - Michael Smoak/);
    assert.match(summaryText, /Michael Smoak is a mindset coach/);
    assert.doesNotMatch(summaryText, /title:/);
    assert.doesNotMatch(summaryText, /source:/);
    assert.doesNotMatch(summaryText, /tags:/);
    assert.doesNotMatch(summaryText, /youtube\.com\/watch/);
    assert.doesNotMatch(detailsText, /Chase · financial account document/);
    assert.doesNotMatch(detailsText, /Financial details/);
    assert.doesNotMatch(detailsText, /Financial source/);
    assert.doesNotMatch(detailsText, /extracted figures and account details/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini financial review renders account figures and transactions", {
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
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                missionFrame: {
                  oneLine: "Use this brokerage statement as a structured financial source note.",
                  sourceRole: "evidence",
                  confidence: "high"
                },
                summary: {
                  overview: "Charles Schwab brokerage demo statement for Sarah Coleman.",
                  bullets: ["Contains account value, cash balance, holdings, and cash activity visible in the source."]
                },
                financialDetails: {
                  accounts: [{
                    institution: "Charles Schwab",
                    owner: "Sarah Coleman",
                    accountType: "brokerage statement",
                    accountNumberLast4: "4321",
                    period: "2026-03"
                  }],
                  figures: [
                    { label: "Total account value", value: "$128,430.52", date: "2026-03", context: "Statement total account value." },
                    { label: "Cash balance", value: "$4,220.17", date: "2026-03", context: "Cash balance visible in account summary." }
                  ],
                  holdings: [
                    { symbol: "GOOG", quantity: "12 shares", value: "$24,600.00", context: "Visible holding row." }
                  ],
                  transactions: [
                    { date: "2026-03-15", description: "Dividend GOOG", amount: "$125.33", type: "dividend" },
                    { date: "2026-03-20", description: "Transfer from bank", amount: "$2,500.00", type: "transfer" }
                  ],
                  caveats: ["Document says demo/sample/not actual account."]
                },
                asks: []
              })
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 120,
          thoughtsTokenCount: 0,
          totalTokenCount: 220
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedFinancialPdfSource();
    });

    await page.locator(".source-item", { hasText: "coleman-brokerage-2026-03.pdf" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "coleman-brokerage-2026-03.pdf" });
    await card.waitFor();

    await openReceiptDetails(card);
    const detailsText = normalizeText(await card.locator(".receipt-details-body").textContent());
    assert.match(detailsText, /Financial details/);
    assert.match(detailsText, /Charles Schwab · brokerage statement · owner: Sarah Coleman · last4: 4321 · 2026-03/);
    assert.match(detailsText, /Total account value .* \$128,430\.52/);
    assert.match(detailsText, /Cash balance .* \$4,220\.17/);
    assert.match(detailsText, /GOOG · 12 shares · \$24,600\.00/);
    assert.match(detailsText, /2026-03-15 · dividend · Dividend GOOG · \$125\.33/);
    assert.doesNotMatch(detailsText, /Model review failed/);

    const sourceNote = await page.evaluate(() => window.__marginsTest.sourceNoteBody("coleman-brokerage-2026-03.pdf"));
    assert.match(sourceNote, /## Financial Details/);
    assert.match(sourceNote, /### Transactions/);
    assert.match(sourceNote, /Dividend GOOG/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini review parser accepts common near-schema variants", {
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
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                source_review: {
                  mission_frame: "Use this Booth source as a relationship and product-market context note.",
                  key_takeaways: {
                    primary: [{
                      text: "Booth is discussing marketing and product-management fit with Connor.",
                      why_it_matters: "This determines whether the note should stay active for follow-up."
                    }],
                    context: [
                      "Amazon account strategy is context, not a financial account statement."
                    ]
                  },
                  light_touch_notes: [
                    "Do not promote every company mention from the transcript."
                  ],
                  related_pages: [{
                    wiki_path: "wiki/relationships/booth.md",
                    name: "Booth",
                    rationale: "Booth is the central relationship in the source."
                  }],
                  proposed_updates: [{
                    wiki_path: "wiki/relationships/booth.md",
                    action: "add_backlink",
                    rationale: "Connect the source to the relationship page."
                  }],
                  follow_up_questions: [{
                    type: "Follow-up",
                    prompt: "Should Booth stay in active relationship follow-up?",
                    why_ask: "That changes whether the note is passive context or active tracking.",
                    default: "My take: track it if another conversation is expected.",
                    choices: "Track it|Just file it|Skip"
                  }]
                }
              })
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 90,
          candidatesTokenCount: 70,
          thoughtsTokenCount: 0,
          totalTokenCount: 160
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      window.__marginsTest.seedBusinessDocxSource();
    });

    await page.locator(".source-item", { hasText: "Zoom in on Booth" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "Zoom in on Booth" });
    await card.waitFor();

    let cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Use this Booth source as a relationship and product-market context note/);
    assert.match(cardText, /Should Booth stay in active relationship follow-up/);
    await openReceiptDetails(card);
    const detailsText = normalizeText(await card.locator(".receipt-details-body").textContent());
    assert.match(detailsText, /Primary: Booth is discussing marketing and product-management fit/);
    assert.match(detailsText, /Amazon account strategy is context, not a financial account statement/);
    assert.match(detailsText, /wiki\/relationships\/booth\.md · add_backlink/);
    assert.doesNotMatch(detailsText, /did not return a card summary/);
    assert.doesNotMatch(detailsText, /Model review failed/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("spend guard blocks model calls before fetch", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__fetchCount = 0;
      window.fetch = async () => {
        window.__fetchCount += 1;
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      };
      window.__marginsTest.setApiGuard({
        enabled: true,
        maxRequests: 20,
        maxOutputTokens: 8192,
        maxSessionTokens: 1,
        maxSessionUsd: 0.000001
      });
      window.__marginsTest.seedReadablePdfSource();
    });

    await page.locator(".source-item", { hasText: "text-layer-report.pdf" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "text-layer-report.pdf" });
    await card.waitFor();
    await openReceiptDetails(card);

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Spend guard stopped this Gemini call before it ran/);
    assert.equal(await page.evaluate(() => window.__fetchCount), 0);
    assert.equal((await page.evaluate(() => window.__marginsTest.apiUsage())).requests, 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("model throttle spaces bursty Gemini calls", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__fetchTimes = [];
      window.fetch = async () => {
        window.__fetchTimes.push(performance.now());
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: "Model reviewed this readable source.",
                  connections: [],
                  questions: []
                })
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            thoughtsTokenCount: 0,
            totalTokenCount: 15
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      window.__marginsTest.setApiGuard({
        enabled: true,
        maxRequests: 20,
        maxOutputTokens: 512,
        maxSessionTokens: 250000,
        maxSessionUsd: 1,
        minRequestDelaySeconds: 0,
        maxRequestsPerWindow: 2,
        requestWindowSeconds: 1
      });
      window.__marginsTest.seedTextModelSources(3);
    });

    await page.getByRole("button", { name: "Bulk process" }).click();
    await page.waitForFunction(() => window.__fetchTimes?.length === 3);

    const fetchTimes = await page.evaluate(() => window.__fetchTimes);
    assert.equal(fetchTimes.length, 3);
    assert.ok(fetchTimes[2] - fetchTimes[0] >= 900, `expected third call to wait for rolling window, got ${fetchTimes[2] - fetchTimes[0]}ms`);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini review shows concise summary bullets and model questions", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiCalls = [];
      window.fetch = async (url, options = {}) => {
        window.__geminiCalls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
        const review = {
          missionFrame: {
            oneLine: "Use this call as an opportunity source note with a follow-up decision.",
            sourceRole: "follow_up",
            confidence: "high"
          },
          takeaways: [
            {
              relevance: "primary",
              label: "Opportunity",
              point: "Larry is sharing a possible CFO or chief-of-staff style opportunity.",
              whyItMatters: "This changes whether the source should stay passive or become active tracking."
            },
            {
              relevance: "secondary",
              label: "Timing",
              point: "The source includes context about timing, compensation, and risk.",
              whyItMatters: "These details are useful for deciding whether to keep the conversation warm."
            },
            {
              relevance: "context",
              label: "Next move",
              point: "Connor needs to decide whether another conversation is expected.",
              whyItMatters: "That answer changes propagation into a follow-up surface."
            }
          ],
          lightTouch: [
            {
              note: "Do not promote every company mention from the call.",
              reason: "Some mentions are only context for this source."
            }
          ],
          connections: [
            {
              path: "wiki/relationships/larry-abrahams.md",
              title: "Larry Abrahams",
              type: "existing",
              relevance: "primary",
              reason: "Larry is central to the source."
            }
          ],
          propagation: [
            {
              targetPath: "wiki/relationships/larry-abrahams.md",
              action: "add_backlink",
              rationale: "Connect the source to Larry as the relationship context.",
              confidence: "high"
            }
          ],
          filingPlan: {
            whySaved: [
              "This source changes how Connor tracks the Larry relationship and possible operating-role opportunity.",
              "It should connect to the existing relationship context before becoming a follow-up surface."
            ],
            candidateFiles: [
              {
                path: "wiki/relationships/larry-abrahams.md",
                reason: "Larry is the central relationship in the source.",
                priority: "high"
              },
              {
                path: "wiki/index.md",
                reason: "Use the index to keep the source connected to the current wiki graph.",
                priority: "medium"
              }
            ],
            placement: {
              bucket: "career",
              path: "wiki/career/source-2026-05-06-larry-opportunity-call.md",
              title: "Larry opportunity call",
              reason: "The source is career/opportunity context, not a durable concept yet.",
              alternatives: ["wiki/ideas/source-2026-05-06-larry-opportunity-call.md"]
            },
            tags: ["source", "career", "opportunity", "relationship"],
            regionTag: "region/build",
            typeTag: "meeting",
            typeTagNote: "",
            promotion: {
              candidate: "operating-role-opportunity",
              recommendation: "Wait for another source before creating a concept page.",
              reason: "One call is enough for a source note but not a durable concept."
            }
          },
          filingSteps: [
            "Reading TXT — ~10 words",
            "Detected 1 entity · 1 already in your brain",
            "Created Larry opportunity call as a new source",
            "Updated Larry Abrahams · connected the source to relationship context",
            "Prepared source page · 1 entity update · 1 flagged for review"
          ],
          asks: [
            {
              kind: "Follow-up",
              question: "Should Margins treat this as an active opportunity to track?",
              whyAsk: "That changes whether the source becomes a task-like follow-up.",
              recommendation: "My take: yes if you expect another conversation.",
              options: ["Track it", "Just file it", "Skip"]
            }
          ]
        };
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: `Here is the review:\n\`\`\`json\n${JSON.stringify(review).replace(/}$/, ",}")}\n\`\`\``
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 30,
            candidatesTokenCount: 20,
            thoughtsTokenCount: 0,
            totalTokenCount: 50
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      window.__marginsTest.setApiGuard({
        enabled: true,
        maxRequests: 20,
        maxOutputTokens: 512,
        maxSessionTokens: 250000,
        maxSessionUsd: 1,
        minRequestDelaySeconds: 0,
        maxRequestsPerWindow: 5,
        requestWindowSeconds: 1
      });
      window.__marginsTest.seedTextModelSources(1);
    });

    await page.locator(".source-item", { hasText: "model-source-1.txt" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "model-source-1.txt" }).waitFor();

    const calls = await page.evaluate(() => window.__geminiCalls);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
    assert.match(calls[0].body.contents[0].parts[0].text, /compact pending-card review/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /Always fill summary\.overview and summary\.bullets/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /filing judgment/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /candidateFiles/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /filingSteps/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /asks-only response is incomplete/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /Do not infer finance from isolated words/i);
    assert.deepEqual(calls[0].body.generationConfig.responseSchema.required, [
      "summary",
      "takeaways",
      "connections",
      "asks"
    ]);
    assert.equal(calls[0].body.generationConfig.maxOutputTokens >= 8192, true);

    const card = page.locator(".source-item.ready-to-write", { hasText: "model-source-1.txt" });
    await card.locator(".receipt-log").getByText(/Created Larry opportunity call/).waitFor();
    await card.locator(".receipt-log").getByRole("button", { name: /career\/source-2026-05-06-larry-opportunity-call\.md/ }).waitFor();
    await card.getByText("Needs your call").waitFor();
    await card.locator(".receipt-decision").getByText("Should Margins treat this as an active opportunity to track?").waitFor();
    await card.locator(".receipt-decision").getByRole("button", { name: "Track it" }).click();
    await card.locator(".receipt-decision").getByText("Answered: Track it").waitFor();
    await openReceiptDetails(card);
    const details = card.locator(".receipt-details-body");
    await details.getByText("Filing judgment").waitFor();
    await details.getByText("wiki/career/source-2026-05-06-larry-opportunity-call.md").waitFor();
    await details.getByText("Files Margins checked").waitFor();
    await details.locator(".plan-file-row").getByText("wiki/relationships/larry-abrahams.md", { exact: true }).waitFor();
    await details.getByText("Detected 1 entity · 1 already in your brain").waitFor();
    await details.getByText("Updated Larry Abrahams · connected the source to relationship context").waitFor();
    await details.getByText("Use this call as an opportunity source note").waitFor();
    await details.getByText("Opportunity: Larry is sharing a possible CFO").waitFor();
    await details.getByText("Do not promote every company mention").waitFor();
    await details.getByText("wiki/relationships/larry-abrahams.md · add_backlink").waitFor();
    assert.equal(
      await page.evaluate(() => window.__marginsTest.sourceNotePath("model-source-1.txt")),
      "wiki/career/source-2026-05-06-larry-opportunity-call.md"
    );
    const sourceNote = await page.evaluate(() => window.__marginsTest.sourceNoteBody("model-source-1.txt"));
    assert.match(sourceNote, /bucket: career/);
    assert.match(sourceNote, /tags: \[source, career, opportunity, relationship, region\/build, meeting\]/);
    assert.match(sourceNote, /## Filing Judgment/);

    const timings = await page.evaluate(() => window.__marginsTest.modelTimings());
    assert.equal(timings.length, 1);
    assert.equal(timings[0].purpose, "ingest_review");
    assert.equal(timings[0].fileName, "model-source-1.txt");
    assert.equal(timings[0].sourceType, "text");
    assert.equal(timings[0].sourceSizeBytes, 74);
    assert.ok(timings[0].sourceTextChars > 0);
    assert.ok(timings[0].vaultContextFileCount > 0);
    assert.equal(timings[0].provider, "gemini");
    assert.equal(timings[0].httpStatus, 200);
    assert.equal(timings[0].ok, true);
    assert.equal(timings[0].parseOk, true);
    assert.ok(timings[0].promptChars > 0);
    assert.ok(Number.isFinite(timings[0].roundTripMs));
    assert.ok(Number.isFinite(timings[0].totalMs));
    assert.ok(timings[0].contentChars > 0);
    const storedTimings = await page.evaluate(() => JSON.parse(localStorage.getItem("margins.modelTimings.v1") || "[]"));
    assert.equal(storedTimings.length, 1);
    assert.equal(storedTimings[0].fileName, "model-source-1.txt");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini ingest prompt includes relevant existing wiki nodes outside generated folders", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiCalls = [];
      window.fetch = async (url, options = {}) => {
        window.__geminiCalls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: {
                    overview: "This source is a Bob Casey follow-up about the Riviera opportunity.",
                    bullets: [
                      "It should connect to the existing Riviera company note.",
                      "It should reuse the existing Bob Casey relationship node.",
                      "It may update the career-fork context if Connor wants to keep the role warm."
                    ]
                  },
                  connections: [
                    {
                      path: "wiki/career/riviera.md",
                      title: "Riviera",
                      type: "existing",
                      reason: "The source is about Riviera."
                    },
                    {
                      path: "wiki/projects/bob-casey.md",
                      title: "Bob Casey",
                      type: "existing",
                      reason: "Bob is central to the follow-up."
                    }
                  ],
                  questions: [
                    {
                      kind: "Follow-up",
                      question: "Should this keep the Riviera opportunity active?",
                      reason: "That changes how the source is filed.",
                      recommendation: "My take: track it if Bob expects another conversation.",
                      options: ["Keep active", "Just file", "Skip"]
                    }
                  ]
                })
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 80,
            candidatesTokenCount: 30,
            thoughtsTokenCount: 0,
            totalTokenCount: 110
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      window.__marginsTest.seedRichWikiContextSource();
    });

    await page.locator(".source-item", { hasText: "bob-casey-followup.txt" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "bob-casey-followup.txt" }).waitFor();

    const prompt = await page.evaluate(() => window.__geminiCalls[0].body.contents[0].parts[0].text);
    assert.match(prompt, /ranked from 5 loaded wiki markdown files/);
    assert.match(prompt, /wiki\/career\/riviera\.md/);
    assert.match(prompt, /wiki\/projects\/bob-casey\.md/);
    assert.match(prompt, /wiki\/career\/source-2026-04-24-connor-bob-casey\.md/);
    assert.match(prompt, /tags: company, family-office, software, career-fork/);
    assert.match(prompt, /links: bob-casey, santa-barbara-management, briefly/);
    assert.doesNotMatch(prompt, /No existing wiki context loaded/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("filing checklist labels Margins review and ignores generic source links", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedNoisyFilingChecklist());
    const card = page.locator(".source-item.ready-to-write", { hasText: "workspace-map-notes.pdf" });
    const receiptText = normalizeText(await card.innerText());
    assert.match(receiptText, /new source/i);
    assert.match(receiptText, /Detected 5 entities · 5 already in your brain/);
    assert.match(receiptText, /Linked to Workspace Map, Interface Decisions, Graph View/);
    assert.match(receiptText, /and 2 more/);
    assert.doesNotMatch(receiptText, /Spatial Memory/);
    assert.doesNotMatch(receiptText, /Linked to know/);
    assert.doesNotMatch(receiptText, /think/);
    assert.doesNotMatch(receiptText, /things/);
    assert.doesNotMatch(receiptText, /going/);
    assert.doesNotMatch(receiptText, /thats/);
    assert.match(receiptText, /Workspace Map/);
    assert.doesNotMatch(receiptText, /Margins reviewed/);
    await card.getByRole("button", { name: "and 2 more" }).click();
    const expandedReceiptText = normalizeText(await card.innerText());
    assert.match(expandedReceiptText, /Spatial Memory/);
    assert.match(expandedReceiptText, /Margins UI/);
    assert.match(expandedReceiptText, /show fewer/);
    await openReceiptDetails(card);
    const text = normalizeText(await card.innerText());
    assert.match(text, /Detected 5 entities · 5 already in your brain/);
    assert.match(text, /Linked to Workspace Map, Interface Decisions, Graph View, Spatial Memory and Margins UI/);
    assert.doesNotMatch(text, /entitys/);
    assert.doesNotMatch(text, /Linked to display/);
    assert.doesNotMatch(text, /subjects and results/);
    assert.doesNotMatch(text, /Gemini reviewed/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Gemini DOCX call review does not collapse a no-question response into a wall of text", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("margins.apiSecret.v1", "test-gemini-key");
      localStorage.setItem("margins-review-mode", "suggested");
    });
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__geminiCalls = [];
      window.fetch = async (url, options = {}) => {
        window.__geminiCalls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: [
                    "Participants Larry and Connor discussed a possible operating role tied to a healthcare services company and whether Connor should keep the conversation warm.",
                    "Background Larry framed the call as exploratory and said the company may need finance, strategy, and execution help after a recent acquisition.",
                    "Opportunity The role could become a CFO or chief-of-staff style position if the business decides to build a more formal leadership layer.",
                    "Open questions The source leaves follow-up ownership, timing, compensation, and Connor's desired level of engagement unresolved.",
                    "Next steps Connor needs to decide whether this belongs in active follow-up tracking or should only be filed as context."
                  ].join(" "),
                  connections: [],
                  questions: []
                })
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 70,
            candidatesTokenCount: 90,
            thoughtsTokenCount: 0,
            totalTokenCount: 160
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
    });

    await page.evaluate(() => window.__marginsTest.seedDocxModelCallSource());
    await page.locator(".source-item", { hasText: "pending-word.docx" }).getByRole("button", { name: "Process" }).click();
    const card = page.locator(".source-item.ready-to-write", { hasText: "pending-word.docx" });
    await card.waitFor();

    const calls = await page.evaluate(() => window.__geminiCalls);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.contents[0].parts[0].text, /compact pending-card review/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Return 0-2 specific asks/);
    assert.match(calls[0].body.contents[0].parts[0].text, /summary\.overview/);
    assert.match(calls[0].body.contents[0].parts[0].text, /summary\.bullets/);
    assert.match(calls[0].body.contents[0].parts[0].text, /filingSteps/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Name: pending-word\.docx/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Type: docx/);
    assert.deepEqual(calls[0].body.generationConfig.responseSchema.required, [
      "summary",
      "takeaways",
      "connections",
      "asks"
    ]);
    assert.equal(calls[0].body.contents[0].parts.some((part) => part.inline_data?.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);

    await card.locator(".receipt-log .filing-pill").getByText("Pending Word", { exact: true }).waitFor();
    await openReceiptDetails(card);
    assert.equal(await card.locator(".run-brief-points li").count() >= 3, true);
    const visibleSummary = normalizeText(await card.locator(".run-summary").innerText());
    assert.equal(visibleSummary.length < 700, true);

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Margins found no required follow-up questions/);
    await card.getByRole("button", { name: "Approve" }).waitFor();
    assert.doesNotMatch(cardText, /Should Margins keep this conversation active/);
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
    await page.locator("#source-list").getByText("Review did not finish", { exact: true }).waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Margins review is rate-limited right now/);
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
    await page.getByRole("button", { name: "Bulk process" }).click();
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

test("vault source files without source notes appear in the pending inbox", {
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
    assert.equal(await page.locator(".upload-stats").count(), 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("activity tab interleaves pending source files as ghost cards", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const activity = await page.evaluate(() => window.__marginsTest.seedActivitySections());
    assert.match(activity.pendingText, /unfiled-note\.md/);
    assert.doesNotMatch(activity.pendingText, /^filed-note\.md$/m);
    assert.match(activity.recentText, /Filed Activity Note/);
    assert.match(activity.recentText, /unfiled-note\.md/);
    assert.match(activity.recentText, /Older Activity Note/);

    const cards = await page.locator("#recent-activity-list .activity-card").evaluateAll((nodes) => nodes.map((node) => ({
      text: node.innerText,
      ghost: node.classList.contains("ghost"),
      borderStyle: getComputedStyle(node).borderStyle,
      beforeContent: getComputedStyle(node, "::before").content
    })));
    assert.equal(cards.length, 3);
    assert.match(cards[0].text, /Filed Activity Note/);
    assert.match(cards[1].text, /unfiled-note\.md/);
    assert.equal(cards[1].ghost, true);
    assert.match(cards[1].borderStyle, /dashed/);
    assert.equal(cards[1].beforeContent, "none");
    assert.match(cards[2].text, /Older Activity Note/);

    await page.locator(".activity-card", { hasText: "Filed Activity Note" }).click();
    assert.equal(await page.locator(".tab.active").innerText(), "Files");
    assert.match(await page.locator("#doc-path").innerText(), /wiki \/ projects/);
    assert.match(await page.locator("#doc-title").innerText(), /source-2026-05-06-filed-note/);

    await page.getByRole("button", { name: "Activity" }).click();
    await page.locator(".activity-pill", { hasText: "Briefly" }).first().click();
    assert.equal(await page.locator(".tab.active").innerText(), "Files");
    assert.match(await page.locator("#doc-title").innerText(), /briefly/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("files tab opens CLAUDE.md by default", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedActivitySections());
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator("#wiki-view.active").waitFor();
    assert.equal(await page.locator("#doc-title").innerText(), "CLAUDE");
    assert.equal(await page.locator(".vault-file.active").getAttribute("data-path"), "CLAUDE.md");
    assert.match(await page.locator("#doc-body").inputValue(), /Read this before operating the vault/);
    await page.waitForFunction(() => {
      const pane = document.querySelector(".vault-document");
      return pane && pane.scrollHeight > pane.clientHeight;
    });
    const scrollableDocument = await page.locator(".vault-document").evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight
    }));
    assert.ok(scrollableDocument.scrollHeight > scrollableDocument.clientHeight);
    await page.locator(".vault-document").evaluate((el) => {
      el.scrollTop = 320;
    });
    assert.ok(await page.locator(".vault-document").evaluate((el) => el.scrollTop) > 0);
    await page.locator(".vault-folder summary", { hasText: "wiki" }).click();
    await page.locator(".vault-file[data-path='wiki/index.md']").waitFor();
    await page.locator(".vault-folder summary", { hasText: "commands" }).waitFor();
    await page.locator(".vault-folder summary", { hasText: "agents" }).waitFor();
    await page.locator(".vault-file[data-path='wiki/index.md']").click();
    assert.equal(await page.locator("#doc-title").innerText(), "index");
    assert.match(await page.locator("#doc-body").inputValue(), /# Index/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("dream tab renders actionable vault triage", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedActivitySections());
    await page.getByRole("button", { name: "Dream", exact: true }).click();
    await page.locator("#dream-view.active").waitFor();
    assert.equal(await page.locator("#dream-mode-toggle").inputValue(), "hybrid");
    await page.locator("#dream-mode-help", { hasText: "Safe cleanup first" }).waitFor();
    await page.locator("#dream-pass-status").waitFor({ state: "hidden" });
    await page.locator("#dream-mode-toggle").selectOption("walk");
    await page.locator("#dream-mode-help", { hasText: "Shows one decision at a time." }).waitFor();
    await page.locator("#dream-mode-toggle").selectOption("hybrid");
    await page.locator("#dream-mode-help", { hasText: "Safe cleanup first" }).waitFor();
    await page.getByText("Maintenance pass ready").waitFor();
    await page.getByText("Check maintenance items").waitFor();
    assert.equal(await page.locator("#dream-operation-list .dream-op-card").count(), 5);
    await page.locator("#dream-operation-list", { hasText: "Source queue" }).waitFor();
    await page.locator("#dream-operation-list", { hasText: "System cleanup" }).waitFor();
    await page.locator("#dream-operation-list", { hasText: "Link cleanup" }).waitFor();
    await page.locator("#dream-proposal-list", { hasText: "Create maintenance log entry" }).waitFor();
    await page.locator("#dream-proposal-list button", { hasText: "Bulk process now" }).waitFor();
    await page.locator("#dream-log-entries", { hasText: "Checked source queue" }).waitFor();
    await page.locator("#dream-log-entries", { hasText: "1 pending source still needs processing." }).waitFor();
    assert.equal(await page.locator("#dream-proposal-list button:disabled").count(), 0);
    await page.getByRole("button", { name: "Run maintenance" }).click();
    await page.locator("#dream-pass-status", { hasText: "Auto + review pass finished" }).waitFor();
    await page.locator("#dream-log-entries", { hasText: "Recorded maintenance pass" }).waitFor();
    await page.locator("#dream-proposal-list", { hasText: "Step 1 of" }).waitFor();
    await page.locator("#dream-proposal-list button", { hasText: "Bulk process now" }).waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});

test("dream broken-link action runs a cleanup helper through the configured API", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.__dreamHelperCalls = [];
      window.fetch = async (_url, options = {}) => {
        const body = JSON.parse(options.body || "{}");
        window.__dreamHelperCalls.push(body);
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                text: [
                  "```margins-file path=\"wiki/projects/project-home.md\"",
                  "---",
                  "type: project",
                  "summary: Project home page with a review note for a missing advisor link.",
                  "---",
                  "",
                  "# Project Home",
                  "",
                  "This project references [[Missing Advisor]] and [[known-company]].",
                  "",
                  "## Needs review",
                  "",
                  "- Missing Advisor needs Connor review before linking.",
                  "```"
                ].join("\n")
              }]
            }
          }],
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 80,
            thoughtsTokenCount: 0,
            totalTokenCount: 200
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
      return window.__marginsTest.seedDreamBrokenLinks();
    });
    await page.getByRole("button", { name: "Dream", exact: true }).click();
    await page.locator("#dream-view.active").waitFor();
    await page.locator("#dream-proposal-list", { hasText: "broken wiki link" }).waitFor();
    await page.locator("#dream-proposal-list button", { hasText: "Run link helper" }).click();
    await page.locator("#llm-view.active").waitFor();
    await page.locator("#llm-file-list", { hasText: "wiki/projects/project-home.md" }).waitFor();
    assert.match(await page.locator("#llm-status").textContent(), /helper returned 1 file/);
    const calls = await page.evaluate(() => window.__dreamHelperCalls);
    assert.equal(calls.length, 1);
    const prompt = calls[0].contents[0].parts[0].text;
    assert.match(prompt, /Repair broken wiki links/);
    assert.match(prompt, /wiki\/projects\/project-home\.md -> \[\[Missing Advisor\]\]/);
    assert.match(prompt, /Operating guardrails/);
    assert.match(prompt, /Wiki Editor Agent/);
    assert.match(prompt, /Source Auditor/);
    assert.equal(calls[0].generationConfig.responseMimeType, undefined);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("recent activity pages in batches of twelve and treats date-only values as local days", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const activity = await page.evaluate(() => window.__marginsTest.seedManyRecentActivitySources(30));
    assert.equal(activity.cardCount, 12);
    assert.match(activity.recentText, /Show 12 more/);
    assert.match(await page.locator(".activity-card", { hasText: "Recent Activity 01" }).locator(".activity-card-date").innerText(), /yesterday/);

    await page.getByRole("button", { name: "Show 12 more" }).click();
    assert.equal(await page.locator("#recent-activity-list .activity-card").count(), 24);
    await page.getByRole("button", { name: "Show all 30" }).click();
    assert.equal(await page.locator("#recent-activity-list .activity-card").count(), 30);
    assert.equal(await page.locator(".activity-section-actions").count(), 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entities tab renders real vault entity pages without sidebar ingestion stats", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedGraphTheme("light"));
    await page.getByRole("button", { name: "Entities" }).click();

    await page.locator("#entities-view.active").waitFor();
    const entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Connor/);
    assert.match(entitiesText, /Connor entity/);
    assert.doesNotMatch(entitiesText, /Bob Casey|Ellis Rutili|Centric WM/);
    assert.equal(await page.locator(".upload-stats").count(), 0);

    await page.locator(".entity-card", { hasText: "Connor" }).click();
    await page.locator("#wiki-view.active").waitFor();
    assert.match(await page.locator("#doc-title").innerText(), /connor/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entities tab falls back to real concept pages when no entity folder exists", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedConceptOnlyVault());
    await page.getByRole("button", { name: "Entities" }).click();

    const entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Setup Efficiency/);
    assert.match(entitiesText, /CONCEPT/);
    assert.doesNotMatch(entitiesText, /No entities loaded/);
    assert.doesNotMatch(entitiesText, /Source Only|Index/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entities tab filters by real wiki type and tag facets", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedConceptOnlyVault());
    await page.getByRole("button", { name: "Entities" }).click();
    await page.locator("#entity-controls:not([hidden])").waitFor();

    assert.match(await page.locator("#entity-meta").innerText(), /3 in your brain/);
    assert.match(await page.locator("#entity-type-filters").innerText(), /All\s+3/);
    assert.match(await page.locator("#entity-tag-filters").innerText(), /build\s+2/);
    assert.equal(await page.locator(".entity-card-tags").count(), 0);
    assert.match(await page.locator(".entity-section-head").first().innerText(), /PINNED/);
    assert.match(await page.locator(".entity-card", { hasText: "Margins Product" }).innerText(), /Next: Ship the Claude-style entity card model/);

    await page.locator('[data-entity-filter-kind="tag"][data-entity-filter-value="build"]').click();
    let entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Setup Efficiency/);
    assert.match(entitiesText, /Margins Product/);
    assert.doesNotMatch(entitiesText, /Networking Plan/);

    await page.locator('[data-entity-filter-kind="tag"][data-entity-filter-value="margins"]').click();
    entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Margins Product/);
    assert.doesNotMatch(entitiesText, /Setup Efficiency|Networking Plan/);

    await page.locator('[data-entity-filter-kind="type"][data-entity-filter-value="Project"]').click();
    entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Margins Product/);
    assert.doesNotMatch(entitiesText, /Setup Efficiency|Networking Plan/);

    await page.locator('[data-entity-filter-kind="all"]').click();
    await page.locator("#entity-search").fill("networking");
    entitiesText = await page.locator("#entity-browser").innerText();
    assert.match(entitiesText, /Networking Plan/);
    assert.doesNotMatch(entitiesText, /Setup Efficiency|Margins Product/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entity type chip writes primary_type overrides from picker", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedTypeOverrideEntityVault());
    await page.getByRole("button", { name: "Entities" }).click();

    const card = page.locator(".entity-card", { hasText: "E.J. Reynolds" });
    await card.locator(".entity-type-chip", { hasText: "Project" }).click();
    await card.locator(".entity-type-picker").waitFor();
    await card.locator(".entity-type-option", { hasText: "Project" }).getByText("2").waitFor();
    await card.locator(".entity-type-option", { hasText: "Company" }).getByText("1").waitFor();
    await card.locator(".entity-type-option", { hasText: "Person" }).getByText("0").waitFor();

    await card.locator("[data-entity-type-custom-input]").fill("acquaintance");
    await card.getByRole("button", { name: "Use" }).click();
    await card.locator(".entity-type-chip", { hasText: "Acquaintance" }).waitFor();
    assert.match(
      await page.evaluate(() => window.__marginsTest.wikiBody("wiki/projects/ej-reynolds.md")),
      /primary_type: acquaintance/
    );

    await card.locator(".entity-type-chip", { hasText: "Acquaintance" }).click();
    await card.locator(".entity-type-option", { hasText: "Person" }).click();
    await card.locator(".entity-type-chip", { hasText: "Person" }).waitFor();
    assert.match(
      await page.evaluate(() => window.__marginsTest.wikiBody("wiki/projects/ej-reynolds.md")),
      /primary_type: person/
    );
    assert.match(await page.locator("#entity-type-filters").innerText(), /People\s+1/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entity filter chips wrap as one continuous control set", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedCrowdedEntityFacets());
    await page.getByRole("button", { name: "Entities" }).click();
    await page.locator("#entity-controls:not([hidden])").waitFor();

    const layout = await page.evaluate(() => {
      const chips = [...document.querySelectorAll(".entity-chip")].map((chip) => {
        const rect = chip.getBoundingClientRect();
        return {
          text: chip.textContent.replace(/\s+/g, " ").trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top
        };
      });
      return {
        hubs: chips.find((chip) => /^Hubs 1$/.test(chip.text)),
        briefly: chips.find((chip) => /^briefly \d+$/.test(chip.text))
      };
    });

    assert.ok(layout.hubs, "expected a Hubs type chip");
    assert.ok(layout.briefly, "expected a briefly tag chip");
    assert.ok(Math.abs(layout.hubs.top - layout.briefly.top) < 6, "first tag chip should continue on the Hubs row");
    assert.ok(layout.briefly.left > layout.hubs.right, "first tag chip should sit after Hubs, not start a new row");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("recently active entities page in batches of twelve", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedManyRecentEntities());
    await page.getByRole("button", { name: "Entities" }).click();
    const recentSection = page.locator('[data-entity-section="recent"]');
    await recentSection.waitFor();

    assert.equal(await recentSection.locator(".entity-card").count(), 12);
    let recentText = await recentSection.innerText();
    assert.match(recentText, /12 of 30/);
    assert.match(recentText, /Recent Entity 30/);
    assert.doesNotMatch(recentText, /Recent Entity 18/);

    await recentSection.getByRole("button", { name: "Show 12 more" }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-entity-section="recent"] .entity-card').length === 24);
    assert.equal(await recentSection.locator(".entity-card").count(), 24);
    recentText = await recentSection.innerText();
    assert.match(recentText, /24 of 30/);
    assert.match(recentText, /Recent Entity 18/);
    assert.doesNotMatch(recentText, /Recent Entity 06/);

    await recentSection.getByRole("button", { name: "Show all 30" }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-entity-section="recent"] .entity-card').length === 30);
    assert.equal(await recentSection.locator(".entity-card").count(), 30);
    recentText = await recentSection.innerText();
    assert.match(recentText, /Recent Entity 01/);
    assert.equal(await recentSection.locator(".entity-section-actions").count(), 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entity card pin controls write priority metadata to the vault", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedEntityPinningVault());
    await page.getByRole("button", { name: "Entities" }).click();

    const pinTarget = page.locator(".entity-card", { hasText: "Pin Target" });
    await pinTarget.getByRole("button", { name: "Pin Pin Target" }).click();
    await page.waitForFunction(() => document.querySelector('[data-entity-section="pinned"]')?.innerText.includes("Pin Target"));

    let body = await page.evaluate(() => window.__marginsTest.readVaultText("wiki/entities/pin-target.md"));
    assert.match(body, /^priority:\s*pinned$/m);
    assert.match(await page.locator('[data-entity-section="pinned"]').innerText(), /Pin Target/);
    assert.equal(await page.locator('[data-entity-section="recent"] .entity-card', { hasText: "Pin Target" }).count(), 0);

    const pinnedTarget = page.locator(".entity-card", { hasText: "Pinned Target" });
    await pinnedTarget.getByRole("button", { name: "Unpin Pinned Target" }).click();
    await page.waitForFunction(() => document.querySelector('[data-entity-section="recent"]')?.innerText.includes("Pinned Target"));

    body = await page.evaluate(() => window.__marginsTest.readVaultText("wiki/entities/pinned-target.md"));
    assert.doesNotMatch(body, /^priority:\s*pinned$/m);
    assert.match(await page.locator('[data-entity-section="recent"]').innerText(), /Pinned Target/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("entities filters keep broad wiki-folder vaults loaded", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const loaded = await page.evaluate(() => window.__marginsTest.loadBroadWikiVault());
    assert.ok(loaded.currentFileCount > 0);
    assert.match(loaded.entityText, /Riviera/);
    assert.match(loaded.entityText, /Bob Casey/);

    await page.getByRole("button", { name: "Entities" }).click();
    await page.locator('[data-entity-filter-kind="tag"][data-entity-filter-value="build"]').click();
    const filteredText = await page.locator("#entity-browser").innerText();
    assert.match(filteredText, /Riviera/);
    assert.doesNotMatch(filteredText, /Bob Casey|No entities loaded/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("workflow reconnect button opens the remembered vault", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const before = await page.evaluate(() => window.__marginsTest.prepareRememberedVaultReconnect());
    assert.equal(before.workflowButton, "Reconnect vault");
    assert.equal(before.currentFileCount, 0);

    await page.locator("#workflow-btn").click();
    await page.waitForFunction(() => window.__marginsTest.workflowSnapshot().currentFileCount > 0);

    const after = await page.evaluate(() => window.__marginsTest.workflowSnapshot());
    assert.equal(after.vaultName, "Browser Test Vault");
    assert.match(after.vaultStatus, /Browser Test Vault/);
    assert.match(after.workflowButton, /Add documents/);

    await page.getByRole("button", { name: "Entities" }).click();
    assert.match(await page.locator("#entity-browser").innerText(), /Reconnect Project/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("imported documents are immediately preserved in raw/ and survive reload", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const result = await page.evaluate(() => window.__marginsTest.importSourceAndReloadFromRaw());
    assert.equal(result.rawBody, "Persisted source body\n");
    assert.equal(result.legacyRawExists, false);
    assert.deepEqual(result.savedBeforeReload, ["incoming-note.md"]);
    assert.equal(result.scopeBeforeReload, "vault");
    assert.deepEqual(result.pendingAfterReload, ["incoming-note.md"]);
    assert.equal(result.sourceScopeAfterReload, "vault");
    assert.match(result.sourceListText, /incoming-note\.md/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("vault save removes generated files that left the working file map", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const result = await page.evaluate(() => window.__marginsTest.saveWithDeletedGeneratedPath());
    assert.equal(result.oldExists, false);
    assert.equal(result.keptBody, "# Kept source updated\n");
    assert.equal(result.loadedHasOld, false);
    assert.equal(result.pendingSave, false);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("LLM utility view is visible when activated", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const state = await page.evaluate(() => window.__marginsTest.showLlmView());
    assert.deepEqual(state, { active: true, hidden: false });
  } finally {
    await browser.close();
    await server.close();
  }
});

test("sidebar theme switch toggles and persists dark mode", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const light = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      label: document.querySelector("#theme-toggle-label")?.textContent || "",
      bodyBg: getComputedStyle(document.body).backgroundColor,
      sidebarBg: getComputedStyle(document.querySelector(".sidebar")).backgroundColor
    }));

    await page.locator("#theme-toggle").check({ force: true });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");

    const dark = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      stored: localStorage.getItem("margins-theme"),
      label: document.querySelector("#theme-toggle-label")?.textContent || "",
      bodyBg: getComputedStyle(document.body).backgroundColor,
      sidebarBg: getComputedStyle(document.querySelector(".sidebar")).backgroundColor
    }));

    assert.equal(light.theme, "light");
    assert.equal(light.label, "Light mode");
    assert.equal(dark.theme, "dark");
    assert.equal(dark.stored, "dark");
    assert.equal(dark.label, "Dark mode");
    assert.notEqual(light.bodyBg, dark.bodyBg);
    assert.notEqual(light.sidebarBg, dark.sidebarBg);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("graph tab follows the active app theme", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const light = await page.evaluate(() => window.__marginsTest.seedGraphTheme("light"));
    const dark = await page.evaluate(() => window.__marginsTest.seedGraphTheme("dark"));

    assert.equal(light.theme, "light");
    assert.equal(dark.theme, "dark");
    assert.notEqual(light.wrapBg, dark.wrapBg);
    assert.notEqual(light.headerBg, dark.headerBg);
    assert.notEqual(light.backdropFill, dark.backdropFill);
    assert.notEqual(light.projectNodeFill, dark.projectNodeFill);
    assert.match(light.projectNodeFill, /rgb\(111,\s*168,\s*99\)/);
    assert.equal(Number(light.glowOpacity) < 0.2, true);
    assert.equal(Number(dark.glowOpacity) < 0.2, true);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("graph interactions use hover emphasis, fine zoom, click-open, and linked drag pull", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedGraphTheme("light"));
    await page.waitForFunction(() => window.__marginsTest.graphState().alpha < 0.08);
    assert.equal((await page.evaluate(() => window.__marginsTest.graphState())).activeEdges, 0);
    const hovered = await page.evaluate(() => window.__marginsTest.movePointerToGraphNode("concepts/setup-efficiency"));
    assert.ok(hovered.activeEdges > 0);
    const cleared = await page.evaluate(() => window.__marginsTest.movePointerOutsideGraph());
    assert.equal(cleared.activeEdges, 0);

    const zoomed = await page.evaluate(() => window.__marginsTest.wheelGraph(20).transform.k);
    assert.ok(zoomed > 0.96 && zoomed < 0.995, `Expected fine zoom step, got ${zoomed}`);

    await page.evaluate(() => window.__marginsTest.seedGraphTheme("light"));
    await page.waitForFunction(() => window.__marginsTest.graphState().alpha < 0.08);
    const beforeDrag = await page.evaluate(() => window.__marginsTest.graphState().nodes["entities/connor"]);
    await page.evaluate(() => window.__marginsTest.dragGraphNode("concepts/setup-efficiency", 150, 24));
    await page.waitForTimeout(180);
    const afterDrag = await page.evaluate(() => window.__marginsTest.graphState().nodes["entities/connor"]);
    assert.ok(Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y) > 2);

    await page.evaluate(() => window.__marginsTest.seedGraphTheme("light"));
    await page.waitForFunction(() => window.__marginsTest.graphState().alpha < 0.08);
    const opened = await page.evaluate(() => window.__marginsTest.clickGraphNode("concepts/setup-efficiency"));
    assert.equal(opened.activeView, "wiki-view");
    assert.equal(opened.selectedPath, "wiki/concepts/setup-efficiency.md");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("hung model requests time out into a retryable inbox state", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => {
      window.fetch = async () => new Promise(() => {});
      window.__marginsTest.setApiRequestTimeout(50);
      window.__marginsTest.seedVaultPdfAttachmentSource();
    });

    await page.locator(".source-item", { hasText: "saved-report.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.getByText(/timed out after 1 seconds/i).waitFor();
    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Review did not finish/);
    assert.match(pendingText, /Retry/);
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
    await page.locator("#pending-count-label", { hasText: "3 pending" }).waitFor();
    assert.match(pendingText, /pending-word\.docx/);
    assert.match(pendingText, /pending-statement\.pdf/);
    assert.match(pendingText, /script\/build\.py/);
    assert.equal((pendingText.match(/Process/g) || []).length, 3);
    assert.equal(await page.locator("#source-list .source-timestamp").count(), 3);
    assert.equal(await page.locator("#source-list .source-item.pending-ghost").count(), 3);
    assert.match(await page.locator("#source-list .source-item").first().evaluate((node) => getComputedStyle(node).borderStyle), /dashed/);
    assert.equal(await page.locator("#source-list .source-item").first().evaluate((node) => getComputedStyle(node, "::before").content), "none");
    assert.doesNotMatch(pendingText, /LLM attachment|0 words|DOCX text extraction|Word text|PDF text|words ready|source file saved/i);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("pending source cards page in batches of six", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    await page.evaluate(() => window.__marginsTest.seedPendingSourceCount(14));
    await page.locator("#pending-count-label", { hasText: "14 pending" }).waitFor();
    assert.equal(await page.locator("#source-list .source-item").count(), 6);
    await page.locator("#source-list").getByRole("button", { name: "Show 6 more" }).click();
    assert.equal(await page.locator("#source-list .source-item").count(), 12);
    await page.locator("#source-list").getByRole("button", { name: "Show all 14" }).click();
    assert.equal(await page.locator("#source-list .source-item").count(), 14);
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
    await page.locator("#pending-count-label", { hasText: "2 pending" }).waitFor();
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
  const pressed = await page.locator(".quick-answer", { hasText: label }).first().getAttribute("aria-pressed");
  assert.equal(pressed, "true");
}

async function assertAnswered(page, text) {
  await page.getByText(text).first().waitFor();
}

async function openReceiptDetails(card) {
  const details = card.locator(".receipt-details").first();
  const isOpen = await details.evaluate((node) => Boolean(node.open));
  if (!isOpen) await details.locator("summary").click();
  await details.locator(".receipt-details-body").waitFor({ state: "visible" });
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
