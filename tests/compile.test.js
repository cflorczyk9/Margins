import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
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

async function writeRaw(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body);
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
  await touch("raw/foo.md", "This is the body of a short test note for fixture purposes.");
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
  await touch("raw/foo.md", "This is the body of a short test note for fixture purposes.");
  await touch("raw/bar.md", "body");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("totally-different-and-long-name.md", { summary: "s" }),
    /Available in raw\/.*foo\.md.*bar\.md|Available in raw\/.*bar\.md.*foo\.md/
  );
});

test("errors on unsupported binary extension", async () => {
  await writeRaw("raw/foo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await assert.rejects(
    () => compile.proposeCompileFromRaw("foo.png", { summary: "s" }),
    /unsupported file type/
  );
});

test("compiles a PDF raw source into a proposal", async () => {
  await writeRaw("raw/research-brief.pdf", await makePdf("Margins PDF intake signal Alpha"));
  const result = await compile.proposeCompileFromRaw("research-brief.pdf", {
    summary: "A PDF research brief about Alpha.",
    takeaways: [{ point: "Alpha appears in the PDF", evidence: "PDF intake signal" }]
  });
  assert.equal(result.rawFile, "raw/research-brief.pdf");
  assert.ok(result.termsExtracted.includes("alpha"));
  const body = await read(result.proposalPath);
  assert.match(body, /raw_file: raw\/research-brief\.pdf/);
  assert.match(body, /Alpha appears in the PDF/);
});

test("compiles a DOCX raw source into a proposal", async () => {
  await writeRaw("raw/customer-call.docx", await makeDocx("Margins DOCX intake signal Beta"));
  const result = await compile.proposeCompileFromRaw("customer-call.docx", {
    summary: "A DOCX customer call about Beta."
  });
  assert.equal(result.rawFile, "raw/customer-call.docx");
  assert.ok(result.termsExtracted.includes("beta"));
  const body = await read(result.proposalPath);
  assert.match(body, /raw_file: raw\/customer-call\.docx/);
});

test("compiles common text-like document formats", async () => {
  await touch("raw/clipped-article.html", "<h1>Margins HTML intake</h1><p>Gamma signal &amp; evidence.</p>");
  const result = await compile.proposeCompileFromRaw("clipped-article.html", {
    summary: "An HTML clipped article about Gamma."
  });
  assert.equal(result.rawFile, "raw/clipped-article.html");
  assert.ok(result.termsExtracted.includes("gamma"));
});

test("supports destination_path override", async () => {
  await touch("raw/note.md", "Test fixture content for the compile idempotency tests, deliberately long enough to clear the empty-extraction threshold.");
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

function makePdf(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(16).text(text);
    doc.end();
  });
}

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:body>` +
      `</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function xmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

test("idempotent: second compile of same raw file returns already-filed", async () => {
  await touch("raw/note.md", "# Note\n\nFirst content of the idempotency test, with enough text to clear the empty-extraction threshold.");
  const first = await compile.proposeCompileFromRaw("note.md", { summary: "First take." });
  assert.equal(first.status, "proposal-staged");
  await proposals.resolveProposal(first.destinationPath, "accept");

  const second = await compile.proposeCompileFromRaw("note.md", { summary: "Second take." });
  assert.equal(second.status, "already-filed");
  assert.equal(second.rawFile, "raw/note.md");
  assert.equal(second.existingPath, first.destinationPath);
  assert.ok(!second.proposalPath, "no proposal should be staged on duplicate");
});

test("force=true bypasses idempotency check and stages replacement proposal", async () => {
  await touch("raw/note2.md", "# Note 2\n\nOriginal content of the force-replace test, with enough text to clear the threshold.");
  const first = await compile.proposeCompileFromRaw("note2.md", { summary: "Original." });
  await proposals.resolveProposal(first.destinationPath, "accept");

  const replace = await compile.proposeCompileFromRaw("note2.md", {
    summary: "Replacement.",
    force: true
  });
  assert.equal(replace.status, "proposal-staged");
  assert.ok(replace.proposalPath, "force=true should stage a proposal");
});

