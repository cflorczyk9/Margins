import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { samplePileBySnippets, detectFilenamePatterns } from "../src/pile-sampler.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-pile-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body = "", mtimeSeconds) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
  if (mtimeSeconds !== undefined) {
    await utimes(abs, mtimeSeconds, mtimeSeconds);
  }
}

test("samplePileBySnippets returns empty for empty vault", async () => {
  const result = await samplePileBySnippets(vault);
  assert.equal(result.totalFiles, 0);
  assert.deepEqual(result.sample, []);
  assert.equal(result.earliestMtime, null);
});

test("samplePileBySnippets caps at requested count", async () => {
  for (let i = 0; i < 50; i++) await touch(`note${i}.md`, `body ${i}`);
  const result = await samplePileBySnippets(vault, { count: 12 });
  assert.equal(result.totalFiles, 50);
  assert.equal(result.sample.length, 12);
});

test("samplePileBySnippets stratifies across time", async () => {
  // Spread mtimes across 100 days; expect sample to cover both ends.
  const base = 1_700_000_000;
  for (let i = 0; i < 30; i++) {
    await touch(`note${i}.md`, `body ${i}`, base + i * 86_400);
  }
  const result = await samplePileBySnippets(vault, { count: 6 });
  const sorted = [...result.sample].sort((a, b) => a.mtimeMs - b.mtimeMs);
  // First sampled file should be near the earliest mtime, last near the latest.
  assert.equal(sorted[0].mtimeMs / 1000, base);
  assert.ok(sorted[sorted.length - 1].mtimeMs / 1000 >= base + 25 * 86_400);
});

test("samplePileBySnippets strips YAML frontmatter from snippet", async () => {
  const body = `---\ntitle: Hello\ndate: 2026-01-01\n---\n\nReal content starts here.`;
  await touch("a.md", body);
  const result = await samplePileBySnippets(vault, { count: 5 });
  assert.equal(result.sample.length, 1);
  assert.ok(result.sample[0].snippet.startsWith("Real content"), result.sample[0].snippet);
});

test("samplePileBySnippets respects snippetChars", async () => {
  await touch("a.md", "x".repeat(1000));
  const result = await samplePileBySnippets(vault, { count: 1, snippetChars: 50 });
  assert.equal(result.sample[0].snippet.length, 50);
});

test("detectFilenamePatterns groups dated daily notes", async () => {
  const paths = [
    "2026-01-01.md", "2026-01-02.md", "2026-01-03.md",
    "Untitled.md", "career-notes.md"
  ];
  const buckets = detectFilenamePatterns(paths);
  const daily = buckets.find((b) => b.pattern === "dated daily (YYYY-MM-DD)");
  assert.ok(daily);
  assert.equal(daily.count, 3);
});

test("detectFilenamePatterns groups unnamed dumps", async () => {
  const paths = [
    "Untitled.md", "Untitled 2.md", "Document (3).md", "Note 7.md", "New Note.md",
    "real-notes.md"
  ];
  const buckets = detectFilenamePatterns(paths);
  const dump = buckets.find((b) => b.pattern === "unnamed dump");
  assert.ok(dump);
  assert.equal(dump.count, 5);
});

test("detectFilenamePatterns falls back to free-form for unmatched names", async () => {
  const paths = ["thinking-about-careers.md", "centric-pilot.md", "ihor-frozen.md"];
  const buckets = detectFilenamePatterns(paths);
  const free = buckets.find((b) => b.pattern === "free-form named");
  assert.ok(free);
  assert.equal(free.count, 3);
});

test("detectFilenamePatterns examples capped at 3 per pattern", async () => {
  const paths = [];
  for (let i = 1; i <= 10; i++) paths.push(`2026-01-${String(i).padStart(2, "0")}.md`);
  const buckets = detectFilenamePatterns(paths);
  const daily = buckets[0];
  assert.equal(daily.examples.length, 3);
});

test("detectFilenamePatterns returns buckets sorted desc by count", async () => {
  const paths = [];
  for (let i = 0; i < 8; i++) paths.push(`free-form-${i}.md`);
  for (let i = 0; i < 15; i++) paths.push(`2026-01-${String(i + 1).padStart(2, "0")}.md`);
  const buckets = detectFilenamePatterns(paths);
  assert.equal(buckets[0].pattern, "dated daily (YYYY-MM-DD)");
  assert.equal(buckets[0].count, 15);
});
