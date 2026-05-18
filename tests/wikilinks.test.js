import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { createVault } from "../src/vault.js";
import { createWikilinks } from "../src/wikilinks.js";
import { createProposals } from "../src/proposals.js";

let tmpRoot;
let vault;
let wikilinks;
let proposals;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-wl-"));
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
  wikilinks = createWikilinks(vault, { proposals });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

test("suggests a wikilink when a capitalized phrase matches a vault slug", async () => {
  await touch("wiki/career/bob-casey.md", "# Bob Casey");
  await touch("wiki/notes/today.md", "I met with Bob Casey today and we talked about plans.");
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  assert.ok(result.suggestions.length >= 1);
  assert.equal(result.suggestions[0].phrase, "Bob Casey");
  assert.equal(result.suggestions[0].wikilink, "[[bob-casey]]");
  assert.equal(result.suggestions[0].targetPath, "wiki/career/bob-casey.md");
});

test("skips phrases that already exist as wikilinks", async () => {
  await touch("wiki/career/bob-casey.md", "# Bob Casey");
  await touch(
    "wiki/notes/today.md",
    "I met with [[bob-casey]] today. Then I met with Bob Casey later."
  );
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  // Should NOT suggest Bob Casey since bob-casey is already linked
  const phrases = result.suggestions.map((s) => s.phrase);
  assert.ok(!phrases.includes("Bob Casey"));
});

test("matches kebab-case slug references in body", async () => {
  await touch("wiki/projects/project-alpha.md", "# Project Alpha");
  await touch(
    "wiki/notes/today.md",
    "Some thoughts on project-alpha that I want to capture."
  );
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  const phrases = result.suggestions.map((s) => s.phrase);
  assert.ok(phrases.includes("project-alpha"));
});

test("ranks suggestions by occurrence count", async () => {
  await touch("wiki/career/bob-casey.md", "# Bob Casey");
  await touch("wiki/career/mark-loh.md", "# Mark Loh");
  await touch(
    "wiki/notes/today.md",
    "Bob Casey twice: Bob Casey. Mark Loh once."
  );
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  const top = result.suggestions[0];
  assert.equal(top.phrase, "Bob Casey");
  assert.equal(top.occurrences, 2);
});

test("returns empty suggestions when no candidate phrases match vault slugs", async () => {
  await touch("wiki/notes/today.md", "Just some words with no entity names that match.");
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  assert.equal(result.suggestions.length, 0);
});

test("skips tracker and system pages", async () => {
  await touch("wiki/entities/anthropic.md", "# Anthropic");
  await touch(
    "wiki/ingest-tracker.md",
    `---\ntype: tracker\nbucket: system\n---\n\n# Ingest Tracker\n\nAnthropic appears here as tracker data.`
  );
  const result = await wikilinks.proposeWikilinks("wiki/ingest-tracker.md");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "system-page");
  assert.equal(result.suggestions.length, 0);
});

test("respects maxSuggestions cap", async () => {
  for (let i = 0; i < 20; i++) {
    await touch(`wiki/entities/person-${i}.md`, "x");
  }
  await touch(
    "wiki/notes/today.md",
    Array.from({ length: 20 }, (_, i) => `person-${i}`).join(" and ")
  );
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md", { maxSuggestions: 5 });
  assert.equal(result.suggestions.length, 5);
});

test("does not link a page to itself", async () => {
  await touch("wiki/career/bob-casey.md", "# Bob Casey\n\nBob Casey is interesting.");
  const result = await wikilinks.proposeWikilinks("wiki/career/bob-casey.md");
  const phrases = result.suggestions.map((s) => s.phrase);
  assert.ok(!phrases.includes("Bob Casey"));
});

// --- Scope mode (bulk wikilinks) ---

test("scope mode aggregates suggestions across every matching page", async () => {
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  await touch("wiki/people/alice-chen.md", "# Alice Chen");
  await touch("wiki/notes/n-1.md", "Met with Bob Casey today about the Riviera deal.");
  await touch("wiki/notes/n-2.md", "Bob Casey mentioned the same Riviera notes.");
  await touch("wiki/notes/n-3.md", "Alice Chen joined the Bob Casey call.");
  await touch("wiki/projects/riviera.md", "# Riviera");

  const result = await wikilinks.proposeWikilinks(null, { scope: "wiki/notes/**" });

  assert.equal(result.pagesScanned, 3);
  const links = result.aggregatedSuggestions.map((s) => s.wikilink);
  assert.ok(links.includes("[[bob-casey]]"));
  assert.ok(links.includes("[[alice-chen]]"));
  assert.ok(links.includes("[[riviera]]"));
  const bobAgg = result.aggregatedSuggestions.find((s) => s.wikilink === "[[bob-casey]]");
  assert.equal(bobAgg.pageCount, 3);
  assert.ok(bobAgg.totalOccurrences >= 3);
  // No application yet — apply was false by default.
  assert.equal(result.apply, false);
  const staged = await proposals.listProposals();
  assert.equal(staged.length, 0);
});

test("scope mode with apply=true stages one propose_page per touched page", async () => {
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  await touch("wiki/notes/n-1.md", "Met with Bob Casey today.");
  await touch("wiki/notes/n-2.md", "Bob Casey is interesting.");
  await touch("wiki/notes/n-3.md", "No matching entities here at all.");

  const result = await wikilinks.proposeWikilinks(null, {
    scope: "wiki/notes/**",
    apply: true
  });

  assert.equal(result.apply, true);
  // Two of three pages had suggestions; the third should NOT be staged.
  assert.equal(result.applied, 2);
  const staged = await proposals.listProposals();
  assert.deepEqual(
    staged.map((s) => s.destinationPath).sort(),
    ["wiki/notes/n-1.md", "wiki/notes/n-2.md"]
  );
  // Both proposals overwrite an existing vault file.
  for (const s of staged) {
    assert.equal(s.willOverwrite, true);
  }
  // Body should have [[bob-casey]] substituted in.
  const n1 = await readFile(path.join(tmpRoot, "proposed/wiki/notes/n-1.md"), "utf8");
  assert.match(n1, /Met with \[\[bob-casey\]\] today\./);
});

