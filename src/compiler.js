import {
  cleanSummary,
  formatConnectionLine,
  formatFilingJudgmentMarkdown,
  formatFinancialDetailsMarkdown,
  hasFilingPlan,
  hasFinancialDetails,
  normalizeFilingPath,
  sourcePathForBucket,
  sourceTagsFromFilingPlan
} from "./core/wiki.js";

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being", "between",
  "could", "during", "every", "first", "from", "have", "into", "more", "most", "other",
  "over", "same", "should", "some", "than", "that", "their", "there", "these", "they",
  "this", "those", "through", "under", "where", "which", "while", "with", "would",
  "your", "what", "when", "then", "them", "were", "will", "just", "like", "only",
  "does", "done", "make", "made", "much", "many", "such", "very", "can", "had",
  "has", "not", "but", "for", "and", "the", "you", "are", "was", "one", "all",
  "our", "out", "use", "how", "why", "who", "its", "it's", "don't", "want",
  "without", "closer", "version", "include", "needs", "need", "able", "start",
  "raw", "draft", "they", "if", "corporate", "hosting"
]);

const LOW_QUALITY_CONCEPTS = new Set([
  "able", "admin", "app", "apps", "builds", "can", "closer", "come", "contains",
  "controls", "documents", "draft", "edited", "files", "folder", "generic", "include",
  "keeps", "later", "made", "minimum", "nodes", "only", "organized", "pages", "plans",
  "probably", "product", "real", "should", "similar", "silent", "surface", "text",
  "thinking", "useful", "user", "users", "value", "version", "want", "without", "work"
]);

const DURABLE_SINGLE_CONCEPTS = new Set([
  "citations", "context", "evidence", "graph", "markdown", "privacy", "wiki"
]);

const CONCEPT_PHRASES = [
  "agent files",
  "command files",
  "concept nodes",
  "edit log",
  "edit proposals",
  "entity nodes",
  "language model",
  "local first",
  "mcp server",
  "operator manual",
  "personal context",
  "query cookbook",
  "source files",
  "source nodes",
  "synthesis nodes",
  "write back"
];

const PERSON_STOP = new Set([
  "The", "This", "That", "These", "Those", "When", "Where", "What", "Why", "How",
  "And", "But", "For", "With", "From", "Into", "It", "Every", "Users", "Version",
  "Without", "Markdown", "Raw", "Draft", "If"
]);

const ENTITY_STOP_LOWER = new Set([
  "briefly branch map",
  "karpathy original template notes",
  "source files",
  "source nodes",
  "concept nodes",
  "entity nodes",
  "synthesis nodes",
  "query cookbook",
  "operator manual",
  "markdown instructions"
]);

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function compileVault(files, options = {}) {
  const today = options.today || localDateString();
  const normalized = files.map((file, index) => normalizeFile(file, index));
  const ingestReviews = normalizeIngestReviewMap(options.ingestReviews);
  const sourceNodes = normalized
    .map((file) => buildSourceNode(file, today, ingestReviews.get(file.name)))
    .filter(Boolean);
  const candidateConcepts = buildConceptNodes(sourceNodes, today);
  const candidateEntities = buildEntityNodes(sourceNodes, today);
  const conceptNodes = options.promoteHeuristicCandidates ? candidateConcepts : [];
  const entityNodes = options.promoteHeuristicCandidates ? candidateEntities : [];
  const synthesisNodes = buildSynthesisNodes(sourceNodes, conceptNodes, today);
  const edges = buildEdges(sourceNodes, conceptNodes, entityNodes, synthesisNodes);
  const graph = {
    nodes: [
      ...sourceNodes.map(toGraphNode),
      ...conceptNodes.map(toGraphNode),
      ...entityNodes.map(toGraphNode),
      ...synthesisNodes.map(toGraphNode)
    ],
    edges
  };
  const operatingLayer = buildOperatingLayer(today);
  const editProposals = buildEditProposals(conceptNodes, entityNodes, synthesisNodes, today);
  const structuralLayer = buildStructuralLayer({
    today,
    files: normalized,
    sourceNodes,
    conceptNodes,
    entityNodes,
    synthesisNodes,
    edges,
    editProposals
  });
  const manifest = {
    name: options.name || "Karpathy Original",
    schema_version: "margins-v1",
    template: "karpathy-original",
    compiler: "model-review",
    version: "0.1.0",
    generated_at: `${today}T00:00:00.000Z`,
    privacy: {
      storage: "local-first",
      hosted_documents: false,
      silent_write_back: false,
      requires_secrets: true
    },
    paths: {
      raw_sources: "raw/",
      wiki: "wiki/",
      root_instructions: "CLAUDE.md",
      ingest_tracker: "wiki/ingest-tracker.md",
      narrative_log: "wiki/log.md",
      wiki_stats: "wiki/wiki-stats.md",
      metadata: "wiki/.margins/",
      templates: "wiki/_templates/",
      commands: "commands/",
      agents: "agents/"
    },
    counts: {
      raw_sources: normalized.length,
      source_nodes: sourceNodes.length,
      concept_nodes: conceptNodes.length,
      entity_nodes: entityNodes.length,
      candidate_concepts: candidateConcepts.length,
      candidate_entities: candidateEntities.length,
      synthesis_nodes: synthesisNodes.length,
      edges: edges.length,
      structural_files: structuralLayer.fileCount
    },
    raw_sources: normalized.map((file) => ({
      id: file.id,
      path: `raw/${file.name}`,
      words: file.wordCount,
      unsupported: file.unsupported
    })),
    enabled_commands: Object.keys(operatingLayer.commands),
    enabled_agents: Object.keys(operatingLayer.agents)
  };

  return {
    rawSources: normalized,
    wiki: {
      sources: sourceNodes,
      concepts: conceptNodes,
      entities: entityNodes,
      synthesis: synthesisNodes,
      graph,
      structural: structuralLayer
    },
    operatingLayer,
    editProposals,
    ingestReport: buildIngestReport({
      today,
      files: normalized,
      sourceNodes,
      conceptNodes,
      entityNodes,
      candidateConcepts,
      candidateEntities,
      synthesisNodes,
      edges,
      editProposals
    }),
    manifest
  };
}

