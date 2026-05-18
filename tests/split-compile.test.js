// Split-mode compile tests. Covers segmenter, runSplitCompile staging,
// idempotency (already-split + force), hub frontmatter shape, segment
// hub linkage, raw-index treating segments as filed, and the no-headings
// / single-segment guards.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createProposals } from "../src/proposals.js";
import { createCompile } from "../src/compile.js";
import { buildVaultIndex, _resetProposedFmCacheForTests } from "../src/raw-index.js";
import { splitTextByHeading } from "../src/document-text.js";

let tmpRoot;
let vault;
let proposals;
let compile;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-split-"));
  await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
  compile = createCompile(vault, proposals);
  _resetProposedFmCacheForTests();
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeRaw(name, body) {
  await writeFile(path.join(tmpRoot, "raw", name), body, "utf8");
}

async function readProposal(rel) {
  return readFile(path.join(tmpRoot, "proposed", rel), "utf8");
}

// --- splitTextByHeading unit tests ---

test("splitTextByHeading('h1') returns one segment per H1", () => {
  const text = `Intro before any heading.\n\n# Alpha\n\nFirst section body.\n\n# Beta\n\nSecond section body.\n`;
  const segments = splitTextByHeading(text, "h1");
  assert.equal(segments.length, 2);
  assert.equal(segments[0].heading, "Alpha");
  assert.match(segments[0].body, /First section body/);
  assert.equal(segments[1].heading, "Beta");
  assert.match(segments[1].body, /Second section body/);
});

test("splitTextByHeading('h2') does not split on deeper H3 or shallower H1", () => {
  const text = `# Doc Title\n\n## Section A\n\nbody-a\n\n### Subsection\n\nsub-text\n\n## Section B\n\nbody-b\n`;
  const segments = splitTextByHeading(text, "h2");
  assert.equal(segments.length, 2);
  assert.equal(segments[0].heading, "Section A");
  assert.match(segments[0].body, /body-a/);
  assert.match(segments[0].body, /sub-text/);
  assert.equal(segments[1].heading, "Section B");
});

test("splitTextByHeading returns empty when no headings at the requested level", () => {
  const text = `Just some prose with no headings at all.`;
  assert.deepEqual(splitTextByHeading(text, "h1"), []);
});

// --- runSplitCompile end-to-end ---

test("split mode stages N segment proposals + 1 hub from a Markdown raw", async () => {
  await writeRaw("big-deals.md", [
    "# Project Aurora",
    "Notes about Aurora deal.",
    "Partner: Goldman.",
    "",
    "# Project Borealis",
    "Notes about Borealis.",
    "Partner: KKR.",
    "",
    "# Project Cascade",
    "Notes about Cascade.",
    "Partner: Brookfield."
  ].join("\n"));

  const result = await compile.proposeCompileFromRaw("raw/big-deals.md", {
    split: "heading-h1"
  });

  assert.equal(result.status, "split-staged");
  assert.equal(result.segmentsCount, 3);
  assert.equal(result.overflow, false);
  assert.equal(result.bucket, "sources");
  assert.match(result.hubPath, /^wiki\/sources\/big-deals-hub\.md$/);
  assert.equal(result.segments.length, 3);

  // Each segment got its own proposal at a unique path.
  const seg0Body = await readProposal(result.segments[0].destinationPath);
  assert.match(seg0Body, /type: source_segment/);
  assert.match(seg0Body, /raw_file: raw\/big-deals\.md/);
  assert.match(seg0Body, /segment_index: 0/);
  assert.match(seg0Body, /segments_count: 3/);
  assert.match(seg0Body, /hub: "\[\[big-deals-hub\]\]"/);
  assert.match(seg0Body, /# Project Aurora/);
  assert.match(seg0Body, /Goldman/);

  const hubBody = await readProposal(result.hubPath);
  assert.match(hubBody, /type: source/);
  assert.match(hubBody, /is_hub: true/);
  assert.match(hubBody, /segments_count: 3/);
  assert.match(hubBody, /\[\[big-deals-s01-project-aurora\]\]/);
  assert.match(hubBody, /\[\[big-deals-s02-project-borealis\]\]/);
  assert.match(hubBody, /\[\[big-deals-s03-project-cascade\]\]/);
});

test("split mode rejects a doc with no headings at requested level", async () => {
  await writeRaw("flat.md", "No headings anywhere, just prose. ".repeat(20));
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/flat.md", { split: "heading-h1" }),
    /no headings at level/
  );
});

test("split mode rejects a doc with only one segment", async () => {
  await writeRaw("solo.md", "# Solo\n\nOnly one section here with some body content.");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/solo.md", { split: "heading-h1" }),
    /only one segment/
  );
});

