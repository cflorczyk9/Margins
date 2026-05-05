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
  "raw sources",
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
  "raw sources",
  "source nodes",
  "concept nodes",
  "entity nodes",
  "synthesis nodes",
  "query cookbook",
  "operator manual",
  "markdown instructions"
]);

export function compileVault(files, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const normalized = files.map((file, index) => normalizeFile(file, index));
  const sourceNodes = normalized.map((file) => buildSourceNode(file, today));
  const conceptNodes = buildConceptNodes(sourceNodes, today);
  const entityNodes = buildEntityNodes(sourceNodes, today);
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
  const manifest = {
    name: options.name || "Karpathy Original",
    schema_version: "margins-v1",
    template: "karpathy-original",
    compiler: "local-heuristic",
    version: "0.1.0",
    generated_at: `${today}T00:00:00.000Z`,
    privacy: {
      storage: "local-first",
      hosted_documents: false,
      silent_write_back: false,
      requires_secrets: false
    },
    paths: {
      raw_sources: "raw_sources/",
      wiki: "wiki/",
      metadata: "wiki/.margins/",
      commands: "commands/",
      agents: "agents/"
    },
    counts: {
      raw_sources: normalized.length,
      source_nodes: sourceNodes.length,
      concept_nodes: conceptNodes.length,
      entity_nodes: entityNodes.length,
      synthesis_nodes: synthesisNodes.length,
      edges: edges.length
    },
    raw_sources: normalized.map((file) => ({
      id: file.id,
      path: `raw_sources/${file.name}`,
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
      graph
    },
    operatingLayer,
    editProposals,
    ingestReport: buildIngestReport({
      today,
      files: normalized,
      sourceNodes,
      conceptNodes,
      entityNodes,
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
    files.set(`wiki/sources/${source.slug}.md`, source.markdown);
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
  files.set("wiki/graph.json", JSON.stringify(vault.wiki.graph, null, 2));
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

function buildSourceNode(file, today) {
  const title = titleize(file.slug);
  const summary = summarize(file.text, file.unsupported);
  const terms = topTerms(file.text, 10);
  const entities = extractEntities(file.text).slice(0, 8);
  const slug = `source-${file.slug}`;
  const markdown = `---
type: source
bucket: sources
summary: ${yamlString(summary)}
tags: [source, raw-source]
created: ${today}
updated: ${today}
event_date: ${today}
voice: claude-draft
raw_file: raw_sources/${file.name}
---

# Source: ${title}

Raw file: \`raw_sources/${file.name}\`

## Summary

${summary}

## Key Terms

${terms.map((term) => `- [[${slugify(term)}|${term}]]`).join("\n") || "- _(none detected)_"}

## Entity Candidates

${entities.map((entity) => `- [[${slugify(entity)}|${entity}]]`).join("\n") || "- _(none detected)_"}

## Notes

${file.unsupported ? "This file appears to need text extraction before high-quality ingest." : excerpt(file.text, 900)}
`;

  return {
    id: slug,
    type: "source",
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
- **What it is:** Concept candidate generated from raw sources.
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

function buildOperatingLayer(today) {
  return {
    operatorManual: `# Operator Manual

## Mission

Maintain an LLM-operable wiki from raw sources. Preserve evidence, create useful knowledge nodes, and make Claude/ChatGPT better without pretending to be the chat surface.

## Rules

1. Raw sources are evidence. Never mutate \`raw_sources/\`.
2. The wiki is the compounding layer. Source, concept, entity, and synthesis nodes can evolve.
3. Cite or label. Every factual claim must cite a source node or be marked as synthesis.
4. Ask before inferring roles, motives, relationships, numbers, dates, or next moves.
5. Write-back is proposal-first. Do not silently mutate important structure.
6. Use concise summaries and frontmatter so the model can retrieve cheaply.
7. If the wiki does not have the answer, say so and propose what source to ingest.

## Page Types

- source: faithful summary of one raw file
- concept: durable theme or idea
- entity: person, organization, place, project, tool
- synthesis: connection-point summary across nodes

Generated ${today}.`,
    queryCookbook: `# Query Cookbook

## Summarize the vault

Read \`wiki/index.md\`, then inspect the top source, concept, and synthesis nodes.

## Answer a question

1. Search source, concept, entity, and synthesis summaries.
2. Read only the relevant nodes.
3. Cite source nodes for factual claims.
4. Mark unsourced reasoning as synthesis.

## Find what changed

Scan recently updated nodes and the edit log.

## Propose an improvement

Return a structured edit proposal with: operation, target, rationale, citations, and preview diff.

## Check a claim

Find supporting source nodes. If none exist, say "not supported by the current wiki."`,
    commands: {
      "ingest": command("ingest", "Turn raw sources into source notes, candidates, links, and citations."),
      "compile": command("compile", "Find backlink gaps, concept candidates, entity candidates, and synthesis opportunities."),
      "query": command("query", "Answer from wiki nodes with citations and optional synthesis filing."),
      "lint": command("lint", "Check stale pages, orphan nodes, missing citations, and operator-manual violations."),
      "propose-edit": command("propose-edit", "Return a structured wiki edit proposal. Never apply silently."),
      "apply-edit": command("apply-edit", "Apply a user-approved edit and append the result to wiki/.margins/edit-log.jsonl."),
      "export": command("export", "Package raw sources, wiki, operating layer, graph, and manifest for migration.")
    },
    agents: {
      "wiki-ingest": agent("wiki-ingest", "Conservatively ingest raw sources into source notes and candidates."),
      "wiki-compiler": agent("wiki-compiler", "Derive candidate links, concepts, entities, and synthesis nodes."),
      "wiki-query": agent("wiki-query", "Answer questions from the wiki using source-grounded citations."),
      "wiki-editor": agent("wiki-editor", "Propose structured edits and diffs without silent mutation."),
      "source-auditor": agent("source-auditor", "Check whether a claim is supported by raw source citations.")
    }
  };
}

function command(name, purpose) {
  return `# /${name}

Purpose: ${purpose}

## Behavior

- Follow \`operator-manual.md\`.
- Prefer source-cited facts.
- Mark synthesis clearly.
- Ask before inference when trust matters.
- If writing is required, produce an edit proposal unless the user has explicitly approved applying it.
`;
}

function agent(name, purpose) {
  return `# Agent: ${name}

Purpose: ${purpose}

## Instructions

Read \`operator-manual.md\` before acting. Use \`query-cookbook.md\` for retrieval patterns. Return concise, cited output. Do not silently mutate the wiki.
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

function buildIngestReport({ today, files, sourceNodes, conceptNodes, entityNodes, synthesisNodes, edges, editProposals }) {
  const unsupported = files.filter((file) => file.unsupported);
  const lowText = files.filter((file) => !file.unsupported && file.wordCount < 20);
  return `# Ingest Report

Generated: ${today}
Compiler: local heuristic

## Summary

- Raw sources registered: ${files.length}
- Source pages created: ${sourceNodes.length}
- Concept candidates created: ${conceptNodes.length}
- Entity candidates created: ${entityNodes.length}
- Synthesis pages created: ${synthesisNodes.length}
- Graph edges created: ${edges.length}
- Edit proposals queued: ${editProposals.length}

## Files Created

${sourceNodes.map((source) => `- wiki/sources/${source.slug}.md from raw_sources/${source.rawFile}`).join("\n") || "- _(none)_"}

## Candidate Concepts

${conceptNodes.map((concept) => `- [[${concept.slug}]] from ${concept.sources.length} source node${concept.sources.length === 1 ? "" : "s"}`).join("\n") || "- _(none)_"}

## Candidate Entities

${entityNodes.map((entity) => `- [[${entity.slug}]] from ${entity.sources.length} source node${entity.sources.length === 1 ? "" : "s"}`).join("\n") || "- _(none)_"}

## Inferences Refused

- Entity pages remain candidates. Roles, relationships, priorities, and next moves require user confirmation.
- Concept pages are stubs until a model or user expands them from cited source nodes.
- Unsupported or low-text files are not summarized beyond registration.

## Needs Review

${[
  ...unsupported.map((file) => `- Extract text from raw_sources/${file.name} before relying on its summary.`),
  ...lowText.map((file) => `- Add more text to raw_sources/${file.name}; only ${file.wordCount} words were available.`),
  ...(editProposals.length > 0 ? [`- Review ${editProposals.length} proposed edit${editProposals.length === 1 ? "" : "s"} in wiki/.margins/edit-log.jsonl.`] : [])
].join("\n") || "- No immediate review flags."}
`;
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

function summarize(text, unsupported) {
  if (unsupported) return "Raw source registered, but text extraction is needed before high-quality summarization.";
  const clean = stripMarkdownNoise(text).replace(/\s+/g, " ").trim();
  if (!clean) return "Empty source. Add text before ingesting.";
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return excerpt(sentences.slice(0, 2).join(" "), 280);
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
