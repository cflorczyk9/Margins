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
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: {
                    overview: "This call captures a business opportunity and the follow-up context around it.",
                    bullets: [
                      "Larry is sharing a possible CFO or chief-of-staff style opportunity.",
                      "The source includes useful context about timing, compensation, and risk.",
                      "The next useful step is deciding whether this should become an active follow-up."
                    ]
                  },
                  connections: [
                    {
                      path: "wiki/relationships/larry-abrahams.md",
                      title: "Larry Abrahams",
                      type: "existing",
                      reason: "Larry is central to the source."
                    }
                  ],
                  questions: [
                    {
                      kind: "Follow-up",
                      question: "Should Margins treat this as an active opportunity to track?",
                      reason: "That changes whether the source becomes a task-like follow-up.",
                      recommendation: "My take: yes if you expect another conversation.",
                      options: ["Track it", "Just file it", "Skip"]
                    }
                  ]
                })
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
    assert.match(calls[0].body.contents[0].parts[0].text, /Return 1-2 high-signal questions/);

    const card = page.locator(".source-item.ready-to-write", { hasText: "model-source-1.txt" });
    await card.getByText("Gemini reviewed").waitFor();
    assert.equal(await card.locator(".run-brief-points li").count(), 3);
    await card.getByText("Should Margins treat this as an active opportunity to track?").waitFor();
    await card.getByRole("button", { name: "Track it" }).click();
    await card.getByText("Answered: Track it").waitFor();
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
    assert.match(calls[0].body.contents[0].parts[0].text, /Return 1-2 high-signal questions/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Name: pending-word\.docx/);
    assert.match(calls[0].body.contents[0].parts[0].text, /Type: docx/);
    assert.equal(calls[0].body.contents[0].parts.some((part) => part.inline_data?.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);

    await card.getByText("Gemini reviewed").waitFor();
    assert.equal(await card.locator(".run-brief-points li").count() >= 3, true);
    const visibleSummary = normalizeText(await card.locator(".run-summary").innerText());
    assert.equal(visibleSummary.length < 700, true);

    const actionableQuestions = await card.locator(".run-question").count();
    const cardText = normalizeText(await card.innerText());
    const explicitNoQuestionsState = /model (returned|sent|provided) no questions|no model questions/i.test(cardText);
    assert.ok(
      actionableQuestions >= 1 || explicitNoQuestionsState,
      "Expected a call-like DOCX to show an actionable follow-up, or a clear state that the model returned no questions."
    );
    assert.doesNotMatch(cardText, /Review complete\.\s+File this source into the vault\./);
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
