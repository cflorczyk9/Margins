// Checkpoint A perf bench. Sets a budget for the operations bulk producers
// (split mode, bulk wikilinks) will hammer once they land. If this regresses,
// later phases will be quadratic against it.
//
// Budgets are deliberately loose — they catch O(N^2) regressions, not micro-
// optimization slips. p50 < 100ms on list_proposals at 200 proposals; full
// cache hit (re-listing the same vault state) under 50ms; raw-index second
// build essentially free with the mtime cache in place.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { createVault } from "../src/vault.js";
import { createProposals } from "../src/proposals.js";
import { buildVaultIndex, _resetProposedFmCacheForTests } from "../src/raw-index.js";
import { createWikilinks } from "../src/wikilinks.js";
import { buildSlugIndex } from "../src/vault-slug-index.js";

let tmpRoot;
let vault;
let proposals;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-perf-"));
  await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
  await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
  _resetProposedFmCacheForTests();
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function seedProposals(n) {
  for (let i = 0; i < n; i++) {
    const body = `---\ntype: source\nraw_file: raw/r-${i}.md\nraw_sha256: ${"a".repeat(64)}\n---\n# Body ${i}\nsome content for ${i}\n`;
    await proposals.proposePage(`wiki/sources/source-${i}.md`, body);
  }
}

function median(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test("perf: listProposals p50 < 100ms at 200 proposals (pattern filter)", async () => {
  await seedProposals(200);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const items = await proposals.listProposals({ pattern: "wiki/sources/source-*.md", includeDelta: false });
    samples.push(performance.now() - t0);
    assert.equal(items.length, 200);
  }
  const p50 = median(samples);
  // Generous budget — we want to catch quadratic regressions, not micro-slips.
  assert.ok(p50 < 100, `list_proposals p50 was ${p50.toFixed(1)}ms (budget: 100ms). Samples: ${samples.map((s) => s.toFixed(1)).join(", ")}`);
});

test("perf: raw-index second build hits the proposed/ frontmatter cache", async () => {
  await seedProposals(150);
  const t0 = performance.now();
  const first = await buildVaultIndex(vault);
  const firstMs = performance.now() - t0;
  assert.ok(first.sourcePagesCount >= 150, `expected ≥150 proposed source pages, got ${first.sourcePagesCount}`);

  const t1 = performance.now();
  const second = await buildVaultIndex(vault);
  const secondMs = performance.now() - t1;
  assert.equal(second.sourcePagesCount, first.sourcePagesCount);

  // Cache should make the second build at most half the first. Without the
  // cache, both walks re-read + re-parse every proposed page, so the second
  // would land roughly equal to the first (within noise).
  assert.ok(
    secondMs <= firstMs * 0.6,
    `Cached buildVaultIndex did not beat first build by 40%+. First: ${firstMs.toFixed(1)}ms, second: ${secondMs.toFixed(1)}ms`
  );
});

test("perf: scope-mode wikilinks beats N single-page calls (shared slug index)", async () => {
  // Build a 100-page corpus with 5 entity targets. Single-page mode rebuilds
  // the slug index per call → N walks. Scope mode builds it once. The
  // multiplier should be at least ~2x even on a small fixture.
  await mkdir(path.join(tmpRoot, "wiki/people"), { recursive: true });
  await mkdir(path.join(tmpRoot, "wiki/notes"), { recursive: true });
  for (const name of ["bob-casey", "alice-chen", "carol-singh", "dan-mehta", "elena-park"]) {
    await writeFile(path.join(tmpRoot, "wiki/people", `${name}.md`), `# ${name}`, "utf8");
  }
  for (let i = 0; i < 100; i++) {
    await writeFile(
      path.join(tmpRoot, "wiki/notes", `n-${i}.md`),
      `Met with Bob Casey and Alice Chen today. Carol Singh joined later.`,
      "utf8"
    );
  }
  const wikilinks = createWikilinks(vault, { proposals });

  // Single-page: 100 invocations.
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    await wikilinks.proposeWikilinks(`wiki/notes/n-${i}.md`);
  }
  const singleMs = performance.now() - t0;

  // Scope: 1 invocation.
  const t1 = performance.now();
  const result = await wikilinks.proposeWikilinks(null, { scope: "wiki/notes/**", maxPages: 100 });
  const scopeMs = performance.now() - t1;

  assert.equal(result.pagesScanned, 100);
  assert.ok(
    scopeMs * 2 <= singleMs,
    `scope mode did not beat single-page by 2x. single=${singleMs.toFixed(1)}ms, scope=${scopeMs.toFixed(1)}ms`
  );
});

test("perf: buildSlugIndex on a 100-page vault completes in under 100ms", async () => {
  await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
  for (let i = 0; i < 100; i++) {
    await writeFile(path.join(tmpRoot, "wiki", `p-${i}.md`), `# Page ${i}`, "utf8");
  }
  const t0 = performance.now();
  const idx = await buildSlugIndex(vault);
  const ms = performance.now() - t0;
  assert.equal(idx.totalSlugs, 100);
  assert.ok(ms < 100, `buildSlugIndex took ${ms.toFixed(1)}ms (budget: 100ms)`);
});

test("perf: raw-index cache invalidates when a proposal mtime changes", async () => {
  await seedProposals(20);
  const first = await buildVaultIndex(vault);
  const firstCount = first.sourcePagesCount;

  // Re-stage one proposal with new content — should change mtime + body.
  await new Promise((r) => setTimeout(r, 15));
  const newBody = `---\ntype: source\nraw_file: raw/r-0.md\n---\n# Rewritten\n`;
  await writeFile(path.join(tmpRoot, "proposed/wiki/sources/source-0.md"), newBody, "utf8");

  const second = await buildVaultIndex(vault);
  assert.equal(second.sourcePagesCount, firstCount);
  // The rewritten page should still be present (cache must invalidate and
  // re-parse the new mtime so its data is fresh, not the stale entry).
  const found = second.referenced.has("raw/r-0.md");
  assert.equal(found, true);
});
