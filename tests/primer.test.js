import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createPrimer, formatSummary } from "../src/primer.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-primer-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body = "") {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

test("summarize on empty vault returns 0 + onboarding suggestions", async () => {
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.totalFiles, 0);
  assert.equal(summary.foldersByCount.length, 0);
  assert.ok(summary.suggestedQueries.length >= 1);
});

test("summarize counts files per folder", async () => {
  await touch("wiki/career/a.md");
  await touch("wiki/career/b.md");
  await touch("wiki/projects/c.md");
  await touch("daily/d.md");
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.totalFiles, 4);
  const top = summary.foldersByCount[0];
  assert.equal(top.folder, "wiki/career");
  assert.equal(top.count, 2);
});

test("populated vault suggested queries are persona-aware (A3 with no links references wikilinks)", async () => {
  // Many files, no wikilinks → A3 (Obsidian) or B3 (no Obsidian)
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  for (let i = 0; i < 15; i++) {
    await touch(`wiki/career/page${i}.md`, "Plain content, no links.");
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.persona.code, "A3");
  const joined = summary.suggestedQueries.join("\n");
  assert.match(joined, /wikilink|propose_wikilinks/);
});

test("populated linked vault classified as A1 with structure-aware suggestions", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  for (let i = 0; i < 15; i++) {
    await touch(`wiki/career/page${i}.md`, `Content with [[other${i}]] and [[third${i}]] links.`);
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.persona.code, "A1");
  const joined = summary.suggestedQueries.join("\n");
  assert.match(joined, /search_vault/);
});

test("formatSummary renders text without throwing for both empty and non-empty vaults", async () => {
  await touch("raw/a.md", "alpha");
  await touch("wiki/sources/source-a.md", "---\ntype: source\nraw_file: raw/a.md\n---\n# A");
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  const text = formatSummary(summary);
  assert.match(text, /2 markdown files/);
  assert.match(text, /Unprocessed files: 0/);
  assert.match(text, /Try asking me/);
});

test("pile mode triggers for A3 vault and includes sample + filenamePatterns + rawScan", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  // 25 unlinked files → A3 → pile mode.
  for (let i = 0; i < 25; i++) {
    await touch(`notes/file${i}.md`, `Plain unlinked content about Apex and Sarah.`);
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.mode, "pile");
  assert.equal(summary.persona.code, "A3");
  assert.ok(Array.isArray(summary.sample) && summary.sample.length > 0);
  assert.ok(Array.isArray(summary.filenamePatterns) && summary.filenamePatterns.length > 0);
  assert.ok(summary.rawScan && typeof summary.rawScan.totalRawFiles === "number");
  assert.ok(Array.isArray(summary.rawScan.priorityQueue));
  assert.ok(summary.guidance.length > 0);
});

test("pile mode populates rawScan.priorityQueue when raw/ has source files", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  for (let i = 0; i < 20; i++) {
    await touch(`vault-page-${i}.md`, "Unlinked content.");
  }
  // 8 raw source files of varying size
  for (let i = 0; i < 8; i++) {
    const body = "Meeting transcript: " + "Sarah discussed Apex pricing. ".repeat(20 + i * 10);
    await touch(`raw/raw-doc-${i}.md`, body);
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.mode, "pile");
  assert.equal(summary.rawScan.totalRawFiles, 8);
  assert.ok(summary.rawScan.priorityQueue.length > 0);
  assert.ok(summary.rawScan.priorityQueue.length <= 5);
  for (const q of summary.rawScan.priorityQueue) {
    assert.ok(q.path.startsWith("raw/"));
    assert.ok(typeof q.score === "number");
    assert.ok(typeof q.reason === "string");
  }
});

test("pile mode formatSummary renders sample snippets and guidance", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  for (let i = 0; i < 20; i++) {
    await touch(`pile/n${i}.md`, "Random Project Apex update notes.");
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  const text = formatSummary(summary);
  assert.match(text, /Mode: pile/);
  assert.match(text, /Sample of \d+/);
  assert.match(text, /Guidance:/);
});

test("synthesis mode reports mode in formatSummary", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  for (let i = 0; i < 15; i++) {
    await touch(`wiki/p${i}.md`, `Linked content [[other${i}]] [[third${i}]].`);
  }
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.mode, "synthesis");
  const text = formatSummary(summary);
  assert.match(text, /Mode: synthesis/);
});

test("empty mode reports mode in formatSummary even with a couple of files", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  await touch("a.md");
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  assert.equal(summary.mode, "empty");
  const text = formatSummary(summary);
  assert.match(text, /Mode: empty/);
});
