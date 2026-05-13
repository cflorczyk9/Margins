import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVault } from "../src/vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures");

test("listFiles returns markdown files only", async () => {
  const vault = createVault(FIXTURE);
  const files = await vault.listFiles();
  const rels = files.map((f) => vault.toRel(f)).sort();
  assert.deepEqual(rels, [
    "wiki/briefly.md",
    "wiki/career.md",
    "wiki/index.md"
  ]);
});

test("searchVault finds body and filename matches", async () => {
  const vault = createVault(FIXTURE);
  const bodyHits = await vault.searchVault("Affinity", 10);
  assert.equal(bodyHits.length, 1);
  assert.equal(bodyHits[0].path, "wiki/briefly.md");
  assert.match(bodyHits[0].snippet, /Affinity/i);

  const pathHits = await vault.searchVault("career", 10);
  assert.ok(pathHits.find((h) => h.path === "wiki/career.md"));
});

test("readPage returns body and rejects traversal", async () => {
  const vault = createVault(FIXTURE);
  const page = await vault.readPage("wiki/career.md");
  assert.match(page.body, /# Career/);
  assert.equal(page.path, "wiki/career.md");

  await assert.rejects(() => vault.readPage("../../etc/passwd"));
});

test("listRecent honors limit", async () => {
  const vault = createVault(FIXTURE);
  const recent = await vault.listRecent(2);
  assert.equal(recent.length, 2);
});

test("getBacklinks finds wikilinks", async () => {
  const vault = createVault(FIXTURE);
  const hits = await vault.getBacklinks("career", 10);
  const paths = hits.map((h) => h.path).sort();
  assert.deepEqual(paths, ["wiki/briefly.md", "wiki/index.md"]);
});
