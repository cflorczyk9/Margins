#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relPath) {
  return JSON.parse(readFileSync(join(root, relPath), "utf8"));
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const manifest = readJson("mcpb/manifest.json");
const server = readJson("server.json");

const expectedMcpName = "io.github.cflorczyk9/margins";
const failures = [];

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, found ${actual}`);
  }
}

assertEqual("package mcpName", pkg.mcpName, expectedMcpName);
assertEqual("server name", server.name, expectedMcpName);
assertEqual("package-lock root version", lock.version, pkg.version);
assertEqual("package-lock package version", lock.packages?.[""]?.version, pkg.version);
assertEqual("mcpb manifest version", manifest.version, pkg.version);
assertEqual("server version", server.version, pkg.version);
assertEqual("server package version", server.packages?.[0]?.version, pkg.version);
assertEqual("server package identifier", server.packages?.[0]?.identifier, pkg.name);

if (failures.length) {
  console.error("Release metadata is out of sync:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release metadata in sync for ${pkg.name}@${pkg.version} (${pkg.mcpName})`);
