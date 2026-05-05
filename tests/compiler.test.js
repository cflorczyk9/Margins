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
  assert.match(files.get("wiki/index.md"), /^---\ntype: index\nbucket: index/m);
  assert.equal(files.has(".margins/manifest.json"), false);
  assert.equal(files.has(".margins/edit-log.jsonl"), false);

  const manifest = JSON.parse(files.get("wiki/.margins/manifest.json"));
  assert.equal(manifest.schema_version, "margins-v1");
  assert.equal(manifest.template, "karpathy-original");
  assert.equal(manifest.privacy.requires_secrets, false);
  assert.equal(manifest.paths.metadata, "wiki/.margins/");
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

    const manifest = JSON.parse(await readFile(join(outputDir, "wiki/.margins/manifest.json"), "utf8"));
    assert.equal(manifest.counts.raw_sources, 3);
    assert.equal(manifest.counts.source_nodes, 3);

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
