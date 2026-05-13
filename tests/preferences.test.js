import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { createPreferences } from "../src/preferences.js";

let tmpRoot;
let vault;
let prefs;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-prefs-"));
  vault = createVault(tmpRoot);
  prefs = createPreferences(vault);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("read returns empty string when file doesn't exist", async () => {
  assert.equal(await prefs.read(), "");
  assert.equal(await prefs.exists(), false);
});

test("append creates the file with header on first call", async () => {
  await prefs.append("Mark Loh meeting notes file under wiki/projects/ not wiki/personal/.");
  assert.equal(await prefs.exists(), true);
  const body = await prefs.read();
  assert.match(body, /# Vault preferences/);
  assert.match(body, /Mark Loh meeting notes/);
});

test("append on same day adds to existing dated section", async () => {
  await prefs.append("first preference");
  await prefs.append("second preference");
  const body = await prefs.read();
  const todayHeading = `## ${new Date().toISOString().slice(0, 10)}`;
  const sections = body.split(/^## /m);
  // header + one dated section
  assert.ok(sections.length === 2);
  assert.match(body, /- first preference/);
  assert.match(body, /- second preference/);
  // Only one dated heading
  assert.equal((body.match(/^## /gm) || []).length, 1);
});

test("category tag is appended to bullet", async () => {
  await prefs.append("use [[bob-casey]] not 'Bob Casey'", { category: "naming" });
  const body = await prefs.read();
  assert.match(body, /bob-casey.*\(naming\)/);
});

test("recent returns bullets newest-first", async () => {
  await prefs.append("rule one");
  await prefs.append("rule two");
  const recent = await prefs.recent(5);
  assert.equal(recent.length, 2);
  assert.match(recent[0].text, /rule (one|two)/);
});

test("recent honors limit", async () => {
  for (let i = 0; i < 8; i++) await prefs.append(`rule ${i}`);
  const recent = await prefs.recent(3);
  assert.equal(recent.length, 3);
});

test("empty observation rejected", async () => {
  await assert.rejects(() => prefs.append(""), /required/);
  await assert.rejects(() => prefs.append("   "), /required/);
});
