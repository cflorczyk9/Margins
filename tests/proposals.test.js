import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createVault } from "../src/vault.js";
import { createProposals } from "../src/proposals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures");

let tmpRoot;
let vault;
let proposals;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-proposals-"));
  await cp(FIXTURE, tmpRoot, { recursive: true });
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function exists(rel) {
  try {
    await stat(path.join(tmpRoot, rel));
    return true;
  } catch {
    return false;
  }
}

async function read(rel) {
  return readFile(path.join(tmpRoot, rel), "utf8");
}

test("propose_page stages a new file to proposed/<path>", async () => {
  const result = await proposals.proposePage("wiki/projects/foo.md", "# Foo\n");
  assert.equal(result.destinationPath, "wiki/projects/foo.md");
  assert.equal(result.proposalPath, "proposed/wiki/projects/foo.md");
  assert.equal(result.replacedExisting, false);
  assert.ok(await exists("proposed/wiki/projects/foo.md"));
  assert.equal(await read("proposed/wiki/projects/foo.md"), "# Foo\n");
  assert.equal(await exists("wiki/projects/foo.md"), false);
});

test("propose_page errors when destination already exists in vault", async () => {
  await assert.rejects(
    () => proposals.proposePage("wiki/career.md", "# clash"),
    /already exists in vault/
  );
});

test("propose_page replaces a prior proposal silently", async () => {
  await proposals.proposePage("wiki/new.md", "v1");
  const second = await proposals.proposePage("wiki/new.md", "v2");
  assert.equal(second.replacedExisting, true);
  assert.equal(await read("proposed/wiki/new.md"), "v2");
});

test("propose_edit reads from vault and writes to proposed/", async () => {
  const before = await read("wiki/career.md");
  const result = await proposals.proposeEdit(
    "wiki/career.md",
    "Notes on Connor's career fork.",
    "Notes on the career fork (edited)."
  );
  assert.equal(result.readFrom, "vault");
  const proposed = await read("proposed/wiki/career.md");
  assert.match(proposed, /career fork \(edited\)/);
  // vault unchanged
  assert.equal(await read("wiki/career.md"), before);
});

test("propose_edit errors when 'before' is missing", async () => {
  await assert.rejects(
    () => proposals.proposeEdit("wiki/career.md", "nonexistent string", "x"),
    /not found/
  );
});

test("propose_edit errors when 'before' is ambiguous", async () => {
  await proposals.proposePage("wiki/dup.md", "foo\nfoo\nfoo\n");
  await assert.rejects(
    () => proposals.proposeEdit("wiki/dup.md", "foo", "bar"),
    /appears 3 times/
  );
});

test("propose_edit stacks on top of pending proposal", async () => {
  await proposals.proposePage("wiki/stack.md", "alpha\nbeta\ngamma\n");
  const second = await proposals.proposeEdit("wiki/stack.md", "beta", "BETA");
  assert.equal(second.readFrom, "proposal");
  assert.equal(await read("proposed/wiki/stack.md"), "alpha\nBETA\ngamma\n");
});

test("append_to creates a new file if path is missing", async () => {
  await proposals.appendTo("wiki/log.md", "first entry");
  assert.equal(await read("proposed/wiki/log.md"), "first entry");
});

test("append_to appends to existing vault content with newline separator", async () => {
  await proposals.appendTo("wiki/career.md", "extra line");
  const result = await read("proposed/wiki/career.md");
  assert.match(result, /career fork.*\nextra line$/s);
});

test("list_proposals returns pending proposals with overwrite hint", async () => {
  await proposals.proposePage("wiki/new1.md", "n1");
  await proposals.appendTo("wiki/career.md", "more"); // overwrites existing
  const items = await proposals.listProposals();
  const byPath = Object.fromEntries(items.map((i) => [i.destinationPath, i]));
  assert.equal(byPath["wiki/new1.md"].willOverwrite, false);
  assert.equal(byPath["wiki/career.md"].willOverwrite, true);
});

test("resolve_proposal accept moves file from proposed/ to destination", async () => {
  await proposals.proposePage("wiki/accepted.md", "body");
  const result = await proposals.resolveProposal("wiki/accepted.md", "accept");
  assert.equal(result.action, "accepted");
  assert.equal(await exists("proposed/wiki/accepted.md"), false);
  assert.equal(await read("wiki/accepted.md"), "body");
});

test("resolve_proposal accept overwrites existing vault file", async () => {
  await proposals.appendTo("wiki/career.md", "appended");
  await proposals.resolveProposal("wiki/career.md", "accept");
  const final = await read("wiki/career.md");
  assert.match(final, /appended$/s);
  assert.equal(await exists("proposed/wiki/career.md"), false);
});

test("resolve_proposal reject deletes the proposal without touching the vault", async () => {
  const before = await read("wiki/career.md");
  await proposals.appendTo("wiki/career.md", "bad change");
  const result = await proposals.resolveProposal("wiki/career.md", "reject");
  assert.equal(result.action, "rejected");
  assert.equal(await exists("proposed/wiki/career.md"), false);
  assert.equal(await read("wiki/career.md"), before);
});