test("compiles a file located outside raw/ (vault-root path)", async () => {
  await touch(
    "meetings/2026-05-14-call.md",
    "# Call\n\nDiscussed Project X with Alex and Sam."
  );
  const result = await compile.proposeCompileFromRaw(
    "meetings/2026-05-14-call.md",
    { summary: "Call about Project X." }
  );
  assert.equal(result.status, "proposal-staged");
  assert.equal(result.rawFile, "meetings/2026-05-14-call.md");
  const body = await read(result.proposalPath);
  assert.match(body, /raw_file: meetings\/2026-05-14-call\.md/);
  assert.match(body, /Original file: `meetings\/2026-05-14-call\.md`/);
});

test("bare filename compiles a root-level file when raw/ copy does not exist", async () => {
  await touch(
    "meeting-root.md",
    "# Root Meeting\n\nDiscussed Project X with Alex and Sam in a root-level file."
  );
  const result = await compile.proposeCompileFromRaw("meeting-root.md", {
    summary: "Root-level meeting notes."
  });
  assert.equal(result.rawFile, "meeting-root.md");
  const body = await read(result.proposalPath);
  assert.match(body, /raw_file: meeting-root\.md/);
  assert.match(body, /Original file: `meeting-root\.md`/);
});

test("idempotency check works for files outside raw/", async () => {
  await touch("clippings/article.md", "# Article\n\nBody content for the clippings idempotency test, with enough text to clear the threshold.");
  const first = await compile.proposeCompileFromRaw("clippings/article.md", {
    summary: "An article."
  });
  await proposals.resolveProposal(first.destinationPath, "accept");

  const second = await compile.proposeCompileFromRaw("clippings/article.md", {
    summary: "Trying again."
  });
  assert.equal(second.status, "already-filed");
  assert.equal(second.rawFile, "clippings/article.md");
});

test("bare filename still defaults to raw/ for back-compat", async () => {
  await touch("raw/legacy.md", "# Legacy\n\nOld habit, with enough body content to clear the empty-extraction threshold.");
  await touch("legacy.md", "# Root Legacy\n\nRoot file exists too, but raw/ wins for back-compat.");
  const result = await compile.proposeCompileFromRaw("legacy.md", {
    summary: "Legacy file."
  });
  assert.equal(result.rawFile, "raw/legacy.md");
});

test("explicit ./ filename compiles root-level file even when raw/ copy exists", async () => {
  await touch("raw/explicit.md", "# Raw Explicit\n\nRaw copy exists.");
  await touch(
    "explicit.md",
    "# Explicit Root\n\nRoot-level explicit path should win over raw fallback."
  );
  const result = await compile.proposeCompileFromRaw("./explicit.md", {
    summary: "Explicit root file."
  });
  assert.equal(result.rawFile, "explicit.md");
});

test("near-empty extraction refuses without force", async () => {
  // 'hi.\n' = 3 meaningful chars, under the 20-char threshold but not so
  // empty that extractDocumentText itself throws.
  await touch("raw/tiny.md", "hi.\n");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/tiny.md", { summary: "s" }),
    /produced only \d+ characters of extractable text/
  );
});

test("near-empty extraction can be force-staged anyway", async () => {
  await touch("raw/tiny2.md", "tiny");
  const result = await compile.proposeCompileFromRaw("raw/tiny2.md", { summary: "s", force: true });
  assert.equal(result.status, "proposal-staged");
});

test("fully empty file falls through to extractor error with OCR hint", async () => {
  await touch("raw/empty.md", "   \n");
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/empty.md", { summary: "s" }),
    /OCR|empty|image-only/
  );
});

test("oversized files (over 50MB) rejected with actionable error", async () => {
  // Create a file just over the 50MB cap. Use a sparse write to keep the test fast.
  const big = path.join(tmpRoot, "raw/huge.md");
  await mkdir(path.dirname(big), { recursive: true });
  const fh = await import("node:fs/promises").then((m) => m.open(big, "w"));
  try {
    await fh.truncate(50 * 1024 * 1024 + 100);
  } finally {
    await fh.close();
  }
  await assert.rejects(
    () => compile.proposeCompileFromRaw("raw/huge.md", { summary: "s" }),
    /refuses to extract files over 50MB/
  );
});

test("canonical path matching: ./raw/foo.md and raw/foo.md are the same file", async () => {
  await touch("raw/foo.md", "Real body content for the canonical-path matching test, long enough to clear the threshold.");
  const first = await compile.proposeCompileFromRaw("raw/foo.md", { summary: "s" });
  await proposals.resolveProposal(first.destinationPath, "accept");
  const second = await compile.proposeCompileFromRaw("./raw/foo.md", { summary: "s" });
  assert.equal(second.status, "already-filed");
});

