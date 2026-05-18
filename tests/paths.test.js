import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, pathsEqual, pathPriority, globMatch } from "../src/paths.js";

test("canonicalize strips leading ./", () => {
  assert.equal(canonicalize("./raw/foo.md"), "raw/foo.md");
});

test("canonicalize converts backslashes to forward slashes", () => {
  assert.equal(canonicalize("raw\\foo.md"), "raw/foo.md");
});

test("canonicalize collapses repeated slashes", () => {
  assert.equal(canonicalize("raw//foo.md"), "raw/foo.md");
});

test("canonicalize strips trailing slash", () => {
  assert.equal(canonicalize("raw/foo/"), "raw/foo");
});

test("canonicalize normalizes Unicode to NFC", () => {
  // "café" — NFD has 5 codepoints (e + combining acute), NFC has 4
  const nfd = "café.md";
  const nfc = "café.md";
  assert.notEqual(nfd, nfc, "fixture must actually differ");
  assert.equal(canonicalize(nfd), nfc);
  assert.equal(canonicalize(nfc), nfc);
});

test("pathsEqual matches across encoding differences", () => {
  assert.ok(pathsEqual("./raw/café.pdf", "raw/café.pdf"));
  assert.ok(pathsEqual("raw\\foo.md", "raw/foo.md"));
});

test("canonicalize handles null and empty", () => {
  assert.equal(canonicalize(null), "");
  assert.equal(canonicalize(""), "");
  assert.equal(canonicalize(undefined), "");
});

test("pathPriority ranks wiki/ above raw/ above project source", () => {
  assert.ok(pathPriority("wiki/career/career.md") > pathPriority("raw/foo.pdf"));
  assert.ok(pathPriority("raw/foo.pdf") > pathPriority("gstack/SKILL.md"));
  assert.ok(pathPriority("wiki/career/career.md") > pathPriority("margins/src/server.js"));
});

test("pathPriority drops test fixtures to zero", () => {
  assert.equal(pathPriority("margins/tests/fixtures/wiki/briefly.md"), 0);
  assert.equal(pathPriority("gstack/browse/test/fixtures/foo.json"), 0);
  assert.equal(pathPriority("anywhere/spec/fixtures/foo.md"), 0);
});

test("pathPriority demotes templates below real wiki pages", () => {
  assert.ok(pathPriority("wiki/daily/daily.md") > pathPriority("wiki/_templates/daily.md"));
});

// --- globMatch ---

test("globMatch '*' matches within a segment, not across slashes", () => {
  assert.equal(globMatch("wiki/sources/*.md", "wiki/sources/foo.md"), true);
  assert.equal(globMatch("wiki/sources/*.md", "wiki/sources/sub/foo.md"), false);
});

test("globMatch '**' matches across slashes", () => {
  assert.equal(globMatch("wiki/**", "wiki/sources/foo.md"), true);
  assert.equal(globMatch("wiki/**", "wiki/sources/sub/foo.md"), true);
});

test("globMatch '?' matches one char, not slash", () => {
  assert.equal(globMatch("wiki/a?.md", "wiki/ab.md"), true);
  assert.equal(globMatch("wiki/a?.md", "wiki/abc.md"), false);
});

test("globMatch split-mode pattern catches both hub and segments", () => {
  // Regression check: the formatSplitResponse pattern
  // 'wiki/<bucket>/*<baseSlug>*' must match both the hub
  // (<baseSlug>-hub.md) and the segment proposals
  // (source-<baseSlug>-s01-*.md). Without this, bulk accept leaves the
  // hub pending and the split's navigation block lands incomplete.
  assert.equal(globMatch("wiki/sources/*deals*", "wiki/sources/deals-hub.md"), true);
  assert.equal(globMatch("wiki/sources/*deals*", "wiki/sources/source-deals-s01-aurora.md"), true);
  assert.equal(globMatch("wiki/sources/*deals*", "wiki/sources/unrelated.md"), false);
});
