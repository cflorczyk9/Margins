import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { readVaultManual } from "../src/vault-manual.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-manual-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("returns null when no manual file exists", async () => {
  assert.equal(await readVaultManual(vault), null);
});

test("finds CLAUDE.md when present", async () => {
  await writeFile(path.join(tmpRoot, "CLAUDE.md"), "# Vault rules\nbe terse", "utf8");
  const m = await readVaultManual(vault);
  assert.equal(m.name, "CLAUDE.md");
  assert.match(m.body, /Vault rules/);
});

test("falls back to OPERATING.md if neither CLAUDE.md nor claude.md exist", async () => {
  await writeFile(path.join(tmpRoot, "OPERATING.md"), "# Operating", "utf8");
  const m = await readVaultManual(vault);
  assert.equal(m.name, "OPERATING.md");
});

test("CLAUDE.md wins over OPERATING.md when both exist", async () => {
  await writeFile(path.join(tmpRoot, "CLAUDE.md"), "claude", "utf8");
  await writeFile(path.join(tmpRoot, "OPERATING.md"), "operating", "utf8");
  const m = await readVaultManual(vault);
  assert.equal(m.name, "CLAUDE.md");
});
