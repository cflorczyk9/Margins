import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, extractRawFileRefs, getType } from "../src/frontmatter.js";

test("parses basic frontmatter", () => {
  const result = parseFrontmatter(`---\ntype: source\nraw_file: raw/foo.md\n---\n# Body\n`);
  assert.equal(result.data.type, "source");
  assert.equal(result.data.raw_file, "raw/foo.md");
  assert.equal(result.body, "# Body\n");
});

test("strips UTF-8 BOM before parsing", () => {
  const bom = "﻿---\ntype: source\nraw_file: raw/foo.md\n---\nbody\n";
  const result = parseFrontmatter(bom);
  assert.ok(result);
  assert.equal(result.data.type, "source");
  assert.equal(result.data.raw_file, "raw/foo.md");
});

test("normalizes CRLF line endings", () => {
  const crlf = "---\r\ntype: source\r\nraw_file: raw/foo.md\r\n---\r\nbody\r\n";
  const result = parseFrontmatter(crlf);
  assert.ok(result);
  assert.equal(result.data.type, "source");
  assert.equal(result.data.raw_file, "raw/foo.md");
});

test("handles single-quoted YAML strings", () => {
  const result = parseFrontmatter(`---\ntype: 'source'\nraw_file: 'raw/foo.md'\n---\n`);
  assert.equal(result.data.type, "source");
  assert.equal(result.data.raw_file, "raw/foo.md");
});

test("handles double-quoted YAML strings", () => {
  const result = parseFrontmatter(`---\ntype: "source"\nraw_file: "raw/foo.md"\n---\n`);
  assert.equal(result.data.type, "source");
  assert.equal(result.data.raw_file, "raw/foo.md");
});

test("ignores YAML comments", () => {
  const result = parseFrontmatter(`---\n# this is a comment\ntype: source\n# another comment\nraw_file: raw/foo.md\n---\n`);
  assert.equal(result.data.type, "source");
});

test("parses raw_files as a YAML list", () => {
  const result = parseFrontmatter(`---\ntype: synthesis\nraw_files:\n  - raw/a.pdf\n  - raw/b.pdf\n---\n`);
  assert.deepEqual(result.data.raw_files, ["raw/a.pdf", "raw/b.pdf"]);
});

test("returns null when no frontmatter present", () => {
  assert.equal(parseFrontmatter("# Just a body, no frontmatter"), null);
});

test("returns null when frontmatter is unterminated", () => {
  assert.equal(parseFrontmatter("---\ntype: source\nno closing dashes"), null);
});

test("throws on malformed YAML that the permissive fallback can't recover", () => {
  // Unclosed flow sequence — neither strict YAML nor permissive extract
  // can find type/raw_file/raw_files/source. Should throw so the doctor
  // surfaces it as a parse failure (silent skip was a v0.12.1 bug).
  assert.throws(() => parseFrontmatter("---\nraw_files: [foo, bar\n---\n"));
});

test("permissive fallback recovers raw_file when summary breaks strict YAML", () => {
  // Common real-world bug: unquoted summary with 'colon space' makes
  // js-yaml fail. Margins should still see the raw_file and not silently
  // drop the page.
  const body = `---\ntype: source\nsummary: Key terms: this colon would break strict yaml\nraw_file: raw/foo.md\n---\nbody\n`;
  const r = parseFrontmatter(body);
  assert.ok(r, "should recover via permissive fallback");
  assert.equal(r.data.type, "source");
  assert.equal(r.data.raw_file, "raw/foo.md");
  assert.equal(r.recovered, true);
});

test("extractRawFileRefs pulls from singular, plural, and legacy 'source' keys", () => {
  assert.deepEqual(extractRawFileRefs({ raw_file: "raw/a.md" }), ["raw/a.md"]);
  assert.deepEqual(extractRawFileRefs({ raw_files: ["raw/b.md", "raw/c.md"] }), ["raw/b.md", "raw/c.md"]);
  assert.deepEqual(extractRawFileRefs({ source: "raw/d.md" }), ["raw/d.md"]);
  assert.deepEqual(
    extractRawFileRefs({ raw_file: "raw/a.md", raw_files: ["raw/b.md"], source: "raw/c.md" }),
    ["raw/a.md", "raw/b.md", "raw/c.md"]
  );
});

test("extractRawFileRefs returns empty when no refs", () => {
  assert.deepEqual(extractRawFileRefs({ type: "concept" }), []);
  assert.deepEqual(extractRawFileRefs(null), []);
});

test("getType returns trimmed string or null", () => {
  assert.equal(getType({ type: "source" }), "source");
  assert.equal(getType({ type: " synthesis " }), "synthesis");
  assert.equal(getType({}), null);
  assert.equal(getType(null), null);
});
