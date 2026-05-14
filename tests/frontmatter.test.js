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

test("returns null on malformed YAML", () => {
  // tab-indent inside YAML is an error in strict mode; js-yaml may tolerate.
  // A deliberately-broken case: unclosed flow sequence.
  assert.equal(parseFrontmatter("---\nraw_files: [foo, bar\n---\n"), null);
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
