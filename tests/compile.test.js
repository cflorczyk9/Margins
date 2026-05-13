import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createProposals } from "../src/proposals.js";
import { createCompile } from "../src/compile.js";

let tmpRoot;
let vault;
let proposals;
let compile;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-compile-"));
  vault = createVault(tmpRoot);
  proposals = createProposals(vault);
  compile = createCompile(vault, proposals);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

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

test("compiles a markdown raw source into a proposal", async () => {
  await touch(
    "raw/2026-05-13-test-call.md",
    "# Test Call\n\nThis was a call about Project X. Important takeaway: ship the thing."
  );
  const result = await compile.proposeCompileFromRaw(
    "2026-05-13-test-call.md",
    {
      summary: "A test call about Project X.",
      takeaways: [{ point: "Ship the thing", evidence: "Important takeaway" }]
    }
  );
  assert.ok(result.proposalPath.startsWith("proposed/wiki/"));
  assert.match(result.title, /Test Call|2026-05-13-test-call/);
  const body = await read(result.proposalPath);
  assert.match(body, /type: source/);
  assert.match(body, /summary:.*Project X/);
  assert.match(body, /raw_file: raw\/2026-05-13-test-call\.md/);
});

test("accepts a 'raw/' prefix or bare filename", async () => {
  await touch("raw/foo.md", "body");
  const a = await compile.proposeCompileFromRaw("raw/foo.md", { summary: "s" });
  const b = await compile.proposeCompileFromRaw("foo.md", { summary: "s" });
  assert.equal(a.rawFile, b.rawFile);
});

test("errors when raw/ directory doesn't exist", async () => {
  await assert.rejects(
    () => compile.proposeCompileFromRaw("missing.md", { summary: "s" }),
    /raw\/ directory not found/
  );
});

test("errors with empty-raw hint when raw/ exists but is empty", async () => {
  await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
  await assert.rejects(
    () => compile.proposeCompileFromRaw("missing.md", { summary: "s" }),
    /raw\/ folder is empty/
  );
});

test("error suggests closest match for a mistyped raw filename", async () => {
  await touch("raw/2026-05-13-board-call.md", "body");
  await touch("raw/april-pitch.md", "body");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("2026-05-13-bord-call.md", { summary: "s" }),
    /Did you mean: raw\/2026-05-13-board-call\.md/
  );
});

test("error lists available files when no close match", async () => {
  await touch("raw/foo.md", "body");
  await touch("raw/bar.md", "body");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("totally-different-and-long-name.md", { summary: "s" }),
    /Available in raw\/.*foo\.md.*bar\.md|Available in raw\/.*bar\.md.*foo\.md/
  );
});

test("errors on unsupported binary extension", async () => {
  await touch("raw/foo.pdf", "fake pdf content");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("foo.pdf", { summary: "s" }),
    /unsupported file type/
  );
});

test("supports destination_path override", async () => {
  await touch("raw/note.md", "body");
  const result = await compile.proposeCompileFromRaw("note.md", {
    summary: "s",
    destination_path: "wiki/career/source-note.md"
  });
  assert.equal(result.destinationPath, "wiki/career/source-note.md");
  assert.ok(await exists("proposed/wiki/career/source-note.md"));
});

test("rejects path traversal in raw path", async () => {
  await assert.rejects(
    () => compile.proposeCompileFromRaw("../../etc/passwd", { summary: "s" })
  );
});
