import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, pathsEqual, pathPriority } from "../src/paths.js";

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