export function vaultToFiles(vault) {
  const files = new Map();

  for (const source of vault.wiki.sources) {
    files.set(source.path || `wiki/sources/${source.slug}.md`, source.markdown);
  }
  for (const concept of vault.wiki.concepts) {
    files.set(`wiki/concepts/${concept.slug}.md`, concept.markdown);
  }
  for (const entity of vault.wiki.entities) {
    files.set(`wiki/entities/${entity.slug}.md`, entity.markdown);
  }
  for (const synthesis of vault.wiki.synthesis) {
    files.set(`wiki/synthesis/${synthesis.slug}.md`, synthesis.markdown);
  }

  files.set("wiki/index.md", buildIndex(vault));
  files.set("wiki/ingest-tracker.md", vault.wiki.structural.ingestTracker);
  files.set("wiki/log.md", vault.wiki.structural.log);
  files.set("wiki/wiki-stats.md", vault.wiki.structural.stats);
  files.set("wiki/graph.json", JSON.stringify(vault.wiki.graph, null, 2));
  files.set("CLAUDE.md", vault.operatingLayer.claudeMd);
  files.set("operator-manual.md", vault.operatingLayer.operatorManual);
  files.set("query-cookbook.md", vault.operatingLayer.queryCookbook);
  files.set("wiki/.margins/manifest.json", JSON.stringify(vault.manifest, null, 2));
  files.set("wiki/.margins/edit-log.jsonl", vault.editProposals.map((p) => JSON.stringify(p)).join("\n") + "\n");
  files.set("wiki/.margins/ingest-report.md", vault.ingestReport);

  for (const [name, body] of Object.entries(vault.operatingLayer.commands)) {
    files.set(`commands/${name}.md`, body);
  }
  for (const [name, body] of Object.entries(vault.operatingLayer.agents)) {
    files.set(`agents/${name}.md`, body);
  }
  for (const [path, body] of Object.entries(vault.wiki.structural.bucketOverviews)) {
    files.set(path, body);
  }
  for (const [name, body] of Object.entries(vault.wiki.structural.templates)) {
    files.set(`wiki/_templates/${name}.md`, body);
  }

  return files;
}

function normalizeFile(file, index) {
  const name = file.name || `source-${index + 1}.txt`;
  const text = file.text || "";
  return {
    id: `raw-${index + 1}`,
    name,
    slug: slugify(name.replace(/\.[^.]+$/, "")) || `source-${index + 1}`,
    extension: name.includes(".") ? name.split(".").pop().toLowerCase() : "txt",
    text,
    wordCount: words(text).length,
    unsupported: isProbablyUnsupported(name, text)
  };
}

function normalizeIngestReviewMap(reviews) {
  if (!reviews) return new Map();
  if (reviews instanceof Map) return reviews;
  if (Array.isArray(reviews)) return new Map(reviews);
  if (typeof reviews === "object") return new Map(Object.entries(reviews));
  return new Map();
}

function isModelIngestReview(review) {
  return Boolean(review && review.source === "api");
}

function buildSourceNode(file, today, review) {
  if (!isModelIngestReview(review)) return null;

  const plan = review.filingPlan || {};
  const placement = plan.placement || {};
  const path = normalizeFilingPath(placement.path || "", placement.bucket || "sources") ||
    sourcePathForBucket(file.name, placement.bucket || "sources");
  const slug = path.split("/").pop().replace(/\.md$/, "") || `source-${file.slug}`;
  const title = cleanSummary(placement.title || titleize(slug.replace(/^source-/, ""))) || titleize(file.slug);
  const summary = modelReviewSummary(review);
  const terms = topTerms(file.text, 10);
  const entities = extractEntities(file.text).slice(0, 8);
  const tags = hasFilingPlan(plan) ? sourceTagsFromFilingPlan(plan) : ["source"];
  const bucket = path.split("/")[1] || "sources";
  const reviewedAt = review.reviewedAt ? `reviewed_at: ${yamlString(review.reviewedAt)}\n` : "";
  const provider = review.provider ? `model_provider: ${yamlString(review.provider)}\n` : "";
  const markdown = `---
type: source
bucket: ${bucket}
summary: ${yamlString(summary)}
tags: [${tags.map(yamlInlineValue).join(", ")}]
created: ${today}
updated: ${today}
event_date: ${today}
voice: claude-draft
raw_file: raw/${file.name}
${provider}${reviewedAt}
---

# Source: ${title}

Original file: \`raw/${file.name}\`

${modelReviewMarkdown(review)}
`;

  return {
    id: slug,
    type: "source",
    path,
    slug,
    title,
    summary,
    rawFile: file.name,
    terms,
    entities,
    text: file.text,
    markdown
  };
}

function modelReviewSummary(review) {
  const summary = cleanSummary(review?.summary || "");
  if (summary) return summary;
  const mission = cleanSummary(review?.missionFrame?.oneLine || "");
  if (mission) return mission;
  const takeaway = (review?.takeaways || []).map((item) => cleanSummary(item?.point || "")).find(Boolean);
  if (takeaway) return takeaway;
  const bullet = (review?.summaryBullets || []).map(cleanSummary).find(Boolean);
  return bullet || "";
}

function modelReviewMarkdown(review) {
  const sections = [
    summarySection(review),
    takeawaysSection(review),
    hasFilingPlan(review?.filingPlan) ? formatFilingJudgmentMarkdown(review.filingPlan) : "",
    connectionsSection(review),
    hasFinancialDetails(review?.financialDetails) ? `## Financial Details\n\n${formatFinancialDetailsMarkdown(review.financialDetails)}` : "",
    lightTouchSection(review),
    propagationSection(review),
    discoveriesSection(review),
    questionsSection(review)
  ].map((section) => String(section || "").trim()).filter(Boolean);

  return sections.join("\n\n") || "## Model Review\n\nModel review completed, but no source-page sections were returned.";
}

