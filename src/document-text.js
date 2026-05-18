import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import JSZip from "jszip";

const require = createRequire(import.meta.url);

export const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".text",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".toml",
  ".ini",
  ".conf",
  ".log",
  ".rst",
  ".org",
  ".tex",
  ".adoc",
  ".asciidoc",
  ".srt",
  ".vtt"
]);
export const HTML_EXTENSIONS = new Set([".html", ".htm"]);
export const RTF_EXTENSIONS = new Set([".rtf"]);
export const DOCX_EXTENSIONS = new Set([".docx"]);
export const PDF_EXTENSIONS = new Set([".pdf"]);
export const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".xlsm", ".ods"]);
export const PRESENTATION_EXTENSIONS = new Set([".pptx", ".odp"]);
export const EMAIL_EXTENSIONS = new Set([".eml"]);
export const EPUB_EXTENSIONS = new Set([".epub"]);
export const OPENDOCUMENT_TEXT_EXTENSIONS = new Set([".odt", ".ott"]);
export const SUPPORTED_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...DOCX_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS,
  ...PRESENTATION_EXTENSIONS,
  ...EMAIL_EXTENSIONS,
  ...EPUB_EXTENSIONS,
  ...OPENDOCUMENT_TEXT_EXTENSIONS,
  ...RTF_EXTENSIONS,
  ...HTML_EXTENSIONS
].sort();
export const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_EXTENSIONS);

export function isSupportedDocumentPath(filePath) {
  return SUPPORTED_EXTENSION_SET.has(path.extname(filePath).toLowerCase());
}

export function isTextDocumentPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) ||
    HTML_EXTENSIONS.has(ext) ||
    RTF_EXTENSIONS.has(ext) ||
    EMAIL_EXTENSIONS.has(ext);
}

export function supportedExtensionsList() {
  return SUPPORTED_EXTENSIONS.join(", ");
}

export async function extractDocumentText(absPath, displayPath = absPath, options = {}) {
  const ext = path.extname(absPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return ensureReadableText(await readFile(absPath, "utf8"), displayPath, "file", options);
  }
  if (HTML_EXTENSIONS.has(ext)) {
    const html = await readFile(absPath, "utf8");
    return ensureReadableText(htmlToText(html), displayPath, "HTML file", options);
  }
  if (RTF_EXTENSIONS.has(ext)) {
    const rtf = await readFile(absPath, "utf8");
    return ensureReadableText(rtfToText(rtf), displayPath, "RTF file", options);
  }
  if (DOCX_EXTENSIONS.has(ext)) {
    return extractDocxText(await readFile(absPath), displayPath);
  }
  if (PDF_EXTENSIONS.has(ext)) {
    return extractPdfText(await readFile(absPath), displayPath);
  }
  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    const buffer = await readFile(absPath);
    return ext === ".ods"
      ? extractOdsText(buffer, displayPath)
      : extractXlsxText(buffer, displayPath);
  }
  if (PRESENTATION_EXTENSIONS.has(ext)) {
    const buffer = await readFile(absPath);
    return ext === ".odp"
      ? extractOpenDocumentText(buffer, displayPath, "ODP")
      : extractPptxText(buffer, displayPath);
  }
  if (EMAIL_EXTENSIONS.has(ext)) {
    return extractEmailText(await readFile(absPath, "utf8"), displayPath, options);
  }
  if (EPUB_EXTENSIONS.has(ext)) {
    return extractEpubText(await readFile(absPath), displayPath);
  }
  if (OPENDOCUMENT_TEXT_EXTENSIONS.has(ext)) {
    return extractOpenDocumentText(await readFile(absPath), displayPath, "ODT");
  }
  throw new Error(
    `unsupported file type ${ext || "(none)"}. Supported: ${supportedExtensionsList()}. ` +
      "For legacy Office files (.doc, .ppt, .xls), images, or scanned documents, export to PDF/DOCX or OCR text first."
  );
}

async function extractPdfText(buffer, displayPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfWorker(pdfjs);
  silencePdfWarnings(pdfjs);
  let pdfDocument;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      verbosity: 0,
      standardFontDataUrl: pdfStandardFontDataPath()
    });
    pdfDocument = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
      page.cleanup();
    }
    return ensureReadableText(pages.join("\n\n"), displayPath, "PDF");
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  } finally {
    if (pdfDocument) await pdfDocument.destroy();
  }
}

