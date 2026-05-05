import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { compileVault, vaultToFiles } from "../src/compiler.js";

const execFileAsync = promisify(execFile);

test("vaultToFiles emits V1 metadata only under wiki/.margins", () => {
  const vault = compileVault([
    {
      name: "note.md",
      text: "Margins compiles raw sources into a wiki. The language model reads source nodes and edit proposals."
    }
  ], { today: "2026-05-05", name: "Test Vault" });
  const files = vaultToFiles(vault);

  assert.ok(files.has("wiki/.margins/manifest.json"));
  assert.ok(files.has("wiki/.margins/edit-log.jsonl"));
  assert.ok(files.has("wiki/.margins/ingest-report.md"));
  assert.ok(files.has("CLAUDE.md"));
  assert.ok(files.has("wiki/ingest-tracker.md"));
  assert.ok(files.has("wiki/log.md"));
  assert.ok(files.has("wiki/wiki-stats.md"));
  assert.ok(files.has("wiki/sources/sources.md"));
  assert.ok(files.has("wiki/concepts/concepts.md"));
  assert.ok(files.has("wiki/entities/entities.md"));
  assert.ok(files.has("wiki/synthesis/synthesis.md"));
  assert.ok(files.has("wiki/_templates/source.md"));
  assert.ok(files.has("wiki/_templates/entity.md"));
  assert.ok(files.has("wiki/_templates/meeting.md"));
  assert.match(files.get("wiki/index.md"), /^---\ntype: index\nbucket: index/m);
  assert.match(files.get("CLAUDE.md"), /Closed-Set Operation Vocabulary/);
  assert.match(files.get("CLAUDE.md"), /ingest \| query \| compile \| lint \| update/);
  assert.match(files.get("CLAUDE.md"), /wiki\/ingest-tracker\.md/);
  assert.match(files.get("wiki/ingest-tracker.md"), /raw_sources\/note\.md/);
  assert.match(files.get("wiki/ingest-tracker.md"), /\[\[source-note\]\]/);
  assert.match(files.get("wiki/log.md"), /Allowed ops: ingest \| query \| compile \| lint \| update/);
  assert.match(files.get("wiki/log.md"), /## \[2026-05-05\] ingest/);
  assert.match(files.get("wiki/wiki-stats.md"), /## Drift Watch/);
  assert.equal(files.has(".margins/manifest.json"), false);
  assert.equal(files.has(".margins/edit-log.jsonl"), false);

  const manifest = JSON.parse(files.get("wiki/.margins/manifest.json"));
  assert.equal(manifest.schema_version, "margins-v1");
  assert.equal(manifest.template, "karpathy-original");
  assert.equal(manifest.privacy.requires_secrets, false);
  assert.equal(manifest.paths.metadata, "wiki/.margins/");
  assert.equal(manifest.paths.root_instructions, "CLAUDE.md");
  assert.equal(manifest.paths.ingest_tracker, "wiki/ingest-tracker.md");
});

test("sample compile creates useful V1 output without generic sample candidates", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "margins-compile-"));
  try {
    await mkdir(join(outputDir, ".margins"), { recursive: true });
    await writeFile(join(outputDir, ".margins/manifest.json"), "{}", "utf8");
    await mkdir(join(outputDir, "wiki/concepts"), { recursive: true });
    await writeFile(join(outputDir, "wiki/concepts/without.md"), "# stale", "utf8");
    await mkdir(join(outputDir, "wiki/entities"), { recursive: true });
    await writeFile(join(outputDir, "wiki/entities/if.md"), "# stale", "utf8");

    await execFileAsync("node", ["src/cli.js", "sample/raw_sources", outputDir], {
      cwd: new URL("..", import.meta.url)
    });

    await assert.rejects(stat(join(outputDir, ".margins")));
    await stat(join(outputDir, "wiki/.margins/manifest.json"));
    await stat(join(outputDir, "wiki/.margins/edit-log.jsonl"));
    await stat(join(outputDir, "wiki/.margins/ingest-report.md"));
    await stat(join(outputDir, "CLAUDE.md"));
    await stat(join(outputDir, "wiki/ingest-tracker.md"));
    await stat(join(outputDir, "wiki/log.md"));
    await stat(join(outputDir, "wiki/wiki-stats.md"));
    await stat(join(outputDir, "wiki/_templates/entity.md"));

    const manifest = JSON.parse(await readFile(join(outputDir, "wiki/.margins/manifest.json"), "utf8"));
    assert.equal(manifest.counts.raw_sources, 3);
    assert.equal(manifest.counts.source_nodes, 3);
    assert.ok(manifest.counts.structural_files >= 10);

    const claudeMd = await readFile(join(outputDir, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /wiki\/ingest-tracker\.md/);
    assert.match(claudeMd, /voice: claude-draft/);

    const tracker = await readFile(join(outputDir, "wiki/ingest-tracker.md"), "utf8");
    assert.match(tracker, /raw_sources\/margins-product-call\.txt/);
    assert.match(tracker, /\| ingested \|/);

    const log = await readFile(join(outputDir, "wiki/log.md"), "utf8");
    assert.match(log, /## \[\d{4}-\d{2}-\d{2}\] ingest/);

    const conceptDirNames = await execFileAsync("find", [join(outputDir, "wiki/concepts"), "-maxdepth", "1", "-type", "f", "-name", "*.md"]);
    const conceptFiles = conceptDirNames.stdout;
    for (const generic of ["closer.md", "files.md", "pages.md", "without.md"]) {
      assert.equal(conceptFiles.includes(`/${generic}`), false);
    }

    const entityDirNames = await execFileAsync("find", [join(outputDir, "wiki/entities"), "-maxdepth", "1", "-type", "f", "-name", "*.md"]);
    const entityFiles = entityDirNames.stdout;
    for (const generic of ["draft.md", "if.md", "it.md", "raw.md", "they.md", "version.md", "without.md"]) {
      assert.equal(entityFiles.includes(`/${generic}`), false);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
