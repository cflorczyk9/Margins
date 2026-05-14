import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { buildVaultIndex } from "../src/raw-index.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-vault-index-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

test("empty vault returns empty index", async () => {
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates, []);
  assert.deepEqual(idx.pending, []);
});

test("files in raw/ with matching raw_file: frontmatter are not pending", async () => {
  await touch("raw/a.md", "alpha");
  await touch("raw/b.md", "beta");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n# A\n`
  );
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates.sort(), ["raw/a.md", "raw/b.md"]);
  assert.deepEqual(idx.pending, ["raw/b.md"]);
  assert.equal(idx.referenced.get("raw/a.md"), "wiki/sources/source-a.md");
});

test("files at vault root are also candidates (not just raw/)", async () => {
  await touch("meeting-march-7.md", "notes");
  await touch("clippings/article.md", "stuff");
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates.sort(), ["clippings/article.md", "meeting-march-7.md"]);
  assert.equal(idx.pending.length, 2);
});

test("source page with raw_file pointing outside raw/ is honored", async () => {
  await touch("meetings/march-7.md", "notes");
  await touch(
    "wiki/sources/source-march-7.md",
    `---\ntype: source\nraw_file: meetings/march-7.md\n---\n# March 7\n`
  );
  const idx = await buildVaultIndex(vault);
  assert.equal(idx.referenced.get("meetings/march-7.md"), "wiki/sources/source-march-7.md");
  assert.deepEqual(idx.pending, []);
});

test("raw_files: list frontmatter (multi-source hub) also counts", async () => {
  await touch("raw/x.pdf", "%PDF-1.4\n%EOF");
  await touch("raw/y.pdf", "%PDF-1.4\n%EOF");
  await touch(
    "wiki/career/hub.md",
    `---\ntype: synthesis\nraw_files:\n  - "raw/x.pdf"\n  - "raw/y.pdf"\n---\n# Hub\n`
  );
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.pending, []);
});

test("backtick body references are NOT enough — frontmatter is canonical", async () => {
  await touch("raw/c.md", "content");
  await touch(
    "wiki/sources/source-c.md",
    `---\ntype: source\n---\n# C\n\nOriginal file: \`raw/c.md\`\n`
  );
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.pending, ["raw/c.md"]);
});

test("non-supported file types are skipped from candidates", async () => {
  await touch("raw/skip.png", "binary");
  await touch("raw/keep.md", "text");
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates, ["raw/keep.md"]);
});

test("meta pages (tracker, log, stats, index) are skipped", async () => {
  await touch("wiki/ingest-tracker.md", "tracker");
  await touch("wiki/log.md", "log");
  await touch("wiki/wiki-stats.md", "stats");
  await touch("wiki/index.md", "index");
  await touch("notes.md", "user notes");
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates, ["notes.md"]);
});

test("wiki pages with type: frontmatter are NOT candidates", async () => {
  await touch(
    "wiki/entities/connor.md",
    `---\ntype: entity\n---\n# Connor\n`
  );
  await touch(
    "wiki/concepts/briefly.md",
    `---\ntype: concept\n---\n# Briefly\n`
  );
  await touch("a-real-source.md", "uncompiled note");
  const idx = await buildVaultIndex(vault);
  assert.deepEqual(idx.candidates, ["a-real-source.md"]);
});