function silencePdfWarnings(pdfjs) {
  // pdf.js emits warnings (fake-worker setup, missing standard fonts for glyphs
  // that aren't actually used, malformed TrueType tables in valid-enough PDFs)
  // via console.warn → stderr. Claude Desktop's MCP host surfaces every stderr
  // line as a popup, so warnings that don't affect extraction become user-
  // visible noise. ERRORS-only verbosity silences warnings without hiding real
  // failures, which still throw and bubble up through the try/catch above.
  if (typeof pdfjs.setVerbosityLevel === "function") {
    const ERRORS = pdfjs.VerbosityLevel?.ERRORS ?? 0;
    pdfjs.setVerbosityLevel(ERRORS);
  }
}

function configurePdfWorker(pdfjs) {
  // pdfjs-dist's default workerSrc changed across 4.x releases. In the
  // Desktop Extension bundle, a fresh npm install could pull a version whose
  // default is empty, which makes even `disableWorker: true` fail while setting
  // up pdf.js's fake worker. Point it at the bundled worker explicitly so
  // local npm installs and .mcpb installs behave the same.
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
}

async function extractDocxText(buffer, displayPath) {
  const mammoth = require("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer });
    return ensureReadableText(result.value || "", displayPath, "DOCX");
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

async function extractXlsxText(buffer, displayPath) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zipText(zip, "xl/workbook.xml");
    const relsXml = await zipText(zip, "xl/_rels/workbook.xml.rels");
    const sharedStrings = await readSharedStrings(zip);
    const rels = parseRelationships(relsXml);
    const sheets = parseWorkbookSheets(workbookXml, rels);
    const sections = [];

    for (const sheet of sheets) {
      const sheetXml = await zipText(zip, sheet.path).catch(() => "");
      if (!sheetXml) continue;
      const rows = parseWorksheetRows(sheetXml, sharedStrings);
      if (!rows.length) continue;
      sections.push(`## Sheet: ${sheet.name}\n\n${rows.map((row) => row.join("\t")).join("\n")}`);
    }

    return ensureReadableText(
      [`# Spreadsheet: ${path.basename(displayPath)}`, ...sections].join("\n\n"),
      displayPath,
      "spreadsheet"
    );
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

async function extractPptxText(buffer, displayPath) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort(naturalCompare);
    const notesFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
      .sort(naturalCompare);
    const sections = [];

    for (const file of slideFiles) {
      const text = xmlTextTags(await zipText(zip, file), "t").join(" ").trim();
      if (text) sections.push(`## ${labelFromPath(file)}\n\n${text}`);
    }
    for (const file of notesFiles) {
      const text = xmlTextTags(await zipText(zip, file), "t").join(" ").trim();
      if (text) sections.push(`## Notes: ${labelFromPath(file)}\n\n${text}`);
    }

    return ensureReadableText(
      [`# Presentation: ${path.basename(displayPath)}`, ...sections].join("\n\n"),
      displayPath,
      "PPTX"
    );
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

async function extractOdsText(buffer, displayPath) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentXml = await zipText(zip, "content.xml");
    const sheets = [];
    for (const match of contentXml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/gi)) {
      const name = xmlAttribute(match[1], "table:name") || `Sheet ${sheets.length + 1}`;
      const rows = [];
      for (const rowMatch of match[2].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi)) {
        const cells = [];
        for (const cellMatch of rowMatch[1].matchAll(/<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>/gi)) {
          const repeat = Math.min(20, Number(xmlAttribute(cellMatch[1], "table:number-columns-repeated") || 1));
          const cellText = odfXmlToText(cellMatch[2]).replace(/\s+/g, " ").trim();
          for (let i = 0; i < repeat; i++) cells.push(cellText);
        }
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) sheets.push(`## Sheet: ${decodeXmlEntities(name)}\n\n${rows.map((row) => row.join("\t")).join("\n")}`);
    }

    return ensureReadableText(
      [`# Spreadsheet: ${path.basename(displayPath)}`, ...sheets].join("\n\n"),
      displayPath,
      "ODS"
    );
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

async function extractOpenDocumentText(buffer, displayPath, kind) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentXml = await zipText(zip, "content.xml");
    return ensureReadableText(odfXmlToText(contentXml), displayPath, kind);
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

