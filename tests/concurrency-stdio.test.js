// Smoke tests for the per-destination mutex over the real MCP stdio transport.
// Unit tests in tests/proposals.test.js exercise the in-process API. These
// spawn the actual margins-mcp binary, speak JSON-RPC over stdio, and fire
// concurrent tool calls — the same code path Claude Desktop uses.
//
// If the MCP SDK dispatches incoming tool calls in parallel (it does), and
// the mutex inside createProposals is missing or wrong, these tests fail
// loudly with lost updates / clobbered files.
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
      env: { ...process.env, MARGINS_VAULT: this.vaultPath, MARGINS_TELEMETRY: "off" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk.toString("utf8"); });
    this.child.on("error", (err) => this.rejectAll(err));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.rejectAll(new Error(`margins-mcp exited (code=${code}, signal=${signal})\nstderr:\n${this.stderr}`));
      }
    });
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "concurrency-stdio-smoke", version: "0.0.1" }
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
      try { msg = JSON.parse(line); }
      catch (err) { this.rejectAll(new Error(`bad JSON from MCP: ${line}\n${err.message}`)); continue; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg);
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
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }
  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  callTool(name, args = {}) { return this.request("tools/call", { name, arguments: args }); }
  close() {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("closed")); }
    this.pending.clear();
    if (this.child) this.child.kill();
  }
  rejectAll(err) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
}

async function makeVault(t) {
  const vault = await mkdtemp(path.join(os.tmpdir(), "margins-concurrency-stdio-"));
  t.after(async () => { await rm(vault, { recursive: true, force: true }); });
  return vault;
}
async function startClient(t, vault) {
  const client = await new StdioMcpClient(vault).start();
  t.after(() => client.close());
  return client;
}

test("stdio: 25 parallel append_to calls to same path land every line", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  const N = 25;
  const responses = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      client.callTool("append_to", { path: "wiki/inbox.md", content: `line-${i}\n` })
    )
  );
  // Every individual call must succeed at the protocol level.
  for (const r of responses) {
    assert.ifError(r.error);
    assert.notEqual(r.result?.isError, true);
  }
  const staged = await readFile(path.join(vault, "proposed/wiki/inbox.md"), "utf8");
  // Order is not guaranteed under contention; presence of every line is.
  const found = new Set(
    staged.split(/\n/).filter((s) => s.startsWith("line-")).map((s) => s.trim())
  );
  const missing = [];
  for (let i = 0; i < N; i++) {
    if (!found.has(`line-${i}`)) missing.push(`line-${i}`);
  }
  assert.deepEqual(missing, [], `missing ${missing.length}/${N} lines after parallel appends`);
});

test("stdio: parallel propose_edit on disjoint markers both land", async (t) => {
  const vault = await makeVault(t);
  await mkdir(path.join(vault, "wiki"), { recursive: true });
  await writeFile(path.join(vault, "wiki/dual.md"), "ALPHA\nBETA\nGAMMA\n", "utf8");
  const client = await startClient(t, vault);

  const [a, b, c] = await Promise.all([
    client.callTool("propose_edit", { path: "wiki/dual.md", before: "ALPHA", after: "alpha-edited" }),
    client.callTool("propose_edit", { path: "wiki/dual.md", before: "BETA",  after: "beta-edited"  }),
    client.callTool("propose_edit", { path: "wiki/dual.md", before: "GAMMA", after: "gamma-edited" })
  ]);
  for (const r of [a, b, c]) {
    assert.ifError(r.error);
    assert.notEqual(r.result?.isError, true, `tool returned isError: ${JSON.stringify(r.result?.content)}`);
  }
  const staged = await readFile(path.join(vault, "proposed/wiki/dual.md"), "utf8");
  assert.match(staged, /alpha-edited/);
  assert.match(staged, /beta-edited/);
  assert.match(staged, /gamma-edited/);
  assert.doesNotMatch(staged, /\bALPHA\b/);
  assert.doesNotMatch(staged, /\bBETA\b/);
  assert.doesNotMatch(staged, /\bGAMMA\b/);
});

test("stdio: parallel resolveProposal accepts preserve both tracker rows", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  const bodyA = `---\ntype: source\nraw_file: raw/a.md\n---\n# A\n`;
  const bodyB = `---\ntype: source\nraw_file: raw/b.md\n---\n# B\n`;
  const bodyC = `---\ntype: source\nraw_file: raw/c.md\n---\n# C\n`;
  await client.callTool("propose_page", { path: "wiki/sources/source-a.md", body: bodyA });
  await client.callTool("propose_page", { path: "wiki/sources/source-b.md", body: bodyB });
  await client.callTool("propose_page", { path: "wiki/sources/source-c.md", body: bodyC });

  const [ra, rb, rc] = await Promise.all([
    client.callTool("resolve_proposal", { path: "wiki/sources/source-a.md", action: "accept" }),
    client.callTool("resolve_proposal", { path: "wiki/sources/source-b.md", action: "accept" }),
    client.callTool("resolve_proposal", { path: "wiki/sources/source-c.md", action: "accept" })
  ]);
  for (const r of [ra, rb, rc]) {
    assert.ifError(r.error);
    assert.notEqual(r.result?.isError, true);
  }
  const tracker = await readFile(path.join(vault, "wiki/ingest-tracker.md"), "utf8");
  assert.match(tracker, /\| raw\/a\.md \| ingested \| \[\[source-a\]\]/);
  assert.match(tracker, /\| raw\/b\.md \| ingested \| \[\[source-b\]\]/);
  assert.match(tracker, /\| raw\/c\.md \| ingested \| \[\[source-c\]\]/);
});

