import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectObsidianVaults, obsidianRegistryPath } from "../src/install/obsidian-vaults.js";

let tmpHome;
let savedHomedir;
let realVault;

beforeEach(async () => {
  tmpHome = await mkdtemp(path.join(os.tmpdir(), "margins-obs-"));
  realVault = await mkdtemp(path.join(os.tmpdir(), "margins-realvault-"));
  savedHomedir = os.homedir;
  os.homedir = () => tmpHome;
});

afterEach(async () => {
  os.homedir = savedHomedir;
  await rm(tmpHome, { recursive: true, force: true });
  await rm(realVault, { recursive: true, force: true });
});

async function writeRegistry(content) {
  let regPath;
  switch (process.platform) {
    case "darwin":
      regPath = path.join(tmpHome, "Library/Application Support/obsidian/obsidian.json");
      break;
    case "linux":
      regPath = path.join(tmpHome, ".config/obsidian/obsidian.json");
      break;
    case "win32":
      regPath = path.join(tmpHome, "AppData/Roaming/obsidian/obsidian.json");
      break;
    default:
      regPath = path.join(tmpHome, "obsidian.json");
  }
  await mkdir(path.dirname(regPath), { recursive: true });
  await writeFile(regPath, content, "utf8");
  return regPath;
}

test("returns empty list when registry file does not exist", async () => {
  const result = await detectObsidianVaults();
  assert.equal(result.registryFound, false);
  assert.deepEqual(result.vaults, []);
});

test("parses single-vault registry and returns it", async () => {
  await writeRegistry(JSON.stringify({
    vaults: {
      abc123: { path: realVault, ts: 1700000000000, open: true }
    }
  }));
  const result = await detectObsidianVaults();
  assert.equal(result.registryFound, true);
  assert.equal(result.vaults.length, 1);
  assert.equal(result.vaults[0].path, realVault);
  assert.equal(result.vaults[0].isOpen, true);
});

test("filters out vaults whose paths no longer exist on disk", async () => {
  const stalePath = path.join(tmpHome, "deleted-vault");
  await writeRegistry(JSON.stringify({
    vaults: {
      alive: { path: realVault, ts: 1700000000000 },
      stale: { path: stalePath, ts: 1700000001000 }
    }
  }));
  const result = await detectObsidianVaults();
  assert.equal(result.vaults.length, 1);
  assert.equal(result.vaults[0].path, realVault);
});

test("sorts by most recently used; open vault wins ties", async () => {
  const second = await mkdtemp(path.join(os.tmpdir(), "margins-v2-"));
  const third = await mkdtemp(path.join(os.tmpdir(), "margins-v3-"));
  try {
    await writeRegistry(JSON.stringify({
      vaults: {
        a: { path: realVault, ts: 1700000000000, open: false },
        b: { path: second, ts: 1700000005000, open: true },
        c: { path: third, ts: 1700000003000, open: false }
      }
    }));
    const result = await detectObsidianVaults();
    // open vault first, then ts-desc
    assert.equal(result.vaults[0].path, second);
    assert.equal(result.vaults[1].path, third);
    assert.equal(result.vaults[2].path, realVault);
  } finally {
    await rm(second, { recursive: true, force: true });
    await rm(third, { recursive: true, force: true });
  }
});

test("malformed JSON does not crash", async () => {
  await writeRegistry("{ not json at all");
  const result = await detectObsidianVaults();
  assert.equal(result.registryFound, true);
  assert.equal(result.parseError, true);
  assert.deepEqual(result.vaults, []);
});

test("registry without vaults field returns empty list", async () => {
  await writeRegistry(JSON.stringify({ otherStuff: 1 }));
  const result = await detectObsidianVaults();
  assert.equal(result.registryFound, true);
  assert.deepEqual(result.vaults, []);
});

test("obsidianRegistryPath returns platform-appropriate path", () => {
  const p = obsidianRegistryPath();
  if (process.platform === "darwin") {
    assert.match(p, /Library\/Application Support\/obsidian\/obsidian\.json$/);
  } else if (process.platform === "linux") {
    assert.match(p, /\.config\/obsidian\/obsidian\.json$/);
  } else if (process.platform === "win32") {
    assert.match(p, /obsidian\/obsidian\.json$/);
  }
});