function summarySection(review) {
  const summary = modelReviewSummary(review);
  const bullets = (review?.summaryBullets || []).map(cleanSummary).filter(Boolean);
  if (!summary && bullets.length === 0) return "";
  return [
    "## Summary",
    "",
    summary,
    bullets.length ? ["", ...bullets.map((item) => `- ${item}`)].join("\n") : ""
  ].filter((part) => part !== "").join("\n");
}

function takeawaysSection(review) {
  const takeaways = (review?.takeaways || [])
    .map((item) => {
      const point = cleanSummary(item?.point || "");
      if (!point) return "";
      const label = cleanSummary(item?.label || item?.relevance || "Takeaway");
      const why = cleanSummary(item?.whyItMatters || "");
      return `- ${label ? `**${label}:** ` : ""}${point}${why ? ` ${why}` : ""}`;
    })
    .filter(Boolean);
  return takeaways.length ? `## Key Takeaways\n\n${takeaways.join("\n")}` : "";
}

function connectionsSection(review) {
  const connections = (review?.connections || []).filter((connection) => (
    connection?.title || connection?.path || connection?.reason
  ));
  return connections.length ? `## Connections\n\n${connections.map(formatConnectionLine).join("\n")}` : "";
}

function lightTouchSection(review) {
  const notes = (review?.lightTouch || [])
    .map((item) => {
      const note = cleanSummary(item?.note || item?.point || item?.text || "");
      const reason = cleanSummary(item?.reason || "");
      return note ? `- ${note}${reason ? ` — ${reason}` : ""}` : "";
    })
    .filter(Boolean);
  return notes.length ? `## Light Touch\n\n${notes.join("\n")}` : "";
}

function propagationSection(review) {
  const updates = (review?.propagation || [])
    .map((item) => {
      const target = cleanSummary(item?.targetPath || item?.path || "");
      const action = cleanSummary(item?.action || "");
      const rationale = cleanSummary(item?.rationale || item?.reason || "");
      const line = [target, action, rationale].filter(Boolean).join(" — ");
      return line ? `- ${line}` : "";
    })
    .filter(Boolean);
  return updates.length ? `## Proposed Propagation\n\n${updates.join("\n")}` : "";
}

function discoveriesSection(review) {
  const discoveries = (review?.discoveries || [])
    .map((item) => {
      const title = cleanSummary(item?.title || item?.kind || "Discovery");
      const detail = cleanSummary(item?.detail || item?.summary || "");
      return detail ? `- ${title ? `${title}: ` : ""}${detail}` : "";
    })
    .filter(Boolean);
  return discoveries.length ? `## Discoveries\n\n${discoveries.join("\n")}` : "";
}

function questionsSection(review) {
  const questions = (review?.questions || [])
    .map((item) => cleanSummary(item?.question || ""))
    .filter(Boolean);
  return questions.length ? `## Open Questions\n\n${questions.map((item) => `- ${item}`).join("\n")}` : "";
}

function buildConceptNodes(sourceNodes, today) {
  const counts = new Map();
  const sourceMap = new Map();

  for (const source of sourceNodes) {
    for (const term of source.terms.slice(0, 7)) {
      const key = term.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!sourceMap.has(key)) sourceMap.set(key, new Set());
      sourceMap.get(key).add(source.slug);
    }
  }

  return [...counts.entries()]
    .filter(([term, count]) => isDurableConceptCandidate(term, count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => {
      const slug = slugify(term);
      const title = titleize(slug);
      const sources = [...sourceMap.get(term)];
      const markdown = `---
type: concept
bucket: concepts
summary: Concept candidate detected across ${count} source mention${count === 1 ? "" : "s"}.
tags: [concept, candidate]
created: ${today}
updated: ${today}
status: stub
voice: claude-draft
key_links: [${sources.map((s) => `"[[${s}]]"`).join(", ")}]
---

# ${title}

## Snapshot
- **What it is:** Concept candidate generated from source files.
- **Why it matters:** It recurs enough to deserve a first-class page if the user confirms it is load-bearing.
- **Related sources:** ${sources.map((s) => `[[${s}]]`).join(", ")}

## Context

This page is a draft. Ask Claude to expand it from cited source nodes before relying on it.
`;
      return {
        id: slug,
        type: "concept",
        slug,
        title,
        summary: `Concept candidate detected across ${count} source mention${count === 1 ? "" : "s"}.`,
        sources,
        markdown
      };
    });
}