test("stdio: bulk resolve_proposal via pattern accepts every match", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  // Stage 5 source proposals plus an unrelated project proposal.
  const make = (raw, body) => `---\ntype: source\nraw_file: raw/${raw}\n---\n# ${body}\n`;
  for (let i = 0; i < 5; i++) {
    const stage = await client.callTool("propose_page", {
      path: `wiki/sources/source-${i}.md`,
      body: make(`r-${i}.md`, `Body ${i}`)
    });
    assert.notEqual(stage.result?.isError, true);
  }
  await client.callTool("propose_page", { path: "wiki/projects/keep.md", body: "untouched" });

  // Dry-run preview matches 5 paths but does not apply.
  const dry = await client.callTool("resolve_proposal", {
    pattern: "wiki/sources/source-*.md",
    action: "accept",
    dryRun: true
  });
  assert.notEqual(dry.result?.isError, true);
  assert.equal(dry.result.structuredContent.dryRun, true);
  assert.equal(dry.result.structuredContent.matched, 5);

  // The project proposal is still pending after the dry-run.
  const stillPending = await client.callTool("list_proposals", {});
  assert.equal(stillPending.result.structuredContent.totalMatched, 6);

  // Apply the bulk accept.
  const applied = await client.callTool("resolve_proposal", {
    pattern: "wiki/sources/source-*.md",
    action: "accept"
  });
  assert.notEqual(applied.result?.isError, true);
  assert.equal(applied.result.structuredContent.succeeded, 5);

  // Vault now has the 5 source pages, the project proposal is still staged.
  for (let i = 0; i < 5; i++) {
    const body = await readFile(path.join(vault, `wiki/sources/source-${i}.md`), "utf8");
    assert.match(body, new RegExp(`raw_file: raw/r-${i}\\.md`));
  }
  const remaining = await client.callTool("list_proposals", {});
  assert.deepEqual(
    remaining.result.structuredContent.items.map((i) => i.destinationPath),
    ["wiki/projects/keep.md"]
  );

  // Tracker has every row.
  const tracker = await readFile(path.join(vault, "wiki/ingest-tracker.md"), "utf8");
  for (let i = 0; i < 5; i++) {
    assert.match(tracker, new RegExp(`\\| raw/r-${i}\\.md \\| ingested \\| \\[\\[source-${i}\\]\\]`));
  }
});

test("stdio: list_proposals pattern + limit pagination", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  for (let i = 0; i < 10; i++) {
    await client.callTool("propose_page", { path: `wiki/inbox/n-${i}.md`, body: `b-${i}` });
  }
  await client.callTool("propose_page", { path: "wiki/projects/other.md", body: "x" });

  const r = await client.callTool("list_proposals", { pattern: "wiki/inbox/**", limit: 3 });
  const sc = r.result.structuredContent;
  assert.equal(sc.items.length, 3);
  assert.equal(sc.totalMatched, 10);
  assert.equal(sc.truncated, true);
  for (const item of sc.items) {
    assert.match(item.destinationPath, /^wiki\/inbox\//);
  }
});

test("stdio: resolve_proposal errors on both path and pattern (or neither)", async (t) => {
  const vault = await makeVault(t);
  const client = await startClient(t, vault);

  const both = await client.callTool("resolve_proposal", {
    path: "wiki/foo.md",
    pattern: "wiki/*.md",
    action: "accept"
  });
  assert.equal(both.result.isError, true);
  assert.match(both.result.content[0].text, /exactly one of path or pattern/i);

  const neither = await client.callTool("resolve_proposal", { action: "accept" });
  assert.equal(neither.result.isError, true);
  assert.match(neither.result.content[0].text, /either path.*or pattern/i);
});

test("stdio: interleaved append + edit on same path do not drop the append", async (t) => {
  const vault = await makeVault(t);
  await mkdir(path.join(vault, "wiki"), { recursive: true });
  await writeFile(path.join(vault, "wiki/mixed.md"), "SEED-LINE\n", "utf8");
  const client = await startClient(t, vault);

  // 5 appends interleaved with an edit that rewrites the seed line. The edit
  // and the appends touch the same destination, so they must serialize. If
  // the lock fails, either the edit reads a stale snapshot and silently
  // misses on a later append, or one of the appends overwrites the edit.
  const ops = [];
  for (let i = 0; i < 5; i++) {
    ops.push(client.callTool("append_to", { path: "wiki/mixed.md", content: `appended-${i}\n` }));
  }
  ops.push(client.callTool("propose_edit", {
    path: "wiki/mixed.md", before: "SEED-LINE", after: "SEED-REWRITTEN"
  }));
  const results = await Promise.all(ops);
  for (const r of results) {
    assert.ifError(r.error);
    assert.notEqual(r.result?.isError, true, `tool error: ${JSON.stringify(r.result?.content)}`);
  }
  const staged = await readFile(path.join(vault, "proposed/wiki/mixed.md"), "utf8");
  assert.match(staged, /SEED-REWRITTEN/, "edit must land somewhere in final staged body");
  for (let i = 0; i < 5; i++) {
    assert.match(staged, new RegExp(`^appended-${i}$`, "m"), `missing appended-${i}`);
  }
});