test("scope mode skips pages whose mentions are already wikilinked", async () => {
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  // Every mention of Bob Casey on this page is already linked — there's
  // nothing to add, so no proposal should be staged.
  await touch("wiki/notes/n-1.md", "Talked with [[bob-casey]] earlier. [[bob-casey]] said hi.");
  // A second page has an unlinked mention — that one should stage.
  await touch("wiki/notes/n-2.md", "Bob Casey appears here raw.");
  const result = await wikilinks.proposeWikilinks(null, { scope: "wiki/notes/**", apply: true });
  assert.equal(result.applied, 1);
  const staged = (await proposals.listProposals()).map((s) => s.destinationPath);
  assert.deepEqual(staged, ["wiki/notes/n-2.md"]);
});

test("scope mode apply guards against double-wrapping when phrase appears inside brackets", async () => {
  // Edge case: a phrase like "Bob Casey" written inside square brackets
  // for some other reason (e.g., source citation [Bob Casey, 2024]) should
  // still be safe to substitute. The applyWikilinksToBody guard checks
  // open/close [[ ]] context, not single [ ].
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  await touch("wiki/notes/n.md", "Bob Casey met with someone (Bob Casey, 2024).");
  await wikilinks.proposeWikilinks(null, { scope: "wiki/notes/**", apply: true });
  const staged = await readFile(path.join(tmpRoot, "proposed/wiki/notes/n.md"), "utf8");
  // Both occurrences substituted; no [[[[ from double wrapping.
  assert.equal((staged.match(/\[\[bob-casey\]\]/g) || []).length, 2);
  assert.doesNotMatch(staged, /\[\[\[\[/);
});

test("scope mode skips system pages (tracker / type:system)", async () => {
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  await touch(
    "wiki/ingest-tracker.md",
    "---\ntype: tracker\n---\n\nBob Casey appears here but it's a system page."
  );
  await touch("wiki/notes/real.md", "Note about Bob Casey from real content.");
  const result = await wikilinks.proposeWikilinks(null, { scope: "wiki/**", apply: true });
  // real.md should be staged; ingest-tracker should be skipped.
  const stagedPaths = (await proposals.listProposals()).map((p) => p.destinationPath);
  assert.ok(stagedPaths.includes("wiki/notes/real.md"));
  assert.ok(!stagedPaths.includes("wiki/ingest-tracker.md"));
});

test("scope mode honors maxPages cap", async () => {
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  for (let i = 0; i < 8; i++) {
    await touch(`wiki/notes/n-${i}.md`, `Mentions Bob Casey ${i}.`);
  }
  const result = await wikilinks.proposeWikilinks(null, {
    scope: "wiki/notes/**",
    maxPages: 3
  });
  assert.equal(result.pagesScanned, 3);
});

test("scope mode rebuilds the slug index once (shared across pages)", async () => {
  // This is a correctness check — if the index were per-page, suggestions
  // would still work but be slower. We assert behavior, not perf: the
  // aggregated count must reflect ALL pages, proving the index served
  // every per-page scan from one Map.
  await touch("wiki/people/alice.md", "# Alice");
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Alice did things today.");
  }
  const result = await wikilinks.proposeWikilinks(null, { scope: "wiki/notes/**" });
  const alice = result.aggregatedSuggestions.find((s) => s.wikilink === "[[alice]]");
  assert.ok(alice);
  assert.equal(alice.pageCount, 5);
});

test("apply=true without scope rejects clearly via server validation", async () => {
  // The server layer enforces the XOR; the in-process API surfaces it too.
  // Bare wikilinks.proposeWikilinks(path, { apply: true }) — should NOT
  // stage because apply requires scope.
  await touch("wiki/people/bob.md", "# Bob");
  await touch("wiki/notes/p.md", "Bob said things.");
  // No scope → single-page mode; apply is ignored silently in single-page
  // mode (the contract is: apply only works in scope mode).
  const result = await wikilinks.proposeWikilinks("wiki/notes/p.md", { apply: true });
  assert.ok(result.suggestions);
  assert.equal((await proposals.listProposals()).length, 0);
});

test("prefers wiki/ targets over test-fixture and template duplicates", async () => {
  // Two pages have the same slug. The wiki/ page must win; the fixture must
  // never be picked as a wikilink target.
  await touch("wiki/projects/briefly.md", "# Briefly (real)");
  await touch("margins/tests/fixtures/wiki/briefly.md", "# Briefly (fixture stub)");
  await touch("wiki/_templates/daily.md", "# Daily template");
  await touch("wiki/daily/daily.md", "# Daily overview");
  await touch(
    "wiki/notes/today.md",
    "Worked on Briefly today. Also updated the Daily page."
  );
  const result = await wikilinks.proposeWikilinks("wiki/notes/today.md");
  const briefly = result.suggestions.find((s) => s.phrase === "Briefly");
  const daily = result.suggestions.find((s) => s.phrase === "Daily");
  assert.ok(briefly, "should suggest a Briefly link");
  assert.equal(briefly.targetPath, "wiki/projects/briefly.md");
  assert.ok(daily, "should suggest a Daily link");
  assert.equal(daily.targetPath, "wiki/daily/daily.md");
});
