import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { hashFile, shortHash } from "../src/hash.js";

let tmpRoot;
beforeEach(async () => { tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-hash-")); });
afterEach(async () => { await rm(tmpRoot, { recursive: true, force: true }); });

test("hashFile returns sha256 hex of file contents", async () => {
  const p = path.join(tmpRoot, "a.txt");
  await writeFile(p, "hello world");
  const h = await hashFile(p);
  // sha256 of "hello world"
  assert.equal(h, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("hashFile detects content changes", async () => {
  const p = path.join(tmpRoot, "a.txt");
  await writeFile(p, "v1");
  const h1 = await hashFile(p);
  await writeFile(p, "v2");
  const h2 = await hashFile(p);
  assert.notEqual(h1, h2);
});

test("shortHash returns 8-char hex string deterministically", () => {
  const a = shortHash("raw/foo.md");
  const b = shortHash("raw/foo.md");
  const c = shortHash("raw/bar.md");
  assert.equal(a.length, 8);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}$/);
});
