import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  extractDocumentText,
  isSupportedDocumentPath,
  supportedExtensionsList
} from "../src/document-text.js";

let tmpRoot;

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

async function writeFixture(name, body) {
  if (!tmpRoot) tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-doc-text-"));
  const abs = path.join(tmpRoot, name);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body);
  return abs;
}

test("supports common text-ish document extensions", async () => {
  const expected = [
    ".mdx", ".text", ".log", ".tsv", ".xml", ".toml", ".ini", ".conf",
    ".rst", ".org", ".tex", ".adoc", ".asciidoc", ".srt", ".vtt"
  ];
  for (const ext of expected) {
    assert.ok(isSupportedDocumentPath(`example${ext}`), `${ext} is supported`);
  }
  assert.match(supportedExtensionsList(), /\.mdx/);

  const abs = await writeFixture("note.mdx", "# Margins MDX Alpha\n\nBody");
  const text = await extractDocumentText(abs, "note.mdx");
  assert.match(text, /Margins MDX Alpha/);
});

test("extracts XLSX and XLSM workbook text", async () => {
  const workbook = await makeXlsx("Margins XLSX Alpha");
  const xlsxPath = await writeFixture("workbook.xlsx", workbook);
  const xlsmPath = await writeFixture("macro-workbook.xlsm", workbook);

  assert.match(await extractDocumentText(xlsxPath, "workbook.xlsx"), /Margins XLSX Alpha/);
  assert.match(await extractDocumentText(xlsmPath, "macro-workbook.xlsm"), /Sheet: Summary/);
});

test("extracts ODS spreadsheet text", async () => {
  const abs = await writeFixture("sheet.ods", await makeOdf("table", "Margins ODS Beta"));
  const text = await extractDocumentText(abs, "sheet.ods");
  assert.match(text, /Sheet: Sheet One/);
  assert.match(text, /Margins ODS Beta/);
});

test("extracts PPTX and ODP presentation text", async () => {
  const pptxPath = await writeFixture("deck.pptx", await makePptx("Margins PPTX Gamma"));
  const odpPath = await writeFixture("deck.odp", await makeOdf("presentation", "Margins ODP Delta"));

  assert.match(await extractDocumentText(pptxPath, "deck.pptx"), /Margins PPTX Gamma/);
  assert.match(await extractDocumentText(odpPath, "deck.odp"), /Margins ODP Delta/);
});

test("extracts EML email text", async () => {
  const abs = await writeFixture(
    "message.eml",
    [
      "From: Casey <casey@example.com>",
      "Subject: Margins EML Epsilon",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "The body mentions Epsilon and a follow-up."
    ].join("\r\n")
  );
  const text = await extractDocumentText(abs, "message.eml");
  assert.match(text, /Subject: Margins EML Epsilon/);
  assert.match(text, /follow-up/);
});

test("extracts text/plain body from multipart EML", async () => {
  const abs = await writeFixture(
    "multipart.eml",
    [
      "Subject: Multipart Margins Email",
      "Content-Type: multipart/alternative; boundary=\"margins-boundary\"",
      "",
      "--margins-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Plain email body wins.",
      "--margins-boundary",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>HTML fallback body</p>",
      "--margins-boundary--",
      ""
    ].join("\r\n")
  );
  const text = await extractDocumentText(abs, "multipart.eml");
  assert.match(text, /Plain email body wins/);
  assert.doesNotMatch(text, /HTML fallback body/);
});

test("extracts EPUB ebook text", async () => {
  const abs = await writeFixture("book.epub", await makeEpub("Margins EPUB Zeta"));
  const text = await extractDocumentText(abs, "book.epub");
  assert.match(text, /EPUB: book\.epub/);
  assert.match(text, /Margins EPUB Zeta/);
});

test("extracts ODT document text", async () => {
  const abs = await writeFixture("doc.odt", await makeOdf("text", "Margins ODT Eta"));
  const text = await extractDocumentText(abs, "doc.odt");
  assert.match(text, /Margins ODT Eta/);
});

async function makeXlsx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`
  );
  zip.folder("xl").file(
    "workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`
  );
  zip.folder("xl").folder("_rels").file(
    "workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`
  );
  zip.folder("xl").folder("worksheets").file(
    "sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData><row r="1">` +
      `<c r="A1" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>` +
      `<c r="B1"><v>42</v></c>` +
      `</row></sheetData></worksheet>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePptx(text) {
  const zip = new JSZip();
  zip.folder("ppt").folder("slides").file(
    "slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>` +
      `</p:sld>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeEpub(text) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.folder("META-INF").file(
    "container.xml",
    `<?xml version="1.0"?>` +
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>` +
      `</container>`
  );
  zip.folder("OEBPS").file(
    "chapter1.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter</h1><p>${xmlEscape(text)}</p></body></html>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeOdf(kind, text) {
  const zip = new JSZip();
  zip.file("mimetype", `application/vnd.oasis.opendocument.${kind}`);
  const body = kind === "table"
    ? `<office:spreadsheet><table:table table:name="Sheet One"><table:table-row><table:table-cell><text:p>${xmlEscape(text)}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`
    : `<office:${kind}><text:p>${xmlEscape(text)}</text:p></office:${kind}>`;
  zip.file(
    "content.xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
      `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
      `xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">` +
      `<office:body>${body}</office:body></office:document-content>`
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