test("resolve_proposal accepts the 'proposed/' prefix in path", async () => {
  await proposals.proposePage("wiki/prefixed.md", "x");
  await proposals.resolveProposal("proposed/wiki/prefixed.md", "accept");
  assert.equal(await read("wiki/prefixed.md"), "x");
});

test("path traversal rejected on every write surface", async () => {
  await assert.rejects(() => proposals.proposePage("../etc/passwd", "x"));
  await assert.rejects(() => proposals.proposeEdit("../foo.md", "a", "b"));
  await assert.rejects(() => proposals.appendTo("../foo.md", "x"));
});

test("writes targeting 'proposed/<x>' rejected", async () => {
  await assert.rejects(
    () => proposals.proposePage("proposed/wiki/foo.md", "x"),
    /cannot start with proposed/
  );
});

test("resolve_proposal accept appends a tracker row when proposal is a source page", async () => {
  const body = `---
type: source
bucket: sources
summary: Test source
raw_file: raw/topic.md
---

# Source: Topic
`;
  await proposals.proposePage("wiki/sources/source-topic.md", body);
  const result = await proposals.resolveProposal("wiki/sources/source-topic.md", "accept");
  assert.equal(result.action, "accepted");
  assert.ok(result.trackerUpdated.changed, "tracker should be updated");
  assert.equal(result.trackerUpdated.action, "created");
  const tracker = await read("wiki/ingest-tracker.md");
  assert.match(tracker, /\| raw\/topic\.md \| ingested \| \[\[source-topic\]\]/);
});

test("resolve_proposal accept appends to existing tracker", async () => {
  const seed = `---
type: tracker
---

# Ingest Tracker

| Source file | Status | Source page | Connected pages | Words | Notes |
|---|---|---|---|---:|---|
| raw/old.md | ingested | [[source-old]] | - |  |  |
`;
  const trackerAbs = path.join(tmpRoot, "wiki/ingest-tracker.md");
  await mkdir(path.dirname(trackerAbs), { recursive: true });
  await writeFile(trackerAbs, seed, "utf8");
  const body = `---
type: source
raw_file: raw/new.md
---
`;
  await proposals.proposePage("wiki/sources/source-new.md", body);
  await proposals.resolveProposal("wiki/sources/source-new.md", "accept");
  const tracker = await read("wiki/ingest-tracker.md");
  assert.match(tracker, /\| raw\/old\.md \|/);
  assert.match(tracker, /\| raw\/new\.md \| ingested \| \[\[source-new\]\]/);
});

test("resolve_proposal accept is idempotent on tracker rows", async () => {
  const body = `---
type: source
raw_file: raw/idem.md
---
`;
  await proposals.proposePage("wiki/sources/source-idem.md", body);
  const first = await proposals.resolveProposal("wiki/sources/source-idem.md", "accept");
  assert.equal(first.trackerUpdated.changed, true);

  await proposals.proposePage("wiki/sources/source-idem.md", body, { force: true });
  const second = await proposals.resolveProposal("wiki/sources/source-idem.md", "accept");
  assert.equal(second.trackerUpdated.changed, false);
  assert.equal(second.trackerUpdated.reason, "already-tracked");

  const tracker = await read("wiki/ingest-tracker.md");
  const matches = tracker.match(/\| raw\/idem\.md \|/g) || [];
  assert.equal(matches.length, 1);
});

test("resolve_proposal accept on non-source proposal does not touch tracker", async () => {
  await proposals.proposePage("wiki/notes/random.md", "# Random\n\nNot a source.\n");
  const result = await proposals.resolveProposal("wiki/notes/random.md", "accept");
  assert.equal(result.trackerUpdated.changed, false);
});

test("tracker append works for source pages with non-raw raw_file paths", async () => {
  const body = `---
type: source
raw_file: meetings/march-7.md
---

# Source: March 7
`;
  await proposals.proposePage("wiki/sources/source-march-7.md", body);
  const result = await proposals.resolveProposal("wiki/sources/source-march-7.md", "accept");
  assert.equal(result.action, "accepted");
  assert.equal(result.trackerUpdated.changed, true);
  const tracker = await read("wiki/ingest-tracker.md");
  assert.match(tracker, /\| meetings\/march-7\.md \| ingested \| \[\[source-march-7\]\]/);
});

test("tracker is idempotent for non-raw paths too", async () => {
  const body = `---
type: source
raw_file: clippings/foo.md
---
`;
  await proposals.proposePage("wiki/sources/source-foo.md", body);
  await proposals.resolveProposal("wiki/sources/source-foo.md", "accept");
  await proposals.proposePage("wiki/sources/source-foo.md", body, { force: true });
  await proposals.resolveProposal("wiki/sources/source-foo.md", "accept");
  const tracker = await read("wiki/ingest-tracker.md");
  const matches = tracker.match(/\| clippings\/foo\.md \|/g) || [];
  assert.equal(matches.length, 1);
});