test("split mode caps at maxSegments and flags overflow", async () => {
  const sections = [];
  for (let i = 0; i < 8; i++) {
    sections.push(`# Section ${i}\n\nLonger body content for section ${i} so it clears the min-segment-char floor.`);
  }
  await writeRaw("many.md", sections.join("\n\n"));

  const result = await compile.proposeCompileFromRaw("raw/many.md", {
    split: "heading-h1",
    maxSegments: 3
  });
  assert.equal(result.segmentsCount, 3);
  assert.equal(result.totalHeadingsFound, 8);
  assert.equal(result.overflow, true);
  assert.equal(result.overflowDropped, 5);
  const hubBody = await readProposal(result.hubPath);
  assert.match(hubBody, /5 additional headings dropped/);
});

test("split mode is idempotent — second call returns already-split", async () => {
  await writeRaw("ideas.md", "# A\n\nThis is segment A with enough body to clear the floor.\n\n# B\n\nThis is segment B with enough body to clear the floor.\n");
  const first = await compile.proposeCompileFromRaw("raw/ideas.md", { split: "heading-h1" });
  assert.equal(first.status, "split-staged");

  const second = await compile.proposeCompileFromRaw("raw/ideas.md", { split: "heading-h1" });
  assert.equal(second.status, "already-split");
  assert.match(second.hubPath, /ideas-hub\.md$/);
  assert.equal(second.hubLocation, "proposed");
});

test("split mode with force=true clears prior segment proposals and re-stages", async () => {
  await writeRaw("rev.md", "# A\n\nThis is segment A with enough body to clear the floor.\n\n# B\n\nThis is segment B with enough body to clear the floor.\n");
  await compile.proposeCompileFromRaw("raw/rev.md", { split: "heading-h1" });
  const beforeForce = await proposals.listProposals();
  assert.equal(beforeForce.length, 3); // 2 segments + 1 hub

  // Now mutate the raw file and re-split with force.
  await writeFile(path.join(tmpRoot, "raw/rev.md"),
    "# X\n\nRewritten section X with sufficient body.\n\n# Y\n\nRewritten section Y with sufficient body.\n\n# Z\n\nRewritten section Z with sufficient body.\n",
    "utf8");
  const result = await compile.proposeCompileFromRaw("raw/rev.md", {
    split: "heading-h1",
    force: true
  });
  assert.equal(result.status, "split-staged");
  assert.equal(result.segmentsCount, 3);

  const afterForce = await proposals.listProposals();
  // 3 new segments + 1 new hub = 4. Old A/B segments should have been rejected.
  const slugs = afterForce.map((p) => p.destinationPath.split("/").pop());
  assert.ok(slugs.some((s) => /rev-s01-x\.md$/.test(s)));
  assert.ok(slugs.some((s) => /rev-s02-y\.md$/.test(s)));
  assert.ok(slugs.some((s) => /rev-s03-z\.md$/.test(s)));
  assert.equal(slugs.filter((s) => /rev-s\d+-a\.md$/.test(s)).length, 0);
  assert.equal(slugs.filter((s) => /rev-s\d+-b\.md$/.test(s)).length, 0);
});

test("split mode honors hubBucket override", async () => {
  await writeRaw("biz.md", "# Q1\n\nQ1 details with sufficient body to clear the floor.\n\n# Q2\n\nQ2 details with sufficient body to clear the floor.\n");
  const result = await compile.proposeCompileFromRaw("raw/biz.md", {
    split: "heading-h1",
    hubBucket: "projects"
  });
  assert.match(result.hubPath, /^wiki\/projects\/biz-hub\.md$/);
  for (const seg of result.segments) {
    assert.match(seg.destinationPath, /^wiki\/projects\/source-biz-s\d+/);
  }
});

test("raw-index treats source_segment as referenced (raw file not listed as pending after split)", async () => {
  await writeRaw("filed.md", "# One\n\nFirst segment body with enough content to clear the floor.\n\n# Two\n\nSecond segment body with enough content to clear the floor.\n");
  await compile.proposeCompileFromRaw("raw/filed.md", { split: "heading-h1" });

  // Build the index — proposed/ segments count as referenced via raw-index's
  // type filter; raw/filed.md should NOT be in pending.
  const index = await buildVaultIndex(vault);
  assert.equal(index.pending.includes("raw/filed.md"), false,
    `expected raw/filed.md to be filed via segment proposals, pending: ${index.pending.join(", ")}`);
});

test("single-source compile still errors clearly when summary is missing", async () => {
  await writeRaw("flat.md", "Just prose without any summary supplied.");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/flat.md", {}),
    /summary/
  );
});