function buildEntityNodes(sourceNodes, today) {
  const counts = new Map();
  const sourceMap = new Map();
  for (const source of sourceNodes) {
    for (const entity of source.entities) {
      const key = entity.trim();
      if (!key || PERSON_STOP.has(key)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!sourceMap.has(key)) sourceMap.set(key, new Set());
      sourceMap.get(key).add(source.slug);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([entity, count]) => {
      const slug = slugify(entity);
      const sources = [...sourceMap.get(entity)];
      const markdown = `---
type: entity
bucket: entities
summary: Entity candidate mentioned in ${count} source${count === 1 ? "" : "s"}.
tags: [entity, candidate]
created: ${today}
updated: ${today}
status: stub
priority:
last_contact:
next_move:
firm:
role:
relationship:
category:
contact_channel:
voice: claude-draft
key_links: [${sources.map((s) => `"[[${s}]]"`).join(", ")}]
---

# ${entity}

## Snapshot
- **Role:** _(unknown)_
- **Status:** candidate entity
- **Last interaction:** _(unknown)_
- **Next move:** confirm whether this deserves a first-class page
- **Key link:** ${sources[0] ? `[[${sources[0]}]]` : "_(none)_"}

## Context

This page is a draft. Do not infer role, firm, relationship, or next move without user confirmation.

## Source Log

${sources.map((source) => `- [[${source}]] — Mentioned during ingest; verify the entity's role and status before relying on it.`).join("\n") || "- _(none yet)_"}
`;
      return {
        id: slug,
        type: "entity",
        slug,
        title: entity,
        summary: `Entity candidate mentioned in ${count} source${count === 1 ? "" : "s"}.`,
        sources,
        markdown
      };
    });
}

function buildSynthesisNodes(sourceNodes, conceptNodes, today) {
  const synthesis = [];
  for (const concept of conceptNodes.slice(0, 5)) {
    if (concept.sources.length < 2) continue;
    const title = `${concept.title} across sources`;
    const slug = `synthesis-${concept.slug}-across-sources`;
    const sourceList = concept.sources.map((s) => `[[${s}]]`).join(", ");
    const markdown = `---
type: synthesis
bucket: synthesis
summary: Draft connection-point summary for ${concept.title} across ${concept.sources.length} sources.
tags: [synthesis, connection-point]
created: ${today}
updated: ${today}
voice: claude-draft
source_nodes: [${concept.sources.map((s) => `"[[${s}]]"`).join(", ")}]
concept_nodes: ["[[${concept.slug}]]"]
---

# ${title}

## Connection

${concept.title} appears across ${concept.sources.length} sources: ${sourceList}.

## Claims

- This synthesis node is a draft. Ask Claude to expand it by reading the cited source nodes before relying on it.

## Open Threads

- What is the user trying to understand about this connection?
- Should this remain a synthesis page or become a durable concept page?
`;
    synthesis.push({
      id: slug,
      type: "synthesis",
      slug,
      title,
      summary: `Draft connection-point summary for ${concept.title}.`,
      sources: concept.sources,
      concepts: [concept.slug],
      markdown
    });
  }

  if (synthesis.length === 0 && sourceNodes.length >= 2) {
    const first = sourceNodes.slice(0, 3);
    const slug = "synthesis-first-pass-connections";
    const markdown = `---
type: synthesis
bucket: synthesis
summary: First-pass synthesis across the initial source set.
tags: [synthesis, first-pass]
created: ${today}
updated: ${today}
voice: claude-draft
source_nodes: [${first.map((s) => `"[[${s.slug}]]"`).join(", ")}]
concept_nodes: []
---

# First-pass connections

## Connection

These sources were ingested together and should be reviewed for shared concepts.

## Source Set

${first.map((s) => `- [[${s.slug}]] — ${s.summary}`).join("\n")}
`;
    synthesis.push({
      id: slug,
      type: "synthesis",
      slug,
      title: "First-pass connections",
      summary: "First-pass synthesis across the initial source set.",
      sources: first.map((s) => s.slug),
      concepts: [],
      markdown
    });
  }

  return synthesis;
}

function buildEdges(sourceNodes, conceptNodes, entityNodes, synthesisNodes) {
  const edges = [];
  for (const concept of conceptNodes) {
    for (const source of concept.sources) {
      edges.push({ from: concept.slug, to: source, type: "derived-from" });
    }
  }
  for (const entity of entityNodes) {
    for (const source of entity.sources) {
      edges.push({ from: entity.slug, to: source, type: "mentioned-in" });
    }
  }
  for (const synthesis of synthesisNodes) {
    for (const source of synthesis.sources) {
      edges.push({ from: synthesis.slug, to: source, type: "cites" });
    }
    for (const concept of synthesis.concepts || []) {
      edges.push({ from: synthesis.slug, to: concept, type: "synthesizes" });
    }
  }
  return edges;
}

function buildStructuralLayer({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, edges, editProposals }) {
  const bucketOverviews = buildBucketOverviews({ today, sourceNodes, conceptNodes, entityNodes, synthesisNodes });
  const templates = buildTemplates(today);
  return {
    ingestTracker: buildIngestTracker({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes }),
    log: buildNarrativeLog({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, editProposals }),
    stats: buildWikiStats({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, edges }),
    bucketOverviews,
    templates,
    fileCount: 3 + Object.keys(bucketOverviews).length + Object.keys(templates).length
  };
}

function buildIngestTracker({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes }) {
  const conceptBySource = nodesBySource(conceptNodes);
  const entityBySource = nodesBySource(entityNodes);
  const synthesisBySource = nodesBySource(synthesisNodes);
  const rawByName = new Map(files.map((file) => [file.name, file]));
  const rows = sourceNodes.map((source) => {
    const raw = rawByName.get(source.rawFile) || { name: source.rawFile, wordCount: 0, unsupported: false };
    const connected = [
      ...(conceptBySource.get(source.slug) || []),
      ...(entityBySource.get(source.slug) || []),
      ...(synthesisBySource.get(source.slug) || [])
    ];
    const status = "ingested";
    const notes = "Source page generated from model review.";
    return `| ${tableCell(`raw/${raw.name}`)} | ${status} | [[${source.slug}]] | ${connected.map((node) => `[[${node.slug}]]`).join(", ") || "-"} | ${raw.wordCount} | ${tableCell(notes)} |`;
  }).join("\n");

  return `---
type: tracker
bucket: system
summary: Source-file processing tracker for this Margins vault.
tags: [tracker, ingest, system]
created: ${today}
updated: ${today}
voice: claude-draft
---

# Ingest Tracker

This is the single source of truth for which source files in raw/ have been converted into wiki pages. Update it whenever ingest creates, rewrites, or skips a source.

| Source file | Status | Source page | Connected pages | Words | Notes |
|---|---|---|---|---:|---|
${rows || "| - | - | - | - | 0 | No model-reviewed source pages created yet. |"}

## Status Vocabulary

- ingested: source text was available and a wiki source page exists.
- needs-extraction: the original file is preserved in raw/, but readable text was not available to the compiler.
- skipped: the user intentionally chose not to file this source.
- superseded: a newer source replaced this one as the preferred reference.
`;
}

function buildNarrativeLog({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, editProposals }) {
  return `---
type: log
bucket: system
summary: Human-readable operation log for this Margins vault.
tags: [log, operations, system]
created: ${today}
updated: ${today}
voice: claude-draft
---

# Log

Allowed ops: ingest | query | compile | lint | update

Use headings shaped like \`## [YYYY-MM-DD] ingest\` so agents can grep the log without a plugin.

## [${today}] ingest

- Registered ${files.length} source file${files.length === 1 ? "" : "s"}.
- Created ${sourceNodes.length} source page${sourceNodes.length === 1 ? "" : "s"}, ${conceptNodes.length} concept page${conceptNodes.length === 1 ? "" : "s"}, ${entityNodes.length} entity page${entityNodes.length === 1 ? "" : "s"}, and ${synthesisNodes.length} synthesis page${synthesisNodes.length === 1 ? "" : "s"}.
- Queued ${editProposals.length} proposal${editProposals.length === 1 ? "" : "s"} in \`wiki/.margins/edit-log.jsonl\`.
- Updated \`wiki/ingest-tracker.md\`, bucket overviews, and \`wiki/wiki-stats.md\`.

## Operation Vocabulary

- ingest: source file preservation, source-page creation, propagation, and tracker updates.
- query: user-facing answer from current wiki state.
- compile: backlink, concept, entity, synthesis, and index refresh.
- lint: drift, stale summary, missing citation, and structure health checks.
- update: user-approved content or structure edits.
`;
}

function buildWikiStats({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, edges }) {
  const rawWords = files.reduce((sum, file) => sum + file.wordCount, 0);
  const summaryWords = sourceNodes.reduce((sum, source) => sum + words(source.summary).length, 0);
  const compression = rawWords > 0 ? Math.max(1, Math.round(rawWords / Math.max(1, summaryWords))) : 0;
  const unsupported = files.filter((file) => file.unsupported);
  const fattest = [...files]
    .sort((left, right) => right.wordCount - left.wordCount || left.name.localeCompare(right.name))
    .slice(0, 8);

  return `---
type: dashboard
bucket: system
summary: Structural health dashboard for this Margins vault.
tags: [stats, lint, drift, system]
created: ${today}
updated: ${today}
voice: claude-draft
---

# Wiki Stats

Generated: ${today}

## Shape

- Source files: ${files.length}
- Source pages: ${sourceNodes.length}
- Concept pages: ${conceptNodes.length}
- Entity pages: ${entityNodes.length}
- Synthesis pages: ${synthesisNodes.length}
- Graph edges: ${edges.length}

## Compression

- Source words available: ${rawWords}
- Source-summary words: ${summaryWords}
- Approximate compression: ${compression ? `${compression}:1` : "n/a"}

## Drift Watch

- Summary freshness: new vault pass; no stale summaries detected at generation time.
- Extraction gaps: ${unsupported.length}
- Review rule: if a summary is older than the sources it represents, refresh it before answering from memory.

## Largest Source Files

${fattest.map((file) => `- \`raw/${file.name}\` — ${file.wordCount} words${file.unsupported ? " (needs extraction)" : ""}`).join("\n") || "- _(none)_"}

## Maintenance Checks

- Run compile after new ingest batches to promote repeated concepts and backlink gaps.
- Run lint when source pages grow faster than summaries.
- Prefer fixing the tracker and log before adding more generated pages.
`;
}

function buildBucketOverviews({ today, sourceNodes, conceptNodes, entityNodes, synthesisNodes }) {
  return {
    "wiki/sources/sources.md": bucketOverview({
      today,
      title: "Sources",
      bucket: "sources",
      summary: "Entry point for source-file-derived pages.",
      description: "Source pages are faithful reads of one preserved original file. They should cite the source file and avoid unsupported synthesis.",
      nodes: sourceNodes
    }),
    "wiki/concepts/concepts.md": bucketOverview({
      today,
      title: "Concepts",
      bucket: "concepts",
      summary: "Entry point for durable reusable ideas.",
      description: "Concept pages should exist only when an idea will help future retrieval across more than one source or workflow.",
      nodes: conceptNodes
    }),
    "wiki/entities/entities.md": bucketOverview({
      today,
      title: "Entities",
      bucket: "entities",
      summary: "Entry point for people, organizations, places, tools, accounts, and projects.",
      description: "Entity pages need snapshots and source logs. Do not fill roles, relationships, or next moves without evidence or user confirmation.",
      nodes: entityNodes
    }),
    "wiki/synthesis/synthesis.md": bucketOverview({
      today,
      title: "Synthesis",
      bucket: "synthesis",
      summary: "Entry point for connection-point summaries across sources.",
      description: "Synthesis pages connect sources and concepts. Keep them labeled as synthesis unless the user confirms them as settled knowledge.",
      nodes: synthesisNodes
    })
  };
}

function bucketOverview({ today, title, bucket, summary, description, nodes }) {
  return `---
type: index
bucket: ${bucket}
summary: ${yamlString(summary)}
tags: [index, ${bucket}]
created: ${today}
updated: ${today}
voice: claude-draft
---

# ${title}

${description}

## Pages

${nodes.map((node) => `- [[${node.slug}]] — ${node.summary}`).join("\n") || "- _(none yet)_"}

## Maintenance

- Keep this overview short enough for an agent to scan first.
- Add only pages that belong in \`${bucket}/\`.
- Update summaries when underlying source pages change.
`;
}

function buildTemplates(today) {
  return {
    source: `---
type: source
bucket: sources
summary:
tags: [source]
created: ${today}
updated: ${today}
event_date:
voice: claude-draft
raw_file:
---

# Source: Title

Original file: \`raw/example.md\`

## Summary

## Context

## Concrete Facts

## Related Pages

## Mentioned but Missing

## Inferences Refused
`,
    entity: `---
type: entity
bucket: entities
summary:
tags: [entity]
created: ${today}
updated: ${today}
status: stub
priority:
last_contact:
next_move:
firm:
role:
relationship:
category:
contact_channel:
voice: claude-draft
key_links: []
---

# Entity Name

## Snapshot
- **Role:** _(unknown)_
- **Status:** _(unknown)_
- **Last interaction:** _(unknown)_
- **Next move:** _(unknown)_
- **Key link:** _(none)_

## Context

## Source Log

- [[source-slug]] — one-line note about what this source established.
`,
    concept: `---
type: concept
bucket: concepts
summary:
tags: [concept]
created: ${today}
updated: ${today}
status: stub
voice: claude-draft
key_links: []
---

# Concept Name

## Snapshot
- **What it is:**
- **Why it matters:**
- **Related sources:**

## Context

## Source Log
`,
    synthesis: `---
type: synthesis
bucket: synthesis
summary:
tags: [synthesis]
created: ${today}
updated: ${today}
voice: claude-draft
source_nodes: []
concept_nodes: []
---

# Synthesis Title

## Connection

## Claims

## Evidence

## Open Threads
`,
    meeting: `---
type: source
bucket: sources
summary:
tags: [source, meeting]
created: ${today}
updated: ${today}
event_date:
voice: claude-draft
raw_file:
participants: []
---

# Meeting: Title

## Summary

## Decisions

## Follow-ups

## People and Organizations

## Inferences Refused
`,
    daily: `---
type: log
bucket: daily
summary:
tags: [daily, log]
created: ${today}
updated: ${today}
event_date: ${today}
voice: claude-draft
---

# ${today}

## What Changed

## Decisions

## Quick Notes

## Sources
`
  };
}

function nodesBySource(nodes) {
  const map = new Map();
  for (const node of nodes) {
    for (const source of node.sources || []) {
      if (!map.has(source)) map.set(source, []);
      map.get(source).push(node);
    }
  }
  return map;
}

function tableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildOperatingLayer(today) {
  return {
    claudeMd: `# CLAUDE.md

This file is the agent operating skeleton for a Margins vault. Treat it as the first file to read when an LLM opens the vault.

## Mission

Maintain a local-first, source-grounded wiki that compounds over time. Original files in raw/ are evidence. Wiki pages are the navigable memory layer. Generated drafts must stay labeled until a user confirms them.

## First Files To Read

1. \`wiki/index.md\` for the map.
2. \`wiki/ingest-tracker.md\` to see what source files have been filed.
3. \`wiki/log.md\` for recent operations.
4. \`wiki/wiki-stats.md\` for drift, extraction gaps, and oversized sources.
5. \`operator-manual.md\` and \`query-cookbook.md\` for detailed operating rules.

## Closed-Set Operation Vocabulary

Use these words in \`wiki/log.md\` headings: ingest | query | compile | lint | update.

## Authorship And Voice

- \`voice: claude-draft\` means model-written or model-shaped content that may need review.
- Ask before inferring roles, relationships, motives, priorities, dates, money, or next moves.
- Put uncertain model reasoning in synthesis sections or clearly labeled notes.
- Preserve source paths in raw/ and cite durable wiki links, not chat-only references.

## Buckets

- \`wiki/sources/\`: faithful source pages tied to one original file.
- \`wiki/concepts/\`: durable ideas that should help future retrieval.
- \`wiki/entities/\`: people, organizations, places, tools, accounts, and projects.
- \`wiki/synthesis/\`: connection-point summaries across multiple pages.
- \`wiki/_templates/\`: page shapes and examples for future ingest.

## Query Patterns

- Have we processed a file? Search \`wiki/ingest-tracker.md\` for its filename in raw/.
- What changed? Read the latest \`## [date] op\` section in \`wiki/log.md\`.
- Is a summary stale? Check \`wiki/wiki-stats.md\`, then compare source pages with overview pages.
- What supports this claim? Follow source links from the relevant concept/entity/synthesis page.

## Write-Back Rules

Never silently change important structure. Propose edits first unless the user explicitly approves saving. When updating a page, also update any affected tracker, log, bucket overview, source log, and stats file.

Generated ${today}.`,
    operatorManual: `# Operator Manual

## Mission

Maintain an LLM-operable wiki from source files. Preserve evidence, create useful knowledge nodes, and make Claude/ChatGPT better without pretending to be the chat surface.

## Rules

1. Original source files are evidence. Never mutate \`raw/\`.
2. The wiki is the compounding layer. Source, concept, entity, synthesis, tracker, log, stats, and bucket overview pages can evolve.
3. Cite or label. Every factual claim must cite a source node or be marked as synthesis.
4. Ask before inferring roles, motives, relationships, numbers, dates, or next moves.
5. Write-back is proposal-first. Do not silently mutate important structure.
6. Use concise summaries and frontmatter so the model can retrieve cheaply.
7. If the wiki does not have the answer, say so and propose what source to ingest.

## Page Types

- source: faithful summary of one original file
- concept: durable theme or idea
- entity: person, organization, place, project, tool
- synthesis: connection-point summary across nodes
- tracker: source-file processing state
- log: human-readable operation history
- dashboard: structural health and drift view

Generated ${today}.`,
    queryCookbook: `# Query Cookbook

## Summarize the vault

Read \`CLAUDE.md\`, \`wiki/index.md\`, \`wiki/ingest-tracker.md\`, and \`wiki/wiki-stats.md\`, then inspect the top source, concept, entity, and synthesis nodes.

## Answer a question

1. Search source, concept, entity, and synthesis summaries.
2. Read only the relevant nodes.
3. Cite source nodes for factual claims.
4. Mark unsourced reasoning as synthesis.

## Check whether a file was ingested

Search \`wiki/ingest-tracker.md\` for the filename in raw/. If the tracker is missing or stale, scan \`wiki/sources/\` for matching \`raw_file:\` frontmatter and then update the tracker.

## Find what changed

Scan \`wiki/log.md\` first, then recently updated nodes and \`wiki/.margins/edit-log.jsonl\`.

## Check wiki health

Read \`wiki/wiki-stats.md\`. Pay special attention to extraction gaps, stale summaries, oversized sources, and bucket overviews that no longer match their folders.

## Propose an improvement

Return a structured edit proposal with: operation, target, rationale, citations, and preview diff.

## Check a claim

Find supporting source nodes. If none exist, say "not supported by the current wiki."`,
    commands: {
      "ingest": command("ingest", "Turn source files into source notes, candidates, links, and citations."),
      "compile": command("compile", "Find backlink gaps, concept candidates, entity candidates, and synthesis opportunities."),
      "query": command("query", "Answer from wiki nodes with citations and optional synthesis filing."),
      "lint": command("lint", "Check stale pages, orphan nodes, missing citations, and operator-manual violations."),
      "propose-edit": command("propose-edit", "Return a structured wiki edit proposal. Never apply silently."),
      "apply-edit": command("apply-edit", "Apply a user-approved edit and append the result to wiki/.margins/edit-log.jsonl."),
      "export": command("export", "Package source files, wiki, operating layer, graph, and manifest for migration.")
    },
    agents: {
      "wiki-ingest": agent("wiki-ingest", "Conservatively process source files into source notes and candidates."),
      "wiki-compiler": agent("wiki-compiler", "Derive candidate links, concepts, entities, and synthesis nodes."),
      "wiki-query": agent("wiki-query", "Answer questions from the wiki using source-grounded citations."),
      "wiki-editor": agent("wiki-editor", "Propose structured edits and diffs without silent mutation."),
      "source-auditor": agent("source-auditor", "Check whether a claim is supported by source-file citations.")
    }
  };
}

function command(name, purpose) {
  return `# /${name}

Purpose: ${purpose}

## Behavior

- Read \`CLAUDE.md\` first if present.
- Follow \`operator-manual.md\`.
- Prefer source-cited facts.
- Mark synthesis clearly.
- Ask before inference when trust matters.
- Keep \`wiki/ingest-tracker.md\`, \`wiki/log.md\`, \`wiki/wiki-stats.md\`, and bucket overviews consistent with any approved write.
- If writing is required, produce an edit proposal unless the user has explicitly approved applying it.
`;
}

function agent(name, purpose) {
  return `# Agent: ${name}

Purpose: ${purpose}

## Instructions

Read \`CLAUDE.md\` and \`operator-manual.md\` before acting. Use \`query-cookbook.md\` for retrieval patterns. Check \`wiki/ingest-tracker.md\` and \`wiki/log.md\` before deciding whether a source is new. Return concise, cited output. Do not silently mutate the wiki.
`;
}

function buildEditProposals(concepts, entities, synthesis, today) {
  const proposals = [];
  for (const concept of concepts.slice(0, 4)) {
    proposals.push({
      id: `proposal-${proposals.length + 1}`,
      created_at: `${today}T00:00:00.000Z`,
      operation: "review_concept_candidate",
      target: `wiki/concepts/${concept.slug}.md`,
      title: `Review concept: ${concept.title}`,
      rationale: `This concept appeared in ${concept.sources.length} source node${concept.sources.length === 1 ? "" : "s"}.`,
      citations: concept.sources,
      status: "proposed"
    });
  }
  for (const entity of entities.slice(0, 3)) {
    proposals.push({
      id: `proposal-${proposals.length + 1}`,
      created_at: `${today}T00:00:00.000Z`,
      operation: "confirm_entity_candidate",
      target: `wiki/entities/${entity.slug}.md`,
      title: `Confirm entity: ${entity.title}`,
      rationale: "Entity candidates should not receive roles, relationships, or next moves without user confirmation.",
      citations: entity.sources,
      status: "proposed"
    });
  }
  for (const node of synthesis.slice(0, 3)) {
    proposals.push({
      id: `proposal-${proposals.length + 1}`,
      created_at: `${today}T00:00:00.000Z`,
      operation: "expand_synthesis_node",
      target: `wiki/synthesis/${node.slug}.md`,
      title: `Expand synthesis: ${node.title}`,
      rationale: "Connection-point summaries are the core compounding layer.",
      citations: node.sources,
      status: "proposed"
    });
  }
  return proposals;
}

function buildIngestReport({
  today,
  files,
  sourceNodes,
  conceptNodes,
  entityNodes,
  candidateConcepts = conceptNodes,
  candidateEntities = entityNodes,
  synthesisNodes,
  edges,
  editProposals
}) {
  const unsupported = files.filter((file) => file.unsupported);
  const lowText = files.filter((file) => !file.unsupported && file.wordCount < 20);
  return `# Ingest Report

Generated: ${today}
Compiler: model review

## Summary

- Source files registered: ${files.length}
- Source pages created: ${sourceNodes.length}
- Concept pages created: ${conceptNodes.length}
- Entity pages created: ${entityNodes.length}
- Report-only concept candidates: ${candidateConcepts.length}
- Report-only entity candidates: ${candidateEntities.length}
- Synthesis pages created: ${synthesisNodes.length}
- Graph edges created: ${edges.length}
- Edit proposals queued: ${editProposals.length}

## Files Created

${sourceNodes.map((source) => `- wiki/sources/${source.slug}.md from raw/${source.rawFile}`).join("\n") || "- _(none)_"}

## Candidate Concepts

${candidateConcepts.map(candidateReportLine).join("\n") || "- _(none)_"}

## Candidate Entities

${candidateEntities.map(candidateReportLine).join("\n") || "- _(none)_"}

## Mentioned But Missing

${[
  ...candidateConcepts.map((concept) => `- Concept: ${concept.title} (${concept.sources.map((source) => `[[${source}]]`).join(", ")})`),
  ...candidateEntities.map((entity) => `- Entity: ${entity.title} (${entity.sources.map((source) => `[[${source}]]`).join(", ")})`)
].join("\n") || "- _(none)_"}

## Inferences Refused

- Local heuristic concept/entity detections remain report-only candidates until a user or model explicitly promotes them.
- Entity roles, relationships, priorities, and next moves require user confirmation.
- Concept pages should be created only when they are useful durable retrieval surfaces across future sources.
- Source pages are emitted only for files with a completed model review.

## Needs Review

${[
  ...unsupported.map((file) => `- Extract text from raw/${file.name} before relying on its summary.`),
  ...lowText.map((file) => `- Add more text to raw/${file.name}; only ${file.wordCount} words were available.`),
  ...(editProposals.length > 0 ? [`- Review ${editProposals.length} proposed edit${editProposals.length === 1 ? "" : "s"} in wiki/.margins/edit-log.jsonl.`] : [])
].join("\n") || "- No immediate review flags."}
`;
}

function candidateReportLine(candidate) {
  const sources = candidate.sources?.length
    ? candidate.sources.map((source) => `[[${source}]]`).join(", ")
    : "_(no source links)_";
  return `- ${candidate.title} from ${candidate.sources?.length || 0} source node${candidate.sources?.length === 1 ? "" : "s"}: ${sources}`;
}

function buildIndex(vault) {
  return `---
type: index
bucket: index
summary: Generated index for this Margins vault.
tags: [index]
created: ${vault.manifest.generated_at.slice(0, 10)}
updated: ${vault.manifest.generated_at.slice(0, 10)}
voice: claude-draft
---

# Wiki Index

Generated by Margins.

## Operating Map

- [[ingest-tracker]] — source-file processing status
- [[log]] — human-readable operation history
- [[wiki-stats]] — drift, extraction, and size dashboard
- [[sources]] — source bucket overview
- [[concepts]] — concept bucket overview
- [[entities]] — entity bucket overview
- [[synthesis]] — synthesis bucket overview

## Sources

${vault.wiki.sources.map((s) => `- [[${s.slug}]] — ${s.summary}`).join("\n") || "- _(none)_"}

## Concepts

${vault.wiki.concepts.map((c) => `- [[${c.slug}]] — ${c.summary}`).join("\n") || "- _(none)_"}

## Entities

${vault.wiki.entities.map((e) => `- [[${e.slug}]] — ${e.summary}`).join("\n") || "- _(none)_"}

## Synthesis

${vault.wiki.synthesis.map((s) => `- [[${s.slug}]] — ${s.summary}`).join("\n") || "- _(none)_"}
`;
}

function toGraphNode(node) {
  return {
    id: node.slug,
    type: node.type,
    title: node.title,
    summary: node.summary
  };
}

function topTerms(text, limit = 10) {
  const counts = new Map();
  const clean = stripMarkdownNoise(text).toLowerCase();
  for (const phrase of CONCEPT_PHRASES) {
    const matches = clean.match(new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "[-\\s]+")}\\b`, "g")) || [];
    if (matches.length > 0) counts.set(phrase.replace(/\s+/g, "-"), matches.length + 1);
  }
  for (const word of words(clean)) {
    const lower = word.toLowerCase();
    if (
      lower.length < 4 ||
      STOP_WORDS.has(lower) ||
      LOW_QUALITY_CONCEPTS.has(lower) ||
      /^\d+$/.test(lower)
    ) continue;
    counts.set(lower, (counts.get(lower) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || conceptRank(b[0]) - conceptRank(a[0]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function extractEntities(text) {
  const matches = stripMarkdownNoise(text).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || [];
  const counts = new Map();
  for (const match of matches) {
    const normalized = match.trim();
    const lower = normalized.toLowerCase();
    if (!isEntityCandidate(normalized)) continue;
    if (normalized.split(/\s+/).length > 2 && firstWord(normalized) === lastWord(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function isDurableConceptCandidate(term, sourceCount) {
  const normalized = String(term || "").toLowerCase();
  if (!normalized) return false;
  if (LOW_QUALITY_CONCEPTS.has(normalized) || STOP_WORDS.has(normalized)) return false;
  if (normalized.includes("-")) return sourceCount >= 1;
  return sourceCount >= 2 && DURABLE_SINGLE_CONCEPTS.has(normalized);
}

function isEntityCandidate(value) {
  const normalized = String(value || "").trim();
  const lower = normalized.toLowerCase();
  const parts = normalized.split(/\s+/);
  if (!normalized || PERSON_STOP.has(normalized)) return false;
  if (STOP_WORDS.has(lower) || LOW_QUALITY_CONCEPTS.has(lower) || ENTITY_STOP_LOWER.has(lower)) return false;
  if (parts.some((part) => PERSON_STOP.has(part))) return false;
  if (parts.length > 3) return false;
  if (parts.length === 1 && !/^[A-Z][A-Za-z0-9]+$/.test(normalized)) return false;
  return true;
}

function conceptRank(term) {
  return String(term || "").includes("-") ? 1 : 0;
}

function words(text) {
  return (text.toLowerCase().match(/[a-zA-Z][a-zA-Z'-]+/g) || []);
}

function stripMarkdownNoise(text) {
  return String(text || "")
    .replace(/^---[\s\S]*?---/m, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/gm, " ");
}

function firstWord(value) {
  return String(value || "").split(/\s+/)[0] || "";
}

function lastWord(value) {
  const parts = String(value || "").split(/\s+/);
  return parts[parts.length - 1] || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerpt(text, max) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}...`;
}

function isProbablyUnsupported(name, text) {
  return /\.(pdf|docx)$/i.test(name) && (!text || text.length < 20);
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleize(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function yamlString(value) {
  return JSON.stringify(String(value || "").replace(/\n/g, " "));
}

function yamlInlineValue(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_/-]+$/.test(text) ? text : yamlString(text);
}
