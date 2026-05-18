// Tests for propose_entity_stubs + entity rejection memory.
//
// Covers: stub frontmatter shape, dedup against existing vault pages,
// bucket override, mentions/snippets rendering, rejection memory append
// and dedup, scan_entity_candidates auto-excluding persisted rejections.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createProposals } from "../src/proposals.js";
import {
  createEntityStubs,
  readEntityRejections,
  recordEntityRejection,
  maybeReadEntityStubSlug,
  ENTITY_STUB_MARKER
} from "../src/entity-stubs.js";
import { scanEntityCandidates } from "../src/entity-scan.js";

let tmpRoot;
let vault;
let proposals;
let entityStubs;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-stubs-"));
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
  entityStubs = createEntityStubs(vault, proposals);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

async function readVault(rel) {
  return readFile(path.join(tmpRoot, rel), "utf8");
}

// --- Stub building ---

test("proposeEntityStubs stages one proposal per candidate slug", async () => {
  const result = await entityStubs.proposeEntityStubs(["holmes", "cardozo", "erie"]);
  assert.equal(result.total, 3);
  assert.equal(result.staged, 3);
  assert.equal(result.skipped, 0);
  for (const slug of ["holmes", "cardozo", "erie"]) {
    const body = await readVault(`proposed/wiki/entities/${slug}.md`);
    assert.match(body, /type: entity/);
    assert.match(body, new RegExp(`slug: ${slug}`));
    assert.match(body, new RegExp(`${ENTITY_STUB_MARKER}: true`));
  }
});

test("stub body includes mention snippets when candidate objects are passed", async () => {
  const result = await entityStubs.proposeEntityStubs([{
    slug: "krebs-cycle",
    phrase: "Krebs Cycle",
    mentionCount: 60,
    fileCount: 12,
    snippets: [
      { file: "Path/anatomy-1.md", snippet: "the Krebs Cycle generates ATP" },
      { file: "Path/biochem-2.md", snippet: "Krebs Cycle intermediates include" }
    ]
  }]);
  assert.equal(result.staged, 1);
  const body = await readVault("proposed/wiki/entities/krebs-cycle.md");
  assert.match(body, /title: Krebs Cycle/);
  assert.match(body, /mention_count_at_scan: 60/);
  assert.match(body, /file_count_at_scan: 12/);
  assert.match(body, /## Mentioned in/);
  assert.match(body, /\[\[anatomy-1\]\] — the Krebs Cycle generates ATP/);
  assert.match(body, /\[\[biochem-2\]\] — Krebs Cycle intermediates include/);
});

test("skips slugs whose destination already exists in the vault", async () => {
  await touch("wiki/entities/holmes.md", "# Holmes — existing page");
  const result = await entityStubs.proposeEntityStubs(["holmes", "new-one"]);
  assert.equal(result.staged, 1);
  assert.equal(result.skipped, 1);
  const skipped = result.results.find((r) => r.slug === "holmes");
  assert.equal(skipped.status, "exists");
  const staged = result.results.find((r) => r.slug === "new-one");
  assert.equal(staged.status, "staged");
});

test("bucket override stages under the chosen folder", async () => {
  const result = await entityStubs.proposeEntityStubs(["palsgraf", "macpherson"], { bucket: "cases" });
  assert.equal(result.bucket, "cases");
  for (const slug of ["palsgraf", "macpherson"]) {
    assert.match(result.results.find((r) => r.slug === slug).destinationPath, new RegExp(`^wiki/cases/${slug}\\.md$`));
  }
});

test("bucket rejects traversal", async () => {
  await assert.rejects(
    () => entityStubs.proposeEntityStubs(["a"], { bucket: "../escape" }),
    /bucket cannot contain/
  );
});

test("empty candidates array rejects with a clear error", async () => {
  await assert.rejects(
    () => entityStubs.proposeEntityStubs([]),
    /non-empty array/
  );
});

test("string candidate normalizes to slug and a title-cased phrase", async () => {
  await entityStubs.proposeEntityStubs(["bradley-bernard"]);
  const body = await readVault("proposed/wiki/entities/bradley-bernard.md");
  assert.match(body, /title: Bradley Bernard/);
  assert.match(body, /# Bradley Bernard/);
});

// --- Rejection memory ---

test("recordEntityRejection appends to .margins/entity-rejections.md", async () => {
  const r = await recordEntityRejection(vault, "step-one");
  assert.equal(r.recorded, true);
  assert.equal(r.slug, "step-one");
  const list = await readEntityRejections(vault);
  assert.deepEqual(list, ["step-one"]);
});

test("recordEntityRejection is idempotent — second call is a no-op", async () => {
  await recordEntityRejection(vault, "step-one");
  const second = await recordEntityRejection(vault, "step-one");
  assert.equal(second.recorded, false);
  assert.equal(second.reason, "already-rejected");
  const list = await readEntityRejections(vault);
  assert.deepEqual(list, ["step-one"]);
});

test("recordEntityRejection normalizes slugs (slugifies the input)", async () => {
  await recordEntityRejection(vault, "Step One!");
  const list = await readEntityRejections(vault);
  assert.deepEqual(list, ["step-one"]);
});

test("maybeReadEntityStubSlug returns slug for staged stubs, null for others", async () => {
  await entityStubs.proposeEntityStubs(["holmes"]);
  assert.equal(await maybeReadEntityStubSlug(vault, "wiki/entities/holmes.md"), "holmes");

  // Non-stub proposal
  await proposals.proposePage("wiki/career/note.md", "# Just a note\n");
  assert.equal(await maybeReadEntityStubSlug(vault, "wiki/career/note.md"), null);

  // Missing proposal
  assert.equal(await maybeReadEntityStubSlug(vault, "wiki/never/staged.md"), null);
});

// --- Closed loop: scan → stub → reject → re-scan excludes ---

test("closed loop: scan_entity_candidates auto-excludes rejected slugs on re-scan", async () => {
  // Seed a vault with enough mentions to surface a candidate.
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Mark Loh sent. Mark Loh signed. Mark Loh approved.");
  }
  // First scan surfaces mark-loh.
  const first = await scanEntityCandidates(vault, { minMentions: 5, minFileSpread: 3 });
  assert.ok(first.candidates.find((c) => c.slug === "mark-loh"));

  // User rejects it (simulated — write to the rejection file directly here;
  // server.js wires this to resolve_proposal in the integration test below).
  await recordEntityRejection(vault, "mark-loh");

  // Second scan with persistedRejections passed in excludes mark-loh.
  const persistedRejections = await readEntityRejections(vault);
  const second = await scanEntityCandidates(vault, {
    minMentions: 5,
    minFileSpread: 3,
    excludeUserRejections: persistedRejections
  });
  assert.equal(second.candidates.find((c) => c.slug === "mark-loh"), undefined,
    "rejected slug should not reappear in second scan");
});

test("readEntityRejections handles a missing file gracefully", async () => {
  const list = await readEntityRejections(vault);
  assert.deepEqual(list, []);
});

test("readEntityRejections deduplicates entries", async () => {
  await recordEntityRejection(vault, "a");
  await recordEntityRejection(vault, "b");
  // Hand-edit the file to add a duplicate (simulating a user mistake)
  const rejPath = path.join(tmpRoot, ".margins/entity-rejections.md");
  const body = await readFile(rejPath, "utf8");
  await writeFile(rejPath, body + "- a\n- c\n", "utf8");
  const list = await readEntityRejections(vault);
  assert.deepEqual(list.sort(), ["a", "b", "c"]);
});
