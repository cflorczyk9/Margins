import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readJsonSafe, writeMcpEntry } from "../src/install/config-writer.js";
import { scaffoldStarterVault } from "../src/install/starter-vault.js";
import { detectHosts } from "../src/install/hosts.js";
import { probeServer } from "../src/install/probe.js";
import { detectInstallLocation, ensureVaultDirs } from "../src/install/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(__dirname, "../bin/margins-mcp.js");

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-install-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("readJsonSafe returns null for missing files", async () => {
  const result = await readJsonSafe(path.join(tmpRoot, "absent.json"));
  assert.equal(result, null);
});

test("readJsonSafe throws on invalid JSON", async () => {
  const p = path.join(tmpRoot, "bad.json");
  await writeFile(p, "{ not json }", "utf8");
  await assert.rejects(() => readJsonSafe(p), /not valid JSON/);
});

test("writeMcpEntry creates a fresh config with just margins", async () => {
  const configPath = path.join(tmpRoot, "Library/Claude/config.json");
  const result = await writeMcpEntry({
    configPath,
    serverName: "margins",
    command: "node",
    args: ["/path/to/bin"],
    env: { MARGINS_VAULT: "/path/to/vault" }
  });
  assert.equal(result.replacedExisting, false);
  assert.equal(result.peerCount, 0);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(config.mcpServers), ["margins"]);
  assert.equal(config.mcpServers.margins.env.MARGINS_VAULT, "/path/to/vault");
});

test("writeMcpEntry merges with existing config preserving other servers", async () => {
  const configPath = path.join(tmpRoot, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      preferences: { theme: "dark" },
      mcpServers: {
        other: { command: "node", args: ["/other"] }
      }
    }),
    "utf8"
  );
  const result = await writeMcpEntry({
    configPath,
    serverName: "margins",
    command: "node",
    args: ["/margins/bin"]
  });
  assert.equal(result.peerCount, 1);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.preferences.theme, "dark");
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ["margins", "other"]);
});

test("writeMcpEntry replacing existing margins entry reports it", async () => {
  const configPath = path.join(tmpRoot, "config.json");
  await writeMcpEntry({
    configPath,
    serverName: "margins",
    command: "node",
    args: ["/old"]
  });
  const second = await writeMcpEntry({
    configPath,
    serverName: "margins",
    command: "node",
    args: ["/new"]
  });
  assert.equal(second.replacedExisting, true);
  assert.equal(second.peerCount, 0);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.margins.args, ["/new"]);
});

test("scaffoldStarterVault populates expected folders + files", async () => {
  const target = path.join(tmpRoot, "fresh-vault");
  const result = await scaffoldStarterVault(target);
  assert.ok(await exists(path.join(target, "CLAUDE.md")));
  assert.ok(await exists(path.join(target, "operator-manual.md")));
  assert.ok(await exists(path.join(target, "wiki/index.md")));
  assert.ok(await exists(path.join(target, "wiki/daily")));
  assert.ok(await exists(path.join(target, "raw")));
  assert.ok(result.files.includes("CLAUDE.md"));
});

test("scaffoldStarterVault refuses non-empty directory without force", async () => {
  const target = path.join(tmpRoot, "occupied");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "existing.md"), "x", "utf8");
  await assert.rejects(() => scaffoldStarterVault(target), /not empty/);
});

test("scaffoldStarterVault with force overwrites existing", async () => {
  const target = path.join(tmpRoot, "occupied");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "existing.md"), "x", "utf8");
  await scaffoldStarterVault(target, { force: true });
  assert.ok(await exists(path.join(target, "CLAUDE.md")));
});

test("detectHosts returns an entry for each known host", async () => {
  const hosts = await detectHosts();
  const ids = hosts.map((h) => h.id).sort();
  assert.deepEqual(ids, ["claude-code", "claude-desktop"]);
  for (const h of hosts) {
    assert.ok(["present", "config-missing", "host-missing", "unsupported-platform"].includes(h.status));
  }
});

test("ensureVaultDirs creates raw/, proposed/, .margins/ in a fresh vault", async () => {
  const result = await ensureVaultDirs(tmpRoot);
  assert.deepEqual(result.created.sort(), [".margins", "proposed", "raw"]);
  assert.ok(await exists(path.join(tmpRoot, "raw")));
  assert.ok(await exists(path.join(tmpRoot, "proposed")));
  assert.ok(await exists(path.join(tmpRoot, ".margins")));
});

test("ensureVaultDirs is idempotent (no-op when dirs already exist)", async () => {
  await ensureVaultDirs(tmpRoot);
  const second = await ensureVaultDirs(tmpRoot);
  assert.deepEqual(second.created, []);
});

test("detectInstallLocation flags npx-cache paths as fragile", () => {
  assert.equal(
    detectInstallLocation("/Users/foo/.npm/_npx/abc123/node_modules/margins-mcp/bin/margins-mcp.js"),
    "npx-cache"
  );
  assert.equal(
    detectInstallLocation("/usr/local/lib/node_modules/margins-mcp/bin/margins-mcp.js"),
    "stable"
  );
  assert.equal(
    detectInstallLocation("/opt/homebrew/lib/node_modules/margins-mcp/bin/margins-mcp.js"),
    "stable"
  );
});

test("probeServer starts margins-mcp and lists expected tools", async () => {
  const fixtureVault = path.join(__dirname, "fixtures");
  const result = await probeServer({ serverBin: SERVER_BIN, vaultPath: fixtureVault });
  assert.equal(result.initialized, true);
  assert.ok(result.tools.length >= 12);
  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes("margins_start"));
  assert.ok(names.includes("propose_compile_from_raw"));
  assert.ok(names.includes("propose_page"));
  assert.ok(names.includes("list_pending_raw"));
});