test("compile writes raw_sha256 and raw_size into source-page frontmatter", async () => {
  await touch("raw/hashed.md", "Content with enough body to clear the threshold and produce a meaningful hash.");
  const result = await compile.proposeCompileFromRaw("raw/hashed.md", { summary: "test" });
  assert.match(result.rawSha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof result.rawSize, "number");
  const body = await read(result.proposalPath);
  assert.match(body, /raw_sha256: [0-9a-f]{64}/);
  assert.match(body, /raw_size: \d+/);
});

test("slug collision: same basename in different folders gets disambiguator", async () => {
  await touch("meetings/foo.md", "First foo with enough body to clear the empty-extraction threshold.");
  const first = await compile.proposeCompileFromRaw("meetings/foo.md", { summary: "first" });
  await proposals.resolveProposal(first.destinationPath, "accept");

  await touch("contracts/foo.md", "Second foo with completely different content but the same basename.");
  const second = await compile.proposeCompileFromRaw("contracts/foo.md", { summary: "second" });
  // Should NOT be the same destination path as first
  assert.notEqual(second.destinationPath, first.destinationPath);
  assert.match(second.destinationPath, /source-foo-[0-9a-f]{8}\.md$/);
});

test("custom bucket like 'finance' routes correctly (not silently to sources)", async () => {
  await touch("raw/finance-note.md", "A finance note long enough to clear the empty-extraction threshold for this test fixture.");
  const result = await compile.proposeCompileFromRaw("raw/finance-note.md", {
    summary: "Test",
    bucket: "finance"
  });
  assert.equal(result.bucket, "finance");
  assert.ok(result.destinationPath.startsWith("wiki/finance/"), `expected wiki/finance/* but got ${result.destinationPath}`);
});

test("custom bucket like 'entertainment' also works (was previously routed to sources)", async () => {
  await touch("raw/movie-note.md", "A movie note with enough body to clear the empty-extraction threshold.");
  const result = await compile.proposeCompileFromRaw("raw/movie-note.md", {
    summary: "Test",
    bucket: "entertainment"
  });
  assert.ok(result.destinationPath.startsWith("wiki/entertainment/"), `expected wiki/entertainment/* but got ${result.destinationPath}`);
});

test("bucket with traversal attempt is rejected and falls back to sources", async () => {
  await touch("raw/safety-test.md", "Content for the bucket safety test that needs to clear the empty-extraction threshold.");
  const result = await compile.proposeCompileFromRaw("raw/safety-test.md", {
    summary: "Test",
    bucket: "../../etc"
  });
  assert.ok(result.destinationPath.startsWith("wiki/sources/"));
});

test("force=true on existing page in non-default bucket replaces in place (not at default)", async () => {
  await touch("raw/film-essay.md", "Original film essay content long enough to clear the empty-extraction threshold.");
  const first = await compile.proposeCompileFromRaw("raw/film-essay.md", {
    summary: "v1",
    bucket: "ideas"
  });
  await proposals.resolveProposal(first.destinationPath, "accept");
  assert.ok(first.destinationPath.startsWith("wiki/ideas/"), `setup: first should be in ideas, got ${first.destinationPath}`);

  // Force-recompile WITHOUT specifying bucket — should land at the existing path
  const second = await compile.proposeCompileFromRaw("raw/film-essay.md", {
    summary: "v2 refreshed",
    force: true
  });
  assert.equal(second.destinationPath, first.destinationPath, "force=true should replace at existing path, not default to wiki/sources/");
});

test("force=true WITH explicit bucket override moves to new bucket", async () => {
  await touch("raw/migrating.md", "Content for the migration test, with enough body to clear the empty-extraction threshold.");
  const first = await compile.proposeCompileFromRaw("raw/migrating.md", { summary: "v1", bucket: "ideas" });
  await proposals.resolveProposal(first.destinationPath, "accept");

  const second = await compile.proposeCompileFromRaw("raw/migrating.md", {
    summary: "v2 in projects",
    force: true,
    bucket: "projects"
  });
  assert.ok(second.destinationPath.startsWith("wiki/projects/"), `expected move to wiki/projects/, got ${second.destinationPath}`);
});
