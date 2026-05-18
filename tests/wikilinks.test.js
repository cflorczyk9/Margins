import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createWikilinks } from "../src/wikilinks.js";

let tmpRoot;
let vault;
let wikilinks;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-wl-"));
  vault = createVault(tmpRoot);
  wikilinks = createWikilinks(vault);
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
