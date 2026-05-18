import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(__dirname, "../bin/margins-mcp.js");

class StdioMcpClient {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this.nextId = 1;
    this.pending = new Map();
    this.stdout = "";
    this.stderr = "";
    this.closed = false;
  }

  async start() {
    this.child = spawn("node", [SERVER_BIN], {
      env: { ...process.env, MARGINS_VAULT: this.vaultPath },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("error", (err) => this.rejectAll(err));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.rejectAll(
          new Error(`margins-mcp exited unexpectedly (code=${code}, signal=${signal})\nstderr:\n${this.stderr}`)
        );
      }
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "margins-mcp-stdio-test", version: "0.13.1" }
    });
    this.notify("notifications/initialized");
    return this;
  }

  handleStdout(chunk) {
    this.stdout += chunk.toString("utf8");
    for (let nl = this.stdout.indexOf("\n"); nl !== -1; nl = this.stdout.indexOf("\n")) {
      const line = this.stdout.slice(0, nl).trim();
      this.stdout = this.stdout.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        this.rejectAll(new Error(`invalid JSON from MCP stdout: ${line}\n${err.message}`));
        continue;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(msg);
      }
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}\nstderr:\n${this.stderr}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  close() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MCP client closed"));
    }
    this.pending.clear();
    if (this.child) this.child.kill();
  }

  rejectAll(err) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}

async function makeVault(t) {
  const vault = await mkdtemp(path.join(os.tmpdir(), "margins-mcp-stdio-"));
  t.after(async () => {
    await rm(vault, { recursive: true, force: true });
  });
  return vault;
}

async function startClient(t, vault) {
  const client = await new StdioMcpClient(vault).start();
  t.after(() => client.close());
  return client;
}

test("stdio tools/list exposes compile force schema", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  const response = await client.request("tools/list");
  assert.ifError(response.error);
  const tools = response.result.tools;
  const compile = tools.find((tool) => tool.name === "propose_compile_from_raw");
  assert.ok(compile, "compile tool is exposed over MCP");
  assert.equal(compile.inputSchema.properties.force.type, "boolean");
  assert.match(compile.inputSchema.properties.force.description, /replaced IN PLACE/i);
  assert.equal(compile.inputSchema.properties.bucket.type, "string");
});

test("stdio full proposal lifecycle preserves custom bucket and force replace-in-place", async (t) => {
  const vault = await makeVault(t);
  await mkdir(path.join(vault, "raw"), { recursive: true });
  await writeFile(
    path.join(vault, "raw/alpha.md"),
    "# Alpha\n\nBob Casey met Alice about Riviera. This source is meaningful enough to compile.\n",
    "utf8"
  );
  const client = await startClient(t, vault);

  const unprocessed = await client.callTool("list_unprocessed");
  assert.deepEqual(unprocessed.result.structuredContent.pending, ["raw/alpha.md"]);

  const read = await client.callTool("read_page", { path: "raw/alpha.md" });
  assert.equal(read.result.structuredContent.truncated, false);
  assert.equal(read.result.structuredContent.textLength, read.result.content[0].text.length);

  const compiled = await client.callTool("propose_compile_from_raw", {
    rawPath: "raw/alpha.md",
    summary: "Alpha meeting source.",
    bucket: "finance"
  });
  const firstDest = compiled.result.structuredContent.destinationPath;
  assert.match(firstDest, /^wiki\/finance\/source-\d{4}-\d{2}-\d{2}-alpha\.md$/);
  assert.equal(compiled.result.structuredContent.bucket, "finance");

  const proposals = await client.callTool("list_proposals");
  assert.deepEqual(
    proposals.result.structuredContent.items.map((item) => item.destinationPath),
    [firstDest]
  );

  const accepted = await client.callTool("resolve_proposal", {
    path: compiled.result.structuredContent.proposalPath,
    action: "accept"
  });
  assert.equal(accepted.result.structuredContent.action, "accepted");
  assert.equal(accepted.result.structuredContent.trackerUpdated.rawFile, "raw/alpha.md");
  const sourceBody = await readFile(path.join(vault, firstDest), "utf8");
  assert.match(sourceBody, /^raw_file: raw\/alpha\.md$/m);

  const secondCompile = await client.callTool("propose_compile_from_raw", {
    rawPath: "raw/alpha.md",
    summary: "Second compile should be idempotent."
  });
  assert.equal(secondCompile.result.structuredContent.status, "already-filed");
  assert.equal(secondCompile.result.structuredContent.existingPath, firstDest);

  const forced = await client.callTool("propose_compile_from_raw", {
    rawPath: "raw/alpha.md",
    summary: "Retake summary.",
    force: true
  });
  assert.equal(forced.result.structuredContent.destinationPath, firstDest);
  assert.equal(forced.result.structuredContent.bucket, "finance");
  assert.equal(forced.result.structuredContent.replacesVaultFile, true);

  const rejected = await client.callTool("resolve_proposal", {
    path: forced.result.structuredContent.proposalPath,
    action: "reject"
  });
  assert.equal(rejected.result.structuredContent.action, "rejected");
  const empty = await client.callTool("list_proposals");
  assert.deepEqual(empty.result.structuredContent.items, []);
});

