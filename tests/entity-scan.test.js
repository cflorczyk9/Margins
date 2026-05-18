// Tests for scan_entity_candidates. Covers thresholds, existing-slug
// exclusion, global stoplist, domain packs, snippet shape, scope filter,
// and the wikilink-aware extractor (so already-linked names don't get
// re-proposed as stubs).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createVault } from "../src/vault.js";
import { scanEntityCandidates } from "../src/entity-scan.js";

let tmpRoot;
let vault;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "margins-entity-"));
  vault = createVault(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function touch(rel, body) {
  const abs = path.join(tmpRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

test("surfaces a recurring capitalized phrase with no matching slug", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, `Talked with Bob Casey about the deal. Bob Casey is interesting.`);
  }
  const result = await scanEntityCandidates(vault, { minMentions: 5, minFileSpread: 3 });
  const bob = result.candidates.find((c) => c.slug === "bob-casey");
  assert.ok(bob, `expected bob-casey candidate, got: ${result.candidates.map((c) => c.slug).join(", ")}`);
  assert.equal(bob.fileCount, 5);
  assert.ok(bob.mentionCount >= 10);
  assert.ok(bob.snippets.length >= 1);
  assert.match(bob.snippets[0].snippet, /Bob Casey/);
});

test("excludes phrases whose slug already exists as a vault page", async () => {
  // Bob Casey HAS a page → should not appear as a candidate.
  await touch("wiki/people/bob-casey.md", "# Bob Casey");
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Bob Casey came to the meeting.");
  }
  const result = await scanEntityCandidates(vault, { minMentions: 3, minFileSpread: 3 });
  const bob = result.candidates.find((c) => c.slug === "bob-casey");
  assert.equal(bob, undefined, "bob-casey should be excluded because the page already exists");
  assert.ok(result.excludedExistingSlugs >= 1);
});

test("respects minMentions and minFileSpread thresholds", async () => {
  // Alice appears in 5 files, each once — 5 mentions, spread 5.
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Alice Chen was there.");
  }
  // Carol appears 10x in one file only — high mentions, low spread.
  await touch(
    "wiki/notes/heavy.md",
    "Carol Singh said. Carol Singh did. Carol Singh repeated. ".repeat(10)
  );
  const result = await scanEntityCandidates(vault, { minMentions: 4, minFileSpread: 3 });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(slugs.includes("alice-chen"));
  assert.ok(!slugs.includes("carol-singh"), "carol should fail minFileSpread=3");
});

test("does NOT re-propose already-wikilinked names", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Met with [[bob-casey]] today.");
  }
  const result = await scanEntityCandidates(vault, { minMentions: 1, minFileSpread: 1 });
  const bob = result.candidates.find((c) => c.slug === "bob-casey");
  assert.equal(bob, undefined, "wikilinked names should not become candidates");
});

test("global stoplist drops common structural words", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(
      `wiki/notes/n-${i}.md`,
      "Summary\n\nMonday meeting. Tuesday call. Wednesday review. Background notes. Conclusion: ship."
    );
  }
  const result = await scanEntityCandidates(vault, { minMentions: 3, minFileSpread: 3 });
  for (const noise of ["summary", "monday", "tuesday", "wednesday", "background", "conclusion"]) {
    assert.equal(
      result.candidates.find((c) => c.slug === noise),
      undefined,
      `${noise} should be in the global stoplist`
    );
  }
});

test("med domain pack drops 'First Aid' / 'Step One' / 'Gram Positive'", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(
      `wiki/notes/n-${i}.md`,
      "First Aid says Step One is core. Gram Positive bacteria differ from Gram Negative."
    );
  }
  const result = await scanEntityCandidates(vault, {
    minMentions: 3,
    minFileSpread: 3,
    domain: "med"
  });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(!slugs.includes("first-aid"));
  assert.ok(!slugs.includes("step-one"));
  assert.ok(!slugs.includes("gram-positive"));
});

test("realestate domain pack drops 'Class A' / 'Phase II' / 'Due Diligence'", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(
      `wiki/notes/n-${i}.md`,
      "Class A asset in Phase II of Due Diligence. Cap Rate target unchanged."
    );
  }
  const result = await scanEntityCandidates(vault, {
    minMentions: 3,
    minFileSpread: 3,
    domain: "realestate"
  });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(!slugs.includes("class-a"));
  assert.ok(!slugs.includes("phase-ii"));
  assert.ok(!slugs.includes("due-diligence"));
});

