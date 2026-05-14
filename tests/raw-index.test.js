import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { buildRawIndex } from "../src/raw-index.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-raw-index-"));
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

test("empty raw/ returns empty index", async () => {
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.rawFiles, []);
  assert.deepEqual(idx.pending, []);
});

test("raw files with matching raw_file: frontmatter are not pending", async () => {
  await touch("raw/a.md", "alpha");
  await touch("raw/b.md", "beta");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n# A\n`
  );
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.rawFiles.sort(), ["a.md", "b.md"]);
  assert.deepEqual(idx.pending, ["b.md"]);
  assert.equal(idx.referenced.get("a.md"), "wiki/sources/source-a.md");
});

test("raw_files: list frontmatter (multi-source hub) also counts", async () => {
  await touch("raw/x.pdf", "%PDF-1.4\n%EOF");
  await touch("raw/y.pdf", "%PDF-1.4\n%EOF");
  await touch(
    "wiki/career/hub.md",
    `---\ntype: synthesis\nraw_files:\n  - "raw/x.pdf"\n  - "raw/y.pdf"\n---\n# Hub\n`
  );
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.pending, []);
});

test("backtick body references are NOT enough — frontmatter is canonical", async () => {
  await touch("raw/c.md", "content");
  await touch(
    "wiki/sources/source-c.md",
    `---\ntype: source\n---\n# C\n\nOriginal file: \`raw/c.md\`\n`
  );
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.pending, ["c.md"]);
});

test("non-supported file types are skipped from rawFiles", async () => {
  await touch("raw/skip.png", "binary");
  await touch("raw/keep.md", "text");
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.rawFiles, ["keep.md"]);
});

test(".DS_Store and README.md are skipped", async () => {
  await touch("raw/.DS_Store", "");
  await touch("raw/README.md", "# Instructions");
  await touch("raw/real.md", "stuff");
  const idx = await buildRawIndex(vault);
  assert.deepEqual(idx.rawFiles, ["real.md"]);
});
