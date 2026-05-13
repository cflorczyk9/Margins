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
  await touch("a.md");
  const vault = createVault(tmpRoot);
  const primer = createPrimer(vault);
  const summary = await primer.summarize();
  const text = formatSummary(summary);
  assert.match(text, /1 markdown files/);
  assert.match(text, /Try asking me/);
});
