import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { diagnoseVault } from "../src/doctor.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-doctor-"));
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

test("clean vault reports no issues", async () => {
  await touch("raw/a.md", "alpha");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n# A\n`
  );
  await touch(
    "wiki/ingest-tracker.md",
    `---\ntype: tracker\n---\n\n# Ingest Tracker\n\n| raw/a.md | ingested | [[source-a]] | - |  |  |\n`
  );
  const report = await diagnoseVault(vault);
  assert.equal(report.summary.issues_found, 0);
});

test("orphan-source: source page references a missing raw file", async () => {
  await touch(
    "wiki/sources/source-ghost.md",
    `---\ntype: source\nraw_file: raw/ghost.md\n---\n# Ghost\n`
  );
  const report = await diagnoseVault(vault);
  const orphans = report.issues.filter((i) => i.kind === "orphan-source");
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].rawFile, "raw/ghost.md");
  assert.equal(orphans[0].sourcePage, "wiki/sources/source-ghost.md");
});

test("tracker-missing-row: source exists but tracker has no row for it", async () => {
  await touch("raw/a.md", "alpha");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n# A\n`
  );
  await touch(
    "wiki/ingest-tracker.md",
    `---\ntype: tracker\n---\n\n# Ingest Tracker\n\n| raw/other.md | ingested | [[source-other]] | - |  |  |\n`
  );
  const report = await diagnoseVault(vault);
  const missing = report.issues.filter((i) => i.kind === "tracker-missing-row");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].rawFile, "raw/a.md");
});

test("tracker-orphan-row: tracker points to a slug with no source page", async () => {
  await touch("raw/a.md", "alpha");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n`
  );
  await touch(
    "wiki/ingest-tracker.md",
    `---\ntype: tracker\n---\n\n# Ingest Tracker\n\n| raw/a.md | ingested | [[source-a]] | - |  |  |\n| raw/deleted.md | ingested | [[source-deleted]] | - |  |  |\n`
  );
  const report = await diagnoseVault(vault);
  const orphan = report.issues.filter((i) => i.kind === "tracker-orphan-row");
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].slug, "source-deleted");
});

test("summary reports ingest roots and counts", async () => {
  await touch("raw/a.md", "alpha");
  await touch("raw/b.md", "beta");
  await touch(
    "wiki/sources/source-a.md",
    `---\ntype: source\nraw_file: raw/a.md\n---\n`
  );
  const report = await diagnoseVault(vault);
  assert.equal(report.summary.candidates, 2);
  assert.equal(report.summary.filed, 1);
  assert.equal(report.summary.pending, 1);
  assert.deepEqual(report.summary.ingest_roots, ["raw"]);
});

test("stale-source: source page records a sha that no longer matches raw", async () => {
  await touch("raw/changes.md", "Original content, with enough body to clear the threshold.");
  await touch(
    "wiki/sources/source-changes.md",
    `---\ntype: source\nraw_file: raw/changes.md\nraw_sha256: 0000000000000000000000000000000000000000000000000000000000000000\nraw_size: 999999\n---\n# Changes\n`
  );
  const report = await diagnoseVault(vault);
  const stale = report.issues.filter((i) => i.kind === "stale-source");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].rawFile, "raw/changes.md");
  assert.equal(stale[0].reason, "size-mismatch");
});

test("clean vault with matching raw_sha256 reports no staleness", async () => {
  // Compile via the real flow to get accurate sha
  const fileBody = "Body that will be hashed and recorded so the doctor sees no drift.";
  await touch("raw/synced.md", fileBody);
  await touch(
    "wiki/sources/source-synced.md",
    [
      "---",
      "type: source",
      "raw_file: raw/synced.md",
      `raw_size: ${Buffer.byteLength(fileBody, "utf8")}`,
      "---",
      "# Synced"
    ].join("\n")
  );
  const report = await diagnoseVault(vault);
  const stale = report.issues.filter((i) => i.kind === "stale-source");
  assert.equal(stale.length, 0);
});
