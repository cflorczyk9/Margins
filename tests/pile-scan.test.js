import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { scanRawForCompile, detectPrefixes } from "../src/pile-scan.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-scan-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body = "", mtimeSeconds) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
  if (mtimeSeconds !== undefined) await utimes(abs, mtimeSeconds, mtimeSeconds);
}

test("scanRawForCompile returns empty payload when raw/ is missing", async () => {
  const result = await scanRawForCompile(vault);
  assert.equal(result.totalRawFiles, 0);
  assert.deepEqual(result.priorityQueue, []);
  assert.deepEqual(result.duplicateGroups, []);
});

test("scanRawForCompile returns priority queue capped at topN", async () => {
  for (let i = 0; i < 12; i++) {
    await touch(`raw/note-${i}.md`, "x".repeat(500 + i * 100));
  }
  const result = await scanRawForCompile(vault, { topN: 5 });
  assert.equal(result.totalRawFiles, 12);
  assert.equal(result.priorityQueue.length, 5);
});

test("priorityQueue prefers larger and more-recent files", async () => {
  const base = Math.floor(Date.now() / 1000) - 86400 * 10;
  // Small + old
  await touch("raw/small-old.md", "x".repeat(200), base);
  // Large + recent
  await touch("raw/large-recent.md", "x".repeat(10_000), base + 86400 * 9);
  // Mid + mid
  await touch("raw/mid.md", "x".repeat(1000), base + 86400 * 4);

  const result = await scanRawForCompile(vault, { topN: 3 });
  assert.equal(result.priorityQueue[0].path, "raw/large-recent.md");
});

test("priorityQueue skips files duplicated by content hash; keeps oldest", async () => {
  const base = Math.floor(Date.now() / 1000) - 86400;
  const body = "This is the same content across multiple files. ".repeat(20);
  await touch("raw/dup-a.md", body, base);
  await touch("raw/dup-b.md", body, base + 100);
  await touch("raw/dup-c.md", body, base + 200);
  await touch("raw/unique.md", "Different content entirely. ".repeat(20), base + 300);

  const result = await scanRawForCompile(vault, { topN: 5 });
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.duplicateGroups[0].count, 3);
  const queuePaths = result.priorityQueue.map((q) => q.path);
  // unique always present
  assert.ok(queuePaths.includes("raw/unique.md"));
  // exactly one of dup-a/b/c, and it should be the oldest
  const dupsInQueue = queuePaths.filter((p) => /raw\/dup-[abc]\.md/.test(p));
  assert.equal(dupsInQueue.length, 1);
  assert.equal(dupsInQueue[0], "raw/dup-a.md");
});

test("priorityQueue skips files under MIN_CONTENT_BYTES", async () => {
  await touch("raw/tiny.md", "hi");
  await touch("raw/substantive.md", "Real content. ".repeat(20));
  const result = await scanRawForCompile(vault, { topN: 5 });
  assert.ok(result.likelyEmpty.includes("raw/tiny.md"));
  const queuePaths = result.priorityQueue.map((q) => q.path);
  assert.ok(!queuePaths.includes("raw/tiny.md"));
  assert.ok(queuePaths.includes("raw/substantive.md"));
});

test("priorityQueue skips files already compiled (source-<slug>.md exists in vault)", async () => {
  await touch("raw/already-done.md", "Done content. ".repeat(50));
  await touch("raw/pending.md", "Pending different content. ".repeat(50));
  await touch("wiki/sources/source-already-done.md", "compiled summary");
  const result = await scanRawForCompile(vault, { topN: 5 });
  const queuePaths = result.priorityQueue.map((q) => q.path);
  assert.ok(!queuePaths.includes("raw/already-done.md"));
  assert.ok(queuePaths.includes("raw/pending.md"));
  assert.equal(result.alreadyCompiledCount, 1);
});

test("priorityQueue scores files mentioning recurring entities higher", async () => {
  // 5 files all mention Sarah + Apex → recurring entities
  for (let i = 0; i < 5; i++) {
    await touch(`raw/file-${i}.md`, `Talking about Sarah and Apex today. ${" ".repeat(100)}`);
  }
  // 1 file that mentions a one-off name, same size as the others
  await touch("raw/file-loner.md", `Talking about Quintilius. ${" ".repeat(100)}`);

  const result = await scanRawForCompile(vault, { topN: 6 });
  const sarahFiles = result.priorityQueue.filter((q) => q.path.match(/file-[0-4]/));
  const loner = result.priorityQueue.find((q) => q.path === "raw/file-loner.md");
  assert.ok(loner);
  // The entity-recurring files should generally outrank the lone-entity file.
  const avgSarah = sarahFiles.reduce((s, q) => s + q.score, 0) / sarahFiles.length;
  assert.ok(avgSarah >= loner.score);
});

test("priorityQueue reason string describes size, age, and entities", async () => {
  await touch("raw/big-recent.md", "Sarah Apex notes. ".repeat(500));
  await touch("raw/other.md", "Sarah Apex more notes. ".repeat(500));
  const result = await scanRawForCompile(vault, { topN: 2 });
  const reasons = result.priorityQueue.map((q) => q.reason);
  for (const r of reasons) {
    assert.ok(/KB|b/.test(r), `reason has size: ${r}`);
  }
});

test("detectPrefixes finds common filename prefixes", () => {
  const names = [
    "meeting-monday.md", "meeting-tuesday.md", "meeting-wed.md",
    "journal-jan.md", "journal-feb.md", "journal-mar.md", "journal-apr.md",
    "random.md", "freeform.md"
  ];
  const prefixes = detectPrefixes(names);
  const map = Object.fromEntries(prefixes.map((p) => [p.prefix, p.count]));
  assert.equal(map.meeting, 3);
  assert.equal(map.journal, 4);
});

test("detectPrefixes ignores prefixes with fewer than 3 occurrences", () => {
  const names = ["meeting-a.md", "meeting-b.md", "journal-a.md", "random.md"];
  const prefixes = detectPrefixes(names);
  assert.equal(prefixes.length, 0);
});

test("detectPrefixes sorts by count descending", () => {
  const names = [];
  for (let i = 0; i < 5; i++) names.push(`small-${i}.md`);
  for (let i = 0; i < 10; i++) names.push(`big-${i}.md`);
  const prefixes = detectPrefixes(names);
  assert.equal(prefixes[0].prefix, "big");
  assert.equal(prefixes[1].prefix, "small");
});
