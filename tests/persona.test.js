import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { classifyVault, suggestionsForPersona } from "../src/persona.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-persona-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body = "") {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

async function obsidian() {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
}

test("empty vault with .obsidian/ classified as A2", async () => {
  await obsidian();
  const p = await classifyVault(vault);
  assert.equal(p.code, "A2");
  assert.equal(p.hasObsidian, true);
  assert.equal(p.fileCount, 0);
});

test("empty vault without .obsidian/ classified as B2", async () => {
  const p = await classifyVault(vault);
  assert.equal(p.code, "B2");
  assert.equal(p.hasObsidian, false);
});

test("Obsidian vault with high wikilink density classified as A1", async () => {
  await obsidian();
  for (let i = 0; i < 10; i++) {
    await touch(`wiki/page${i}.md`, `Some content with [[other-page${i}]] and [[third-page${i}]].`);
  }
  const p = await classifyVault(vault);
  assert.equal(p.code, "A1");
  assert.ok(p.wikilinkDensity >= 0.3);
});

test("Obsidian vault with many files but no wikilinks classified as A3", async () => {
  await obsidian();
  for (let i = 0; i < 20; i++) {
    await touch(`page${i}.md`, `Some content with no links at all. Plain markdown.`);
  }
  const p = await classifyVault(vault);
  assert.equal(p.code, "A3");
  assert.equal(p.wikilinkDensity, 0);
});

test("no-Obsidian vault with high wikilink density classified as B1", async () => {
  for (let i = 0; i < 10; i++) {
    await touch(`note${i}.md`, `Body with [[link${i}]] and [[other${i}]] wikilinks.`);
  }
  const p = await classifyVault(vault);
  assert.equal(p.code, "B1");
});

test("no-Obsidian vault with files but no links classified as B3", async () => {
  for (let i = 0; i < 20; i++) {
    await touch(`note${i}.md`, "Plain content. No links.");
  }
  const p = await classifyVault(vault);
  assert.equal(p.code, "B3");
});

test("suggestionsForPersona returns persona-specific text", () => {
  const a3 = suggestionsForPersona(
    { code: "A3", hasObsidian: true, fileCount: 800, wikilinkDensity: 0.05 },
    [{ folder: "wiki", count: 800 }]
  );
  assert.ok(a3.some((s) => s.includes("propose_wikilinks") || s.includes("wikilinks")));

  const a2 = suggestionsForPersona(
    { code: "A2", hasObsidian: true, fileCount: 1, wikilinkDensity: 0 },
    []
  );
  assert.ok(a2.some((s) => /daily.*note/i.test(s)));

  const a1 = suggestionsForPersona(
    { code: "A1", hasObsidian: true, fileCount: 500, wikilinkDensity: 3 },
    [{ folder: "wiki/career", count: 100 }, { folder: "wiki/projects", count: 80 }]
  );
  assert.ok(a1.some((s) => s.includes("search_vault")));
});