test("stdio list_unprocessed root path can be passed directly to compile", async (t) => {
  const vault = await makeVault(t);
  await writeFile(
    path.join(vault, "meeting-root.md"),
    "# Root Meeting\n\nAlice and Bob discussed Riviera from a file dropped at vault root.\n",
    "utf8"
  );
  const client = await startClient(t, vault);

  const unprocessed = await client.callTool("list_unprocessed");
  assert.deepEqual(unprocessed.result.structuredContent.pending, ["meeting-root.md"]);

  const compiled = await client.callTool("propose_compile_from_raw", {
    rawPath: unprocessed.result.structuredContent.pending[0],
    summary: "Root-level meeting source.",
    bucket: "projects"
  });
  assert.equal(compiled.result.structuredContent.rawFile, "meeting-root.md");
  assert.match(
    compiled.result.structuredContent.destinationPath,
    /^wiki\/projects\/source-\d{4}-\d{2}-\d{2}-meeting-root\.md$/
  );
});

test("stdio read_page exposes truncation metadata for large extracted text", async (t) => {
  const vault = await makeVault(t);
  await mkdir(path.join(vault, "raw"), { recursive: true });
  const fullText = `${"A".repeat(260 * 1024)} UNIQUE_TAIL_MARKER`;
  await writeFile(path.join(vault, "raw/big.md"), fullText, "utf8");
  const client = await startClient(t, vault);

  const response = await client.callTool("read_page", { path: "raw/big.md" });
  assert.ifError(response.error);
  const body = response.result.content[0].text;
  assert.equal(response.result.structuredContent.truncated, true);
  assert.equal(response.result.structuredContent.textLength, fullText.length);
  assert.match(body, /Truncated at 256000 characters/);
  assert.equal(body.includes("UNIQUE_TAIL_MARKER"), false);

  const fetched = await client.callTool("fetch", { id: "raw/big.md" });
  assert.equal(fetched.result.structuredContent.metadata.truncated, true);
  assert.equal(fetched.result.structuredContent.metadata.textLength, fullText.length);
  const jsonPayload = JSON.parse(fetched.result.content[0].text);
  assert.equal(jsonPayload.metadata.truncated, true);
  assert.equal(jsonPayload.text.includes("UNIQUE_TAIL_MARKER"), false);
});

test("stdio path traversal is returned as a tool error without crashing server", async (t) => {
  const vault = await makeVault(t);
  await writeFile(path.join(vault, "safe.md"), "safe", "utf8");
  const client = await startClient(t, vault);

  const bad = await client.callTool("read_page", { path: "../outside.md" });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /Path escapes vault root/);

  const good = await client.callTool("read_page", { path: "safe.md" });
  assert.equal(good.result.structuredContent.path, "safe.md");
  assert.equal(good.result.content[0].text, "safe");
});
