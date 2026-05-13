import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { checkForUpdate, isNewer, detectInstallChannel } from "../src/version-check.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-vc-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("isNewer correctly compares semver", () => {
  assert.equal(isNewer("0.9.0", "0.8.1"), true);
  assert.equal(isNewer("0.8.2", "0.8.1"), true);
  assert.equal(isNewer("0.8.1", "0.8.1"), false);
  assert.equal(isNewer("0.8.0", "0.8.1"), false);
  assert.equal(isNewer("1.0.0", "0.9.99"), true);
  assert.equal(isNewer("0.9.10", "0.9.2"), true);
});

test("isNewer handles malformed versions safely", () => {
  assert.equal(isNewer("abc", "0.8.1"), false);
  assert.equal(isNewer("0.8.1", "abc"), false);
  assert.equal(isNewer("", ""), false);
});

test("checkForUpdate returns null when no newer version exists", async () => {
  const result = await checkForUpdate(vault, {
    installedVersion: "9.9.9",
    installVia: "npm",
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: "9.9.9" })
    })
  });
  assert.equal(result, null);
});

test("checkForUpdate returns hint when latest is newer", async () => {
  const result = await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: "0.9.0" })
    })
  });
  assert.ok(result);
  assert.equal(result.current, "0.8.1");
  assert.equal(result.latest, "0.9.0");
  assert.match(result.hint, /margins-mcp install --update/);
});

test("checkForUpdate hint shape differs for mcpb install", async () => {
  const result = await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "mcpb",
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: "0.9.0" })
    })
  });
  assert.match(result.hint, /margins\.app/);
  assert.match(result.hint, /\.mcpb/);
});

test("checkForUpdate writes a 24h cache file", async () => {
  await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: "0.9.0" })
    })
  });
  const cache = JSON.parse(await readFile(path.join(tmpRoot, ".margins/version-check.json"), "utf8"));
  assert.equal(cache.latest, "0.9.0");
  assert.ok(typeof cache.checkedAtMs === "number");
  assert.ok(Date.now() - cache.checkedAtMs < 5000);
});

test("checkForUpdate uses cached value within TTL (no fetch call)", async () => {
  // First call populates the cache
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ version: "0.9.0" }) };
  };
  await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: fakeFetch
  });
  assert.equal(fetchCount, 1);
  // Second call within 24h should reuse cache, no fetch
  await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: fakeFetch
  });
  assert.equal(fetchCount, 1);
});

test("checkForUpdate returns null silently on fetch error", async () => {
  const result = await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: async () => {
      throw new Error("network down");
    }
  });
  assert.equal(result, null);
});

test("checkForUpdate returns null on non-ok HTTP response", async () => {
  const result = await checkForUpdate(vault, {
    installedVersion: "0.8.1",
    installVia: "npm",
    fetch: async () => ({ ok: false, json: async () => ({}) })
  });
  assert.equal(result, null);
});

test("detectInstallChannel identifies mcpb paths", () => {
  assert.equal(
    detectInstallChannel("/Users/foo/Library/Application Support/Claude/extensions/margins/server.js"),
    "mcpb"
  );
  assert.equal(detectInstallChannel("/tmp/margins-bundle.mcpb/server.js"), "mcpb");
});

test("detectInstallChannel defaults to npm for normal paths", () => {
  assert.equal(detectInstallChannel("/opt/homebrew/lib/node_modules/margins-mcp/bin"), "npm");
  assert.equal(detectInstallChannel("/usr/local/lib/node_modules/margins-mcp/bin"), "npm");
});
