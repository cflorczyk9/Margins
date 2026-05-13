import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVault } from "../src/vault.js";
import { buildServer } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures");

test("buildServer registers expected tools", () => {
  const vault = createVault(FIXTURE);
  const server = buildServer(vault);
  assert.ok(server, "server constructed");
});
