import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { createVault } from "../src/vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures");

test("listFiles returns supported vault files", async () => {
  const vault = createVault(FIXTURE);
  const files = await vault.listFiles();
  const rels = files.map((f) => vault.toRel(f)).sort();
  assert.deepEqual(rels, [
    "wiki/briefly.md",
    "wiki/career.md",
    "wiki/index.md"
  ]);
});

test("readPage extracts supported raw document text", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-vault-docs-"));
  try {
    await writeFixture(tmpRoot, "raw/research.pdf", await makePdf("Vault PDF readable Alpha"));
    await writeFixture(tmpRoot, "raw/call.docx", await makeDocx("Vault DOCX readable Beta"));

    const vault = createVault(tmpRoot);
    const files = (await vault.listFiles()).map((f) => vault.toRel(f)).sort();
    assert.deepEqual(files, ["raw/call.docx", "raw/research.pdf"]);

    const pdf = await vault.readPage("raw/research.pdf");
    assert.match(pdf.body, /Vault PDF readable Alpha/);
    const docx = await vault.readPage("raw/call.docx");
    assert.match(docx.body, /Vault DOCX readable Beta/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("readPage still allows empty text files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-vault-empty-"));
  try {
    await writeFixture(tmpRoot, "wiki/empty.md", "");
    const vault = createVault(tmpRoot);
    const page = await vault.readPage("wiki/empty.md");
    assert.equal(page.body, "");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchVault finds body and filename matches", async () => {
  const vault = createVault(FIXTURE);
  const bodyHits = await vault.searchVault("Affinity", 10);
  assert.equal(bodyHits.length, 1);
  assert.equal(bodyHits[0].path, "wiki/briefly.md");
  assert.match(bodyHits[0].snippet, /Affinity/i);

  const pathHits = await vault.searchVault("career", 10);
  assert.ok(pathHits.find((h) => h.path === "wiki/career.md"));
});

test("searchVault returns non-text filename matches without extracting", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-search-filename-"));
  try {
    await writeFixture(tmpRoot, "raw/broken-smoke.pdf", "not actually a pdf");
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("broken-smoke.pdf", 10);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, "raw/broken-smoke.pdf");
    assert.equal(hits[0].snippet, "Filename match.");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("readPage returns body and rejects traversal", async () => {
  const vault = createVault(FIXTURE);
  const page = await vault.readPage("wiki/career.md");
  assert.match(page.body, /# Career/);
  assert.equal(page.path, "wiki/career.md");

  await assert.rejects(() => vault.readPage("../../etc/passwd"));
});

test("listRecent honors limit", async () => {
  const vault = createVault(FIXTURE);
  const recent = await vault.listRecent(2);
  assert.equal(recent.length, 2);
});

test("getBacklinks finds wikilinks", async () => {
  const vault = createVault(FIXTURE);
  const hits = await vault.getBacklinks("career", 10);
  const paths = hits.map((h) => h.path).sort();
  assert.deepEqual(paths, ["wiki/briefly.md", "wiki/index.md"]);
});

async function writeFixture(root, rel, body) {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body);
}

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

test("read_page caps extracted text at 250KB and reports truncation", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-readpage-cap-"));
  try {
    await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
    const big = "x".repeat(300 * 1024);
    await writeFile(path.join(tmpRoot, "raw/huge.txt"), big);
    const vault = createVault(tmpRoot);
    const result = await vault.readPage("raw/huge.txt");
    assert.equal(result.truncated, true);
    assert.equal(result.textLength, 300 * 1024);
    assert.ok(result.body.length < big.length, "body should be truncated below original length");
    assert.match(result.body, /Truncated at \d+ characters/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("read_page on normal-size file returns full text without truncation flag", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-readpage-normal-"));
  try {
    await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
    await writeFile(path.join(tmpRoot, "raw/normal.md"), "A normal-sized markdown file.");
    const vault = createVault(tmpRoot);
    const result = await vault.readPage("raw/normal.md");
    assert.equal(result.truncated, false);
    assert.equal(result.body, "A normal-sized markdown file.");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
