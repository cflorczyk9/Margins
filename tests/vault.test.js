import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { createVault, tokenizeQuery } from "../src/vault.js";

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

test("readPage rejects absolute paths with a clear error", async () => {
  const vault = createVault(FIXTURE);
  await assert.rejects(
    () => vault.readPage("/etc/passwd"),
    /vault-relative|absolute path/
  );
  await assert.rejects(
    () => vault.readPage("/tmp/anything.md"),
    /vault-relative|absolute path/
  );
});

test("readPage refuses files over the 50MB cap before extraction", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-bigfile-"));
  try {
    await mkdir(path.join(tmpRoot, "raw"), { recursive: true });
    // Sparse 51MB file — truncate writes a hole, no actual disk pressure.
    const bigAbs = path.join(tmpRoot, "raw/huge.txt");
    const { open } = await import("node:fs/promises");
    const fh = await open(bigAbs, "w");
    await fh.truncate(51 * 1024 * 1024);
    await fh.close();
    const vault = createVault(tmpRoot);
    await assert.rejects(
      () => vault.readPage("raw/huge.txt"),
      /exceeds.*read_page cap/
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("readPage rejects symlinks pointing outside the vault root", async () => {
  const { symlink } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-symlink-"));
  try {
    await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
    // Create a target file OUTSIDE the vault, then a symlink inside the vault
    // pointing at it. readPage must refuse to follow.
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "margins-outside-"));
    const outsideFile = path.join(outsideDir, "secret.md");
    await writeFile(outsideFile, "secret content");
    const linkPath = path.join(tmpRoot, "wiki", "leak.md");
    await symlink(outsideFile, linkPath);
    const vault = createVault(tmpRoot);
    await assert.rejects(
      () => vault.readPage("wiki/leak.md"),
      /outside vault root via symlink/
    );
    await rm(outsideDir, { recursive: true, force: true });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("listFiles / search skip symlinks entirely", async () => {
  const { symlink } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-symlink-walk-"));
  try {
    await mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
    await writeFile(path.join(tmpRoot, "wiki", "real.md"), "real page");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "margins-walk-outside-"));
    const outsideFile = path.join(outsideDir, "secret.md");
    await writeFile(outsideFile, "shhh briefly secret data");
    await symlink(outsideFile, path.join(tmpRoot, "wiki", "leaked.md"));
    const vault = createVault(tmpRoot);
    const files = (await vault.listFiles()).map((f) => vault.toRel(f));
    assert.ok(files.includes("wiki/real.md"));
    assert.ok(!files.includes("wiki/leaked.md"), "symlinked file should be excluded");
    // And search must not surface the symlinked file either.
    const hits = await vault.searchVault("briefly secret", 5);
    const hitPaths = hits.map((h) => h.path);
    assert.ok(!hitPaths.includes("wiki/leaked.md"));
    await rm(outsideDir, { recursive: true, force: true });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchVault caps query tokens to prevent pathological multi-word queries", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-token-cap-"));
  try {
    await writeFixture(tmpRoot, "wiki/notes/page.md", "alpha beta gamma");
    const vault = createVault(tmpRoot);
    // 50-token query — only the first 12 should be considered. Search should
    // still complete quickly and return matches based on the head tokens.
    const tokens = Array(50).fill(0).map((_, i) => `tok${i}`);
    tokens[0] = "alpha";
    tokens[1] = "beta";
    const longQuery = tokens.join(" ");
    const hits = await vault.searchVault(longQuery, 3);
    // We don't require zero hits — just that the call returns without
    // grinding through all 50 tokens.
    assert.ok(Array.isArray(hits));
    // tokensTotal in returned hits should be <= 12.
    for (const h of hits) {
      assert.ok(h.tokensTotal <= 12, `tokensTotal ${h.tokensTotal} > 12 cap`);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("search snippet for extraction errors does NOT leak parser internals", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-extract-error-"));
  try {
    // Corrupt PDF — filename matches the query but body extraction will fail.
    await writeFixture(tmpRoot, "raw/centric-pilot-broken.pdf", "definitely not a real pdf");
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("centric-pilot-broken.pdf", 3);
    assert.equal(hits.length, 1);
    // Snippet should be the generic "Filename match" — must not embed err.message
    // (which can carry absolute filesystem paths from parser libs).
    assert.ok(
      !hits[0].snippet.includes("/Users/") &&
      !hits[0].snippet.includes("/private/") &&
      !hits[0].snippet.includes("\\Users\\"),
      `snippet leaked absolute path: ${hits[0].snippet}`
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("resolveInside catches Windows-style backslash traversal on every platform", () => {
  const vault = createVault(FIXTURE);
  // On Unix without backslash normalization, this writes a literal `..\foo.md`
  // file inside the vault — surprising. On Windows it would actually escape.
  // Either way: reject it.
  assert.throws(() => vault.resolveInside("..\\foo.md"), /escapes vault root/);
  assert.throws(() => vault.resolveInside("..\\..\\..\\etc\\hosts"), /escapes vault root/);
});

test("searchVault throws on empty query instead of returning []", async () => {
  const vault = createVault(FIXTURE);
  await assert.rejects(() => vault.searchVault("", 10), /non-empty query/);
  await assert.rejects(() => vault.searchVault("   ", 10), /non-empty query/);
});

test("getBacklinks throws on empty target instead of returning []", async () => {
  const vault = createVault(FIXTURE);
  await assert.rejects(() => vault.getBacklinks("", 10), /non-empty target/);
});

test("searchVault ranks wiki/ hits above margins/tests/fixtures hits", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-search-priority-"));
  try {
    await writeFixture(tmpRoot, "wiki/projects/briefly.md", "# Briefly\n\nThe real Briefly page.");
    await writeFixture(
      tmpRoot,
      "margins/tests/fixtures/wiki/briefly.md",
      "# Briefly fixture stub"
    );
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("Briefly", 10);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].path, "wiki/projects/briefly.md");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("tokenizeQuery drops stopwords and lowercases", () => {
  assert.deepEqual(tokenizeQuery("what did I write about Briefly pricing"), [
    "write",
    "briefly",
    "pricing"
  ]);
  assert.deepEqual(tokenizeQuery("Find my notes on Bob Casey"), [
    "notes",
    "bob",
    "casey"
  ]);
  assert.deepEqual(tokenizeQuery("the and or it is"), []);
});

test("searchVault errors clearly when query is all stopwords", async () => {
  const vault = createVault(FIXTURE);
  await assert.rejects(
    () => vault.searchVault("the and of", 10),
    /no searchable terms after dropping stopwords/
  );
});

test("searchVault multi-word query prefers pages with all tokens over partial matches", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-token-search-"));
  try {
    await writeFixture(
      tmpRoot,
      "wiki/projects/both.md",
      "This page mentions Briefly and discusses pricing in detail."
    );
    await writeFixture(
      tmpRoot,
      "wiki/projects/only-briefly.md",
      "Briefly appears here many times. Briefly. Briefly. Briefly. Briefly."
    );
    await writeFixture(
      tmpRoot,
      "wiki/projects/only-pricing.md",
      "Pricing pricing pricing pricing pricing."
    );
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("Briefly pricing", 5);
    assert.equal(hits[0].path, "wiki/projects/both.md");
    assert.equal(hits[0].tokensMatched, 2);
    assert.equal(hits[0].tokensTotal, 2);
    // Partial matches still appear, but ranked below
    const paths = hits.map((h) => h.path);
    assert.ok(paths.includes("wiki/projects/only-briefly.md"));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchVault multi-word query rewards filename matches over hub-page mentions", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-filename-boost-"));
  try {
    // Hub page mentions everything but isn't *about* the topic
    await writeFixture(
      tmpRoot,
      "wiki/career/hub.md",
      Array(20).fill("Centric pilot agreement Ellis").join(". ")
    );
    // The actual agreement file — fewer mentions, but title is on-topic
    await writeFixture(
      tmpRoot,
      "wiki/outbound/2026-05-04-centric-pilot-agreement.md",
      "Centric pilot agreement with Ellis."
    );
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("Ellis Centric pilot agreement", 5);
    assert.equal(
      hits[0].path,
      "wiki/outbound/2026-05-04-centric-pilot-agreement.md",
      "filename-match page should outrank the hub page that mentions everything"
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("searchVault natural-language query handles 'what did I write about X' pattern", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-nl-search-"));
  try {
    await writeFixture(
      tmpRoot,
      "wiki/career/blackstone.md",
      "Notes about Blackstone retail capital growth $200B to $500B target."
    );
    await writeFixture(
      tmpRoot,
      "wiki/notes/unrelated.md",
      "Today I went for a walk."
    );
    const vault = createVault(tmpRoot);
    const hits = await vault.searchVault("what did I write about Blackstone", 5);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].path, "wiki/career/blackstone.md");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("getBacklinks filters out fixture / test paths", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-backlinks-filter-"));
  try {
    await writeFixture(tmpRoot, "wiki/projects/briefly.md", "# Briefly");
    await writeFixture(tmpRoot, "wiki/career/career.md", "Career page — links to [[briefly]].");
    await writeFixture(
      tmpRoot,
      "margins/tests/fixtures/wiki/index.md",
      "# Fixture index — also mentions [[briefly]]."
    );
    const vault = createVault(tmpRoot);
    const hits = await vault.getBacklinks("briefly", 10);
    const paths = hits.map((h) => h.path);
    assert.ok(paths.includes("wiki/career/career.md"));
    assert.ok(!paths.includes("margins/tests/fixtures/wiki/index.md"));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
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