async function extractEpubText(buffer, displayPath) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentFiles = Object.keys(zip.files)
      .filter((name) => /\.(xhtml|html|htm)$/i.test(name))
      .filter((name) => !/(^|\/)(nav|toc)\.(xhtml|html|htm)$/i.test(name))
      .sort(naturalCompare);
    const sections = [];
    for (const file of contentFiles) {
      const text = htmlToText(await zipText(zip, file)).trim();
      if (text) sections.push(`## ${file}\n\n${text}`);
    }
    return ensureReadableText(
      [`# EPUB: ${path.basename(displayPath)}`, ...sections].join("\n\n"),
      displayPath,
      "EPUB"
    );
  } catch (error) {
    throw new Error(`could not extract text from ${displayPath}: ${error.message}`);
  }
}

function extractEmailText(raw, displayPath, options = {}) {
  const message = parseMimeSection(raw);
  const headers = message.headers;
  const subject = decodeMimeWords(headers.get("subject") || "");
  const from = decodeMimeWords(headers.get("from") || "");
  const date = decodeMimeWords(headers.get("date") || "");
  const body = extractMimeBody(message.headers, message.body);
  const parts = [];
  if (subject) parts.push(`Subject: ${subject}`);
  if (from) parts.push(`From: ${from}`);
  if (date) parts.push(`Date: ${date}`);
  if (body) parts.push(body);
  return ensureReadableText(parts.join("\n\n"), displayPath, "email", options);
}

function ensureReadableText(text, displayPath, kind, options = {}) {
  const cleaned = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!cleaned && options.allowEmpty) return cleaned;
  if (!cleaned) {
    throw new Error(
      `could not extract readable text from ${displayPath}. ` +
        `${kind} appears empty, scanned, image-only, encrypted, or otherwise unreadable. ` +
        "Run OCR or export it to a text-based PDF/DOCX, then try again."
    );
  }
  return cleaned;
}

async function readSharedStrings(zip) {
  let xml;
  try {
    xml = await zipText(zip, "xl/sharedStrings.xml");
  } catch {
    return [];
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map((match) => xmlTextTags(match[1], "t").join(""));
}

function parseRelationships(xml) {
  const rels = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = xmlAttribute(match[1], "Id");
    const target = xmlAttribute(match[1], "Target");
    if (!id || !target) continue;
    rels.set(id, normalizeZipPath(target.startsWith("/") ? target.slice(1) : `xl/${target}`));
  }
  return rels;
}

function parseWorkbookSheets(xml, rels) {
  const sheets = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const name = decodeXmlEntities(xmlAttribute(attrs, "name") || `Sheet ${sheets.length + 1}`);
    const relId = xmlAttribute(attrs, "r:id");
    const sheetPath = rels.get(relId);
    if (sheetPath) sheets.push({ name, path: sheetPath });
  }
  return sheets;
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      row.push(extractCellValue(cellMatch[1], cellMatch[2], sharedStrings));
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function extractCellValue(attrs, cellXml, sharedStrings) {
  const type = xmlAttribute(attrs, "t");
  if (type === "s") {
    const index = Number(xmlTagValue(cellXml, "v"));
    return Number.isInteger(index) ? (sharedStrings[index] || "") : "";
  }
  if (type === "inlineStr") {
    return xmlTextTags(cellXml, "t").join("");
  }
  if (type === "str") return decodeXmlEntities(xmlTagValue(cellXml, "v") || "");
  return decodeXmlEntities(xmlTagValue(cellXml, "v") || xmlTagValue(cellXml, "f") || "");
}

function parseMimeSection(raw) {
  const normalized = String(raw || "").replace(/\r\n?/g, "\n");
  const splitAt = normalized.search(/\n\n/);
  const headerText = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const body = splitAt >= 0 ? normalized.slice(splitAt + 2) : "";
  return { headers: parseHeaders(headerText), body };
}

