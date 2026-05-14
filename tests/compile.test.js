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
