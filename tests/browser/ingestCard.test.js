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
    assert.match(pendingText, /showing the local review/);
    assert.match(pendingText, /Retry later for model-generated questions/);
    assert.match(pendingText, /Local review ready/);
    assert.doesNotMatch(pendingText, /Gemini reviewed/);
    await page.locator(".run-action-row").getByRole("button", { name: "Approve" }).waitFor();
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

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Gemini returned a malformed review/);
    assert.doesNotMatch(cardText, /Financial details/);
    assert.doesNotMatch(cardText, /Financial source/);
    assert.doesNotMatch(cardText, /Should Margins keep extracted figures and account details/);
    assert.doesNotMatch(cardText, /Keep demo figures/);
    const sourceNote = await page.evaluate(() => window.__marginsTest.sourceNoteBody("coleman-brokerage-2026-03.pdf"));
    assert.doesNotMatch(sourceNote, /## Financial Details/);
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
    assert.match(cardText, /Gemini reviewed the source but did not return a card summary/);
    assert.match(cardText, /Zoom transcript from April 2026/);
    assert.match(cardText, /Should this Booth conversation stay active for follow-up tracking/);
    assert.doesNotMatch(cardText, /Model review failed/);
    assert.doesNotMatch(cardText, /financial account document/);
    assert.doesNotMatch(cardText, /Financial source/);
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

    const cardText = normalizeText(await card.innerText());
    const summaryText = normalizeText(await card.locator(".run-summary").innerText());
    assert.match(cardText, /Gemini reviewed the source but did not return a card summary/);
    assert.match(summaryText, /16 Brutal Life Lessons for Ambitious People - Michael Smoak/);
    assert.match(summaryText, /Michael Smoak is a mindset coach/);
    assert.doesNotMatch(summaryText, /title:/);
    assert.doesNotMatch(summaryText, /source:/);
    assert.doesNotMatch(summaryText, /tags:/);
    assert.doesNotMatch(summaryText, /youtube\.com\/watch/);
    assert.doesNotMatch(cardText, /Chase · financial account document/);
    assert.doesNotMatch(cardText, /Financial details/);
    assert.doesNotMatch(cardText, /Financial source/);
    assert.doesNotMatch(cardText, /extracted figures and account details/);
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

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Gemini reviewed/);
    assert.match(cardText, /Financial details/);
    assert.match(cardText, /Charles Schwab · brokerage statement · owner: Sarah Coleman · last4: 4321 · 2026-03/);
    assert.match(cardText, /Total account value .* \$128,430\.52/);
    assert.match(cardText, /Cash balance .* \$4,220\.17/);
    assert.match(cardText, /GOOG · 12 shares · \$24,600\.00/);
    assert.match(cardText, /2026-03-15 · dividend · Dividend GOOG · \$125\.33/);
    assert.doesNotMatch(cardText, /Model review failed/);

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

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Gemini reviewed/);
    assert.match(cardText, /Use this Booth source as a relationship and product-market context note/);
    assert.match(cardText, /Primary: Booth is discussing marketing and product-management fit/);
    assert.match(cardText, /Amazon account strategy is context, not a financial account statement/);
    assert.match(cardText, /wiki\/relationships\/booth\.md · add_backlink/);
    assert.match(cardText, /Should Booth stay in active relationship follow-up/);
    assert.doesNotMatch(cardText, /did not return a card summary/);
    assert.doesNotMatch(cardText, /Model review failed/);
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
        maxSessionTokens: 250000,
        maxSessionUsd: 0.0001
      });
      window.__marginsTest.seedReadablePdfSource();
    });

    await page.locator(".source-item", { hasText: "text-layer-report.pdf" }).getByRole("button", { name: "Process" }).click();
    await page.locator(".source-item.ready-to-write", { hasText: "text-layer-report.pdf" }).waitFor();

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

    await page.getByRole("button", { name: "Bulk ingest" }).click();
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
    assert.match(calls[0].body.contents[0].parts[0].text, /asks-only response is incomplete/i);
    assert.match(calls[0].body.contents[0].parts[0].text, /Do not infer finance from isolated words/i);
    assert.deepEqual(calls[0].body.generationConfig.responseSchema.required, [
      "summary",
      "takeaways",
      "connections",
      "financialDetails",
      "asks"
    ]);

    const card = page.locator(".source-item.ready-to-write", { hasText: "model-source-1.txt" });
    await card.getByText("Gemini reviewed", { exact: true }).waitFor();
    await card.getByText("Use this call as an opportunity source note").waitFor();
    await card.getByText("Opportunity: Larry is sharing a possible CFO").waitFor();
    await card.getByText("Do not promote every company mention").waitFor();
    await card.getByText("wiki/relationships/larry-abrahams.md · add_backlink").waitFor();
    await card.getByText("Should Margins treat this as an active opportunity to track?").waitFor();
    await card.getByRole("button", { name: "Track it" }).click();
    await card.getByText("Answered: Track it").waitFor();

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
    assert.match(calls[0].body.contents[0].parts[0].text, /Name: pending-word\.docx/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Type: docx/);
    assert.deepEqual(calls[0].body.generationConfig.responseSchema.required, [
      "summary",
      "takeaways",
      "connections",
      "financialDetails",
      "asks"
    ]);
    assert.equal(calls[0].body.contents[0].parts.some((part) => part.inline_data?.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);

    await card.getByText("Gemini reviewed", { exact: true }).waitFor();
    assert.equal(await card.locator(".run-brief-points li").count() >= 3, true);
    const visibleSummary = normalizeText(await card.locator(".run-summary").innerText());
    assert.equal(visibleSummary.length < 700, true);

    const cardText = normalizeText(await card.innerText());
    assert.match(cardText, /Gemini reviewed the source but did not return follow-up questions/);
    await card.getByText("Review complete.").waitFor();
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
    await page.getByText("Review did not finish").waitFor();

    const pendingText = await page.locator("#source-list").innerText();
    assert.match(pendingText, /Gemini quota or rate limit reached/);
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
    assert.equal(await page.locator(".upload-stats").count(), 0);
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

test("imported documents are immediately saved to raw_sources and survive reload", {
  skip: shouldRunBrowser ? false : "Set MARGINS_BROWSER_TEST=1 and install Chrome to run browser smoke tests."
}, async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/index.html?marginsTest=1`);
    await page.waitForFunction(() => Boolean(window.__marginsTest));

    const result = await page.evaluate(() => window.__marginsTest.importSourceAndReloadFromRaw());
    assert.equal(result.rawBody, "Persisted raw body\n");
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