test("excludeUserRejections drops user-rejected candidates", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Mark Loh sent a note. Mark Loh approved.");
  }
  const result = await scanEntityCandidates(vault, {
    minMentions: 5,
    minFileSpread: 3,
    excludeUserRejections: ["Mark Loh"]
  });
  assert.equal(result.candidates.find((c) => c.slug === "mark-loh"), undefined);
});

test("scope filter limits the walk to matching files", async () => {
  for (let i = 0; i < 5; i++) {
    await touch(`Path/n-${i}.md`, "Krebs Cycle is core. Krebs Cycle again.");
    await touch(`Pharm/n-${i}.md`, "Statin Therapy is widespread. Statin Therapy again.");
  }
  const result = await scanEntityCandidates(vault, {
    scope: "Path/**",
    minMentions: 3,
    minFileSpread: 3
  });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(slugs.includes("krebs-cycle"));
  assert.ok(!slugs.includes("statin-therapy"));
  assert.equal(result.filesScanned, 5);
});

test("ranks by file-spread × mention-count", async () => {
  // Wide-spread name in 10 files, 1 mention each.
  for (let i = 0; i < 10; i++) {
    await touch(`wiki/notes/wide-${i}.md`, "Sarah Park appeared.");
  }
  // Narrow-spread name in 3 files, 5 mentions each.
  for (let i = 0; i < 3; i++) {
    await touch(`wiki/notes/narrow-${i}.md`, "Doug Reed said. Doug Reed said. Doug Reed said. Doug Reed said. Doug Reed said.");
  }
  const result = await scanEntityCandidates(vault, { minMentions: 5, minFileSpread: 3 });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(slugs.indexOf("sarah-park") < slugs.indexOf("doug-reed"),
    "sarah-park (10 files × 1) should outrank doug-reed (3 files × 5)");
});

test("respects limit and reports candidatesFound separately", async () => {
  // Generate many distinct entities each appearing 5 times in 3 files.
  const names = ["Alpha One", "Bravo Two", "Charlie Three", "Delta Four", "Echo Five",
                 "Foxtrot Six", "Golf Seven", "Hotel Eight"];
  for (const name of names) {
    for (let f = 0; f < 3; f++) {
      await touch(`wiki/notes/${name.toLowerCase().replace(/ /g, "-")}-${f}.md`,
        `${name} appeared. ${name} acted. ${name} closed. ${name} signed. ${name} returned.`);
    }
  }
  const result = await scanEntityCandidates(vault, { minMentions: 5, minFileSpread: 3, limit: 3 });
  assert.equal(result.candidates.length, 3);
  assert.ok(result.candidatesFound >= 8);
  assert.equal(result.truncated, true);
});

test("skips system pages (tracker / type:system)", async () => {
  await touch("wiki/ingest-tracker.md",
    "---\ntype: tracker\n---\n\n| raw/x.md | ingested | [[s-x]] | - |  |  |\n" +
    "Mentions of Sundry Heading and Another Thing happen here.".repeat(5)
  );
  for (let i = 0; i < 5; i++) {
    await touch(`wiki/notes/n-${i}.md`, "Real Entity is in real notes.");
  }
  const result = await scanEntityCandidates(vault, { minMentions: 1, minFileSpread: 1 });
  const slugs = result.candidates.map((c) => c.slug);
  assert.ok(!slugs.includes("sundry-heading"));
  assert.ok(!slugs.includes("another-thing"));
  assert.ok(slugs.includes("real-entity"));
});

test("rejects unknown domain with clear error", async () => {
  await touch("wiki/notes/n.md", "test");
  await assert.rejects(
    () => scanEntityCandidates(vault, { domain: "fictional" }),
    /unknown domain/
  );
});

test("snippets reference the file and quote the surrounding context", async () => {
  await touch("wiki/notes/n-1.md", "Earlier in the paragraph, Holmes Doctrine was applied. Later text follows.");
  await touch("wiki/notes/n-2.md", "Different file mentioning Holmes Doctrine here too.");
  await touch("wiki/notes/n-3.md", "Yet another reference to Holmes Doctrine in a third place.");
  const result = await scanEntityCandidates(vault, { minMentions: 3, minFileSpread: 3 });
  const holmes = result.candidates.find((c) => c.slug === "holmes-doctrine");
  assert.ok(holmes);
  assert.ok(holmes.snippets.length >= 1);
  assert.match(holmes.snippets[0].snippet, /Holmes Doctrine/);
  assert.match(holmes.snippets[0].file, /^wiki\/notes\/n-\d\.md$/);
});