function parseHeaders(headerText) {
  const unfolded = String(headerText || "").replace(/\n[ \t]+/g, " ");
  const headers = new Map();
  for (const line of unfolded.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
}

function extractMimeBody(headers, body) {
  const contentType = headers.get("content-type") || "text/plain";
  const boundary = boundaryFromContentType(contentType);
  if (/multipart\//i.test(contentType) && boundary) {
    const parts = body.split(new RegExp(`(?:^|\\n)--${escapeRegExp(boundary)}(?:--)?[ \\t]*(?:\\n|$)`, "g"));
    const textParts = [];
    const htmlParts = [];
    for (const part of parts) {
      const parsed = parseMimeSection(part);
      const partType = parsed.headers.get("content-type") || "";
      const extracted = extractMimeBody(parsed.headers, parsed.body);
      if (!extracted) continue;
      if (/text\/html/i.test(partType)) htmlParts.push(extracted);
      else if (/text\/plain/i.test(partType) || !partType) textParts.push(extracted);
    }
    return (textParts.length ? textParts : htmlParts).join("\n\n").trim();
  }

  const decoded = decodeTransferBody(body, headers.get("content-transfer-encoding") || "");
  return /text\/html/i.test(contentType) ? htmlToText(decoded).trim() : decoded.trim();
}

function boundaryFromContentType(contentType) {
  const quoted = contentType.match(/\bboundary="([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = contentType.match(/\bboundary=([^;\s]+)/i);
  return bare ? bare[1] : "";
}

function decodeTransferBody(body, encoding) {
  if (/base64/i.test(encoding)) {
    try {
      return Buffer.from(String(body || "").replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (/quoted-printable/i.test(encoding)) return decodeQuotedPrintable(body);
  return body;
}

function decodeQuotedPrintable(text) {
  return String(text || "")
    .replace(/=\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeMimeWords(text) {
  return String(text || "").replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_, charset, enc, value) => {
    const normalized = enc.toLowerCase() === "b"
      ? Buffer.from(value, "base64").toString("utf8")
      : decodeQuotedPrintable(value.replace(/_/g, " "));
    return /^utf-?8$/i.test(charset) || /^us-ascii$/i.test(charset)
      ? normalized
      : Buffer.from(normalized, "binary").toString("utf8");
  });
}

async function zipText(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`missing ${name}`);
  return file.async("string");
}

function xmlTextTags(xml, localName) {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, "gi");
  return [...String(xml || "").matchAll(pattern)]
    .map((match) => decodeXmlEntities(stripXmlTags(match[1])))
    .filter(Boolean);
}

function xmlTagValue(xml, localName) {
  const values = xmlTextTags(xml, localName);
  return values.length ? values[0] : "";
}

function xmlAttribute(attrs, name) {
  const escaped = escapeRegExp(name);
  const match = String(attrs || "").match(new RegExp(`\\b${escaped}=(["'])(.*?)\\1`, "i"));
  return match ? decodeXmlEntities(match[2]) : "";
}

function odfXmlToText(xml) {
  return decodeXmlEntities(
    String(xml || "")
      .replace(/<office:automatic-styles\b[^>]*>[\s\S]*?<\/office:automatic-styles>/gi, " ")
      .replace(/<text:s\b[^>]*text:c=(["'])(\d+)\1[^>]*\/>/gi, (_, __, count) => " ".repeat(Math.min(20, Number(count))))
      .replace(/<text:s\b[^>]*\/>/gi, " ")
      .replace(/<text:tab\b[^>]*\/>/gi, "\t")
      .replace(/<text:line-break\b[^>]*\/>/gi, "\n")
      .replace(/<\/(?:text:p|text:h|table:table-row|draw:page)>/gi, "\n")
      .replace(/<\/table:table-cell>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

function stripXmlTags(xml) {
  return String(xml || "").replace(/<[^>]+>/g, "");
}

function decodeXmlEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\""
    }[lower] || match;
  });
}

function labelFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/([a-z])(\d)/i, "$1 $2");
}

function normalizeZipPath(filePath) {
  const parts = [];
  for (const part of filePath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
  );
}

function rtfToText(rtf) {
  return rtf
    .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(parseInt(match.slice(2), 16)))
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\\[{}\\]/g, (match) => match.slice(1))
    .replace(/[{}]/g, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/\\\*/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n");
}

function decodeHtmlEntities(text) {
  return decodeXmlEntities(text);
}

function pdfStandardFontDataPath() {
  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const fontPath = path.join(packageRoot, "standard_fonts");
  return fontPath.endsWith(path.sep) ? fontPath : `${fontPath}${path.sep}`;
}
