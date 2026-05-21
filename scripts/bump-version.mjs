#!/usr/bin/env node
// Sync version from package.json into mcpb/manifest.json and server.json.
// Called by the `version` npm lifecycle after `npm version <x>` bumps package.json.
// Uses regex replacement to preserve whitespace/formatting in target files.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function replaceVersion(relPath, occurrences) {
  const path = join(root, relPath);
  const raw = readFileSync(path, "utf8");
  const re = /"version":\s*"[^"]+"/g;
  const matches = raw.match(re) || [];
  if (matches.length !== occurrences) {
    throw new Error(`${relPath}: expected ${occurrences} "version" matches, found ${matches.length}`);
  }
  const next = raw.replace(re, `"version": "${version}"`);
  writeFileSync(path, next);
  console.log(`bumped ${relPath} -> ${version} (${occurrences} occurrence${occurrences === 1 ? "" : "s"})`);
}

replaceVersion("mcpb/manifest.json", 1);
replaceVersion("server.json", 2);
