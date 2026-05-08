import assert from "node:assert/strict";
import test from "node:test";
import { compileVault, localDateString, vaultToFiles } from "../src/compiler.js";

function modelReview(fileName, overrides = {}) {
  return {
    source: "api",
    provider: "gemini",
    reviewedAt: "2026-05-05T12:00:00.000Z",
    status: "Margins reviewed the source against the current vault.",
    summary: "Model-authored source summary.",
    summaryBullets: ["Model-authored detail."],
    takeaways: [
      {
        label: "Takeaway",
        point: "The model supplied this concrete source takeaway.",
        relevance: "primary",
        whyItMatters: ""
      }
    ],
    filingPlan: {
      whySaved: ["The model judged this source worth filing."],
      candidateFiles: [],
      placement: {
        bucket: "sources",
        path: `wiki/sources/source-${fileName.replace(/\.[^.]+$/, "")}.md`,
        title: "Model Reviewed Source",
        reason: "The model selected the source bucket.",
        alternatives: []
      },
      tags: ["model-reviewed"],
      regionTag: "",
      typeTag: "",
      typeTagNote: "",
      promotion: { candidate: "", recommendation: "", reason: "" }
    },
    filingSteps: ["Created source note from model review."],
    discoveries: [],
    financialDetails: {},
    connections: [],
    questions: [],
    ...overrides
  };
}

test("vaultToFiles emits V1 metadata only under wiki/.margins", () => {
  const vault = compileVault([
    {
      name: "note.md",
      text: "Margins compiles source files into a wiki. The language model reads source nodes and edit proposals."
    }
  ], {
    today: "2026-05-05",
    name: "Test Vault",
    ingestReviews: new Map([["note.md", modelReview("note.md")]])
  });
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
  assert.match(files.get("wiki/ingest-tracker.md"), /raw\/note\.md/);
  assert.match(files.get("wiki/ingest-tracker.md"), /\[\[source-note\]\]/);
  assert.match(files.get("wiki/log.md"), /Allowed ops: ingest \| query \| compile \| lint \| update/);
  assert.match(files.get("wiki/log.md"), /## \[2026-05-05\] ingest/);
  assert.match(files.get("wiki/wiki-stats.md"), /## Drift Watch/);
  assert.equal(files.has(".margins/manifest.json"), false);
  assert.equal(files.has(".margins/edit-log.jsonl"), false);

  const manifest = JSON.parse(files.get("wiki/.margins/manifest.json"));
  assert.equal(manifest.schema_version, "margins-v1");
  assert.equal(manifest.template, "karpathy-original");
  assert.equal(manifest.compiler, "model-review");
  assert.equal(manifest.privacy.requires_secrets, true);
  assert.equal(manifest.paths.metadata, "wiki/.margins/");
  assert.equal(manifest.paths.root_instructions, "CLAUDE.md");
  assert.equal(manifest.paths.ingest_tracker, "wiki/ingest-tracker.md");
});

test("compiler skips source markdown when no model review exists", () => {
  const vault = compileVault([
    {
      name: "unreviewed.md",
      text: "This source has readable text but no model review."
    }
  ], { today: "2026-05-05", name: "No Review Vault" });
  const files = vaultToFiles(vault);

  assert.equal(vault.manifest.counts.raw_sources, 1);
  assert.equal(vault.manifest.counts.source_nodes, 0);
  assert.equal(files.has("wiki/sources/source-unreviewed.md"), false);
  assert.match(files.get("wiki/ingest-tracker.md"), /No model-reviewed source pages created yet/);
});

test("local heuristic candidates stay in the ingest report until promoted", () => {
  const vault = compileVault([
    {
      name: "candidate-note.md",
      text: [
        "Alice Morgan discussed how a language model should support a local first wiki.",
        "The language model should help with source files, operator manual upkeep, and query cookbook maintenance."
      ].join(" ")
    }
  ], {
    today: "2026-05-05",
    name: "Candidate Vault",
    ingestReviews: new Map([[
      "candidate-note.md",
      modelReview("candidate-note.md", {
        summary: "The model says Alice Morgan discussed language-model support for a local-first wiki.",
        summaryBullets: ["The model selected this as a candidate source for future retrieval."],
        filingPlan: {
          ...modelReview("candidate-note.md").filingPlan,
          placement: {
            ...modelReview("candidate-note.md").filingPlan.placement,
            path: "wiki/sources/source-candidate-note.md",
            title: "Candidate Note"
          }
        }
      })
    ]])
  });
  const files = vaultToFiles(vault);
  const report = files.get("wiki/.margins/ingest-report.md");

  assert.equal(files instanceof Map, true);
  assert.equal(files.has("wiki/concepts/language-model.md"), false);
  assert.equal(files.has("wiki/entities/alice-morgan.md"), false);
  assert.equal(vault.manifest.counts.concept_nodes, 0);
  assert.equal(vault.manifest.counts.entity_nodes, 0);
  assert.ok(vault.manifest.counts.candidate_concepts > 0);
  assert.ok(vault.manifest.counts.candidate_entities > 0);
  assert.match(report, /Report-only concept candidates: [1-9]/);
  assert.match(report, /Language Model/);
  assert.match(report, /Alice Morgan/);
  assert.match(report, /Mentioned But Missing/);

  const sourceNote = files.get("wiki/sources/source-candidate-note.md");
  assert.match(sourceNote, /## Summary/);
  assert.match(sourceNote, /The model says Alice Morgan/);
  assert.doesNotMatch(sourceNote, /## Key Terms/);
  assert.doesNotMatch(sourceNote, /## Entity Candidates/);
  assert.doesNotMatch(sourceNote, /\[\[language-model\|language model\]\]/i);
  assert.doesNotMatch(sourceNote, /\[\[alice-morgan\|Alice Morgan\]\]/);
});

test("localDateString formats local calendar dates instead of UTC slices", () => {
  assert.equal(localDateString(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02");
});
