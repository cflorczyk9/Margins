import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { detectIndexRoots, DEFAULT_SKIP_DIRS } from "../src/index-roots.js";

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-roots-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body = "") {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

test("detects Obsidian vault when .obsidian/ exists", async () => {
  await mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
  const result = await detectIndexRoots(tmpRoot);
  assert.equal(result.source, "obsidian");
  assert.deepEqual(result.roots, ["."]);
});

test("detects Margins vault when wiki/ exists", async () => {
  await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
  const result = await detectIndexRoots(tmpRoot);
  assert.equal(result.source, "margins");
  assert.deepEqual(result.roots, ["wiki"]);
});

test("falls back to root when neither .obsidian/ nor wiki/ exist", async () => {
  const result = await detectIndexRoots(tmpRoot);
  assert.equal(result.source, "default");
  assert.deepEqual(result.roots, ["."]);
});

test("env var overrides auto-detection", async () => {
  await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
  const result = await detectIndexRoots(tmpRoot, "notes,research");
  assert.equal(result.source, "env");
  assert.deepEqual(result.roots, ["notes", "research"]);
});

test("env var strips leading ./ and trailing /", async () => {
  const result = await detectIndexRoots(tmpRoot, "./wiki/,raw/");
  assert.deepEqual(result.roots, ["wiki", "raw"]);
});

test("vault respects indexRoots — only indexed paths show up", async () => {
  await touch("wiki/a.md", "alpha");
  await touch("raw/b.md", "beta");
  await touch("notes/c.md", "gamma");
  const vault = createVault(tmpRoot, { indexRoots: ["wiki"] });
  const files = await vault.listFiles();
  const rels = files.map((f) => vault.toRel(f)).sort();
  assert.deepEqual(rels, ["wiki/a.md"]);
});

test("vault skips directories in skipDirs", async () => {
  await touch("wiki/a.md", "alpha");
  await touch("wiki/.obsidian/config.md", "should-skip");
  await touch("wiki/node_modules/junk.md", "should-skip");
  const vault = createVault(tmpRoot, {
    indexRoots: ["wiki"],
    skipDirs: DEFAULT_SKIP_DIRS
  });
  const files = await vault.listFiles();
  const rels = files.map((f) => vault.toRel(f)).sort();
  assert.deepEqual(rels, ["wiki/a.md"]);
});

test("multiple index roots are merged", async () => {
  await touch("wiki/a.md", "");
  await touch("raw/b.md", "");
  await touch("ignored/c.md", "");
  const vault = createVault(tmpRoot, { indexRoots: ["wiki", "raw"] });
  const rels = (await vault.listFiles())
    .map((f) => vault.toRel(f))
    .sort();
  assert.deepEqual(rels, ["raw/b.md", "wiki/a.md"]);
});
