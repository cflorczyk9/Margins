// LLM view ("LLM" tab) — copy-prompt buttons + LLM-tab-only prompt
// builders + the orchestrator that accepts model-returned files into
// the vault.
//
// Phase 5 of the module-split refactor. Pulls the four LLM-tab click
// handlers (copyLlmIngestPrompt, copyLlmRepairPrompt,
// copyReviewResponsePrompt, acceptLlmFiles), the three LLM-tab-only
// prompt builders (buildLlmIngestPrompt, buildLlmRepairPrompt,
// buildReviewResponsePrompt), and their pure-helper cluster
// (wikiSchemaPack, serializeVaultContext, serializeLlmFiles,
// serializeReviewQuestions, truncateForPrompt, hasVaultWikiContent,
// shouldIncludeInVaultContext, contextPathRank) out of app.js.
//
// Out of scope (stays in app.js):
//   - buildApiQuestionPrompt, buildApiIngestReviewPrompt — those are
//     ingest-pipeline prompts, not LLM-tab prompts.
//   - operatingContextForPrompt, wikiContextForIngestPrompt,
//     sourceTextForModelPrompt — also ingest-pipeline.
//   - mergeFileMaps, validateLlmFiles — shared utilities used outside
//     the LLM tab.
//
// External shape required from the host (set via initLlmView):
//   els: { llmInput, llmBtn, repairLlmBtn, reviewReply,
//          reviewResponseBtn, acceptLlmBtn, llmStatus, exportBtn,
//          copyBtn, llmPreviewTitle, llmPreviewBody, llmFileList }
//   callbacks: {
//     activateTab, renderLlmReview, renderChangePreview,
//     renderWikiFiles, renderOperatingLayer,
//     renderAcceptedLlmEditState, drawGraph, graphFromFileMap,
//     updateWorkflowState, updateSaveButtonState,
//     updateReviewResponseState, withBusyOperation, mergeFileMaps,
//     validateLlmFiles
//   }
//
// `serializeVaultContext` is also called from outside the LLM tab
// (the vault-export / dream-context path in app.js), so it is
// re-exported here and re-imported by app.js.

import { state } from "../core/state.js";
import { reviewModeLabel } from "../core/api.js";
import {
  frontmatterFields,
  isBucketOverviewPath,
  isContextWikiPagePath,
  isFolderIndexPath,
  isWikiPagePath
} from "../core/wiki.js";

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks)
// ---------------------------------------------------------------------

let els = null;
let callbacks = {};

export function initLlmView(deps) {
  els = deps.els;
  callbacks = deps.callbacks || {};
}

// ---------------------------------------------------------------------
// Click handlers — wired by app.js to els.llmBtn / els.repairLlmBtn /
// els.reviewResponseBtn / els.acceptLlmBtn.
// ---------------------------------------------------------------------

export async function copyLlmIngestPrompt() {
  if (state.files.length === 0) return;
  await navigator.clipboard.writeText(buildLlmIngestPrompt(state.files, state.currentFileMap));
  state.llmPromptCopied = true;
  els.llmBtn.textContent = "Copied";
  setTimeout(() => { els.llmBtn.textContent = "Copy LLM process prompt"; }, 1100);
  callbacks.activateTab?.("llm");
  els.llmInput.focus();
  callbacks.updateWorkflowState?.();
}

export async function copyLlmRepairPrompt() {
  if (state.llmFiles.size === 0) return;
  await navigator.clipboard.writeText(buildLlmRepairPrompt(state.llmFiles));
  els.repairLlmBtn.textContent = "Copied";
  setTimeout(() => { els.repairLlmBtn.textContent = "Copy repair prompt"; }, 1100);
  callbacks.activateTab?.("llm");
  callbacks.updateWorkflowState?.();
}

export async function copyReviewResponsePrompt() {
  const reply = els.reviewReply.value.trim();
  if (state.llmFiles.size === 0 || !reply) return;
  await navigator.clipboard.writeText(buildReviewResponsePrompt(
    state.llmFiles,
    state.currentMaterialQuestions,
    reply,
    state.reviewMode
  ));
  els.reviewResponseBtn.textContent = "Copied";
  setTimeout(() => { els.reviewResponseBtn.textContent = "Copy review response prompt"; }, 1100);
  callbacks.activateTab?.("llm");
  callbacks.updateWorkflowState?.();
}

// Orchestrator — merges model-returned files into the current vault
// and resets the LLM-tab review surface. All renders/draws come from
// callbacks because they live across multiple modules.
export function acceptLlmFiles() {
  if (state.llmFiles.size === 0) return false;
  const acceptedCount = state.llmFiles.size;
  state.vault = null;
  state.currentFileMap = callbacks.mergeFileMaps(state.currentFileMap, state.llmFiles);
  state.selectedPath = null;
  state.hasSavedCurrent = false;
  state.pendingSave = true;
  state.llmFiles = new Map();
  state.currentMaterialQuestions = [];
  callbacks.renderWikiFiles?.(state.currentFileMap);
  callbacks.renderOperatingLayer?.(state.currentFileMap);
  callbacks.renderAcceptedLlmEditState?.();
  if (callbacks.drawGraph && callbacks.graphFromFileMap) {
    callbacks.drawGraph(callbacks.graphFromFileMap(state.currentFileMap));
  }
  callbacks.renderChangePreview?.();
  els.exportBtn.disabled = false;
  callbacks.updateSaveButtonState?.();
  els.acceptLlmBtn.disabled = true;
  els.repairLlmBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.llmStatus.textContent = `Accepted ${acceptedCount} returned file${acceptedCount === 1 ? "" : "s"} into the current wiki. Save to write the vault.`;
  callbacks.activateTab?.("wiki");
  callbacks.updateWorkflowState?.();
  return true;
}

// ---------------------------------------------------------------------
// Prompt builders (LLM-tab-only)
// ---------------------------------------------------------------------

export function buildLlmIngestPrompt(files, existingFileMap = null) {
  const textFiles = files.filter((file) => file.text.trim());
  const attachmentFiles = files.filter((file) => !file.text.trim());
  const attachmentList = attachmentFiles.map((file) => `- ${file.name}`).join("\n") || "- none";
  const sourceBlocks = textFiles.map((file) => (
    `## Source: ${file.name}\n\n${file.text.trim()}`
  )).join("\n\n---\n\n") || "_No extracted text sources were available._";
  const incremental = existingFileMap && hasVaultWikiContent(existingFileMap);
  const existingVaultContext = incremental
    ? `\n\nCurrent vault context:\nThe following files already exist in the user's vault. Treat them as the current wiki state. Preserve them unless the new source requires a specific update.\n\n${serializeVaultContext(existingFileMap)}`
    : "";
  const outputMode = incremental
    ? `This is an incremental ingest into an existing vault. Return only files that should be created or replaced. Margins will merge returned files into the current vault. Include wiki/index.md, wiki/.margins/manifest.json, wiki/.margins/ingest-report.md, wiki/.margins/edit-log.jsonl, and any existing concept/entity/synthesis/source pages only if they need updates. Do not return unchanged files.`
    : `This is a fresh ingest. Return the complete starter file set for the vault.`;

  return `You are operating Margins, a local-first personal wiki compiler.

Goal:
Turn source files into a useful wiki, not a chat transcript and not a generic file organizer. Preserve originals in raw/ as evidence. Create source pages first, then only create durable concept/entity/synthesis pages when the source material actually supports them.

Mode:
${outputMode}

Use this operating context as law:

${wikiSchemaPack()}
${existingVaultContext}

The model behavior should match this operating philosophy:
- The wiki is the user's external memory. Correct recall matters more than producing many nodes.
- Source pages are faithful direct reads. Synthesis is allowed only when labeled.
- The best graph is conservative: fewer true links beat many weak links.
- Do not infer silently. If a relationship, role, date, amount, intent, next move, or strategic implication is not a direct read, flag it as an open question or Claude synthesis.
- If you considered an inference but did not write it as fact, list it in an "Inferences refused" section.

Important:
- The following files did not expose text in the browser and must be attached or extracted before you summarize them:
${attachmentList}
- Do not pretend to have read an attachment unless it is actually available in this conversation.
- If a source is unavailable, create a source placeholder and mark it "needs text extraction".

Output format:
Return Markdown files in this exact fenced-block format so Margins can parse them:

\`\`\`margins-file path="wiki/sources/source-example.md"
---
type: source
bucket: sources
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

# Source: Example

Markdown body here.
\`\`\`

Use one fenced block per returned file. Use this structure:
- wiki/sources/source-{slug}.md
- wiki/concepts/{slug}.md
- wiki/entities/{slug}.md
- wiki/synthesis/{slug}.md
- wiki/index.md
- wiki/ingest-tracker.md
- wiki/log.md
- wiki/wiki-stats.md
- wiki/_templates/source.md
- wiki/_templates/entity.md
- wiki/_templates/concept.md
- wiki/sources/sources.md
- wiki/concepts/concepts.md
- wiki/entities/entities.md
- wiki/synthesis/synthesis.md
- CLAUDE.md
- operator-manual.md
- query-cookbook.md
- commands/ingest.md
- commands/query.md
- commands/compile.md
- commands/lint.md
- commands/propose-edit.md
- commands/apply-edit.md
- agents/wiki-ingest.md
- agents/wiki-compiler.md
- agents/wiki-query.md
- agents/wiki-editor.md
- wiki/.margins/manifest.json
- wiki/.margins/ingest-report.md
- wiki/.margins/edit-log.jsonl

Page rules:
- Every source, concept, entity, synthesis, and index Markdown page under wiki/ must start with YAML frontmatter. Operational files under wiki/.margins/ do not need page frontmatter.
- Every factual claim needs a durable source citation. Do not use ChatGPT-only citation tokens such as :contentReference, oaicite, turn references, or hidden attachment ids. Cite with source page links and plain file/section references that will still make sense after export.
- Synthesis is allowed, but label it as synthesis.
- Do not invent account balances, transaction details, dates, roles, or relationships.
- Prefer useful connection-point summaries over generic tags.
- Only create concept pages for durable ideas that will remain useful across future sources.
- Only create entity pages for real people, organizations, named accounts, tools, securities, projects, or places.
- Do not create concept/entity pages for generic labels, PDF artifacts, table headers, UI labels, or section names such as page, positions, spec, inch, flow, append, value, account, or description.
- Treat "positions" as source content or a synthesis section unless the source names a specific position that matters.
- Add wiki links only when the relationship is explicit and useful. Weak keyword overlap should stay unlinked.
- Make edit proposals before changing important structure.
- Use wiki links for source-supported proper nouns and durable pages only.
- When you create a concept, entity, or synthesis page, add backlinks from the relevant source pages using [[page-slug]] links so the graph is navigable.
- Promoted concept/entity/synthesis pages must link back to their supporting source pages.
- Do not create stub pages just to resolve a mention. Put those in "Mentioned but missing" instead.

For each source:
1. Write a faithful source page with frontmatter, summary, context, key takeaways, concrete facts, and open questions.
2. Extract concrete entities, dates, accounts, projects, decisions, and unresolved questions, but keep weak candidates inside the source page.
3. Identify concepts that should become durable wiki pages. A concept should be reusable across future sources, not just a word that appeared in this file.
4. Add a "Mentioned but missing" section for proper nouns that might need pages but should not be auto-promoted.
5. Add an "Inferences refused" section for tempting claims you did not promote because the source does not directly support them.

Across sources:
1. Link related source nodes only when the connection is explicit or strongly source-supported.
2. Create synthesis pages that explain why sources connect, and label them as synthesis / not user-confirmed.
3. Create entity pages only for real named people, organizations, named accounts, tools, securities, projects, or places that matter.
4. Create concept pages only for load-bearing ideas that will help future retrieval.
5. List open questions and next actions separately from direct-read facts.

Operating-layer files:
- operator-manual.md should teach a future language model how to read, query, edit, and avoid overreaching in this wiki.
- query-cookbook.md should include practical lookup patterns.
- commands/*.md should be short executable workflow specs.
- agents/*.md should describe conservative recurring roles: ingest, compile, query, and editor.
- wiki/.margins/manifest.json should describe the vault template, privacy posture, enabled commands, enabled agents, and generated counts.
- wiki/.margins/ingest-report.md should summarize files created, links made, inferences refused, mentioned-but-missing candidates, and anything that needs user review.

Extracted text sources:

${sourceBlocks}`;
}

export function buildLlmRepairPrompt(fileMap) {
  const validate = callbacks.validateLlmFiles;
  const warningsByPath = validate ? validate(fileMap) : new Map();
  const groupedWarnings = [...warningsByPath.entries()]
    .filter(([, warnings]) => warnings.length > 0)
    .map(([path, warnings]) => `## ${path}\n${warnings.map((warning) => `- ${warning}`).join("\n")}`)
    .join("\n\n") || "No warnings.";

  return `Repair this Margins wiki output.

Use this operating context as law:

${wikiSchemaPack()}

Your task:
1. Regenerate the complete returned file set, not a diff patch.
2. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
3. Fix every warning listed below.
4. Remove all :contentReference, oaicite, hidden attachment ids, and turn references.
5. Add YAML frontmatter to every wiki source, concept, entity, synthesis, and index page.
6. Use durable citations only: source page links, filenames in raw/, and plain section names.
7. Add source-page backlinks to promoted pages where supported.
8. Demote fictional/demo-only entity pages into Mentioned but missing or Needs Review unless they are useful durable entities.
9. Preserve good source facts and refused inferences.

Review warnings:

${groupedWarnings}

Current output to repair:

${serializeLlmFiles(fileMap)}`;
}

export function buildReviewResponsePrompt(fileMap, questions, reply, reviewMode) {
  return `You are operating Margins, a local-first personal wiki compiler.

The user is responding conversationally to review questions about generated wiki files. Use their reply as judgment, then regenerate the complete returned file set.

Current review mode: ${reviewModeLabel(reviewMode)}

Operating context:

${wikiSchemaPack()}

Review questions Margins asked:

${serializeReviewQuestions(questions)}

User reply:

${reply}

Task:
1. Apply the user's guidance conservatively to the wiki files below.
2. Return complete replacement contents for each file you return, not a diff patch.
3. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
4. Prefer fewer, stronger concept/entity/synthesis pages over many weak pages.
5. Demote nodes the user does not want into source-page sections, "Mentioned but missing", or draft synthesis notes as appropriate.
6. Preserve source pages and concrete facts unless the user explicitly says they are wrong.
7. Keep all synthesis labeled. Do not turn guesses into facts.
8. If the user's reply contains a stable preference for future ingests, create or update wiki/.margins/preferences.json with a concise machine-readable preference.
9. Only add a follow-up question if the user's answer is needed to avoid a wrong durable wiki decision.

Current file set:

${serializeLlmFiles(fileMap)}`;
}

// ---------------------------------------------------------------------
// LLM-tab-only helpers (pure)
// ---------------------------------------------------------------------

export function wikiSchemaPack() {
  return `## Margins Wiki Schema Pack

Architecture:
- raw/ stores immutable original files.
- wiki/ stores LLM-operable Markdown: source pages, concept pages, entity pages, synthesis pages, index pages, an ingest tracker, an operation log, stats, bucket overviews, and templates.
- CLAUDE.md, operator-manual.md, query-cookbook.md, commands/, agents/, and wiki/.margins/ tell future models how to operate the wiki.

Required frontmatter for wiki source, concept, entity, synthesis, and index pages:
---
type: source | concept | entity | synthesis | index
bucket: sources | concepts | entities | synthesis | index
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

Structural files every generated vault should include:
- CLAUDE.md: first-read agent operating skeleton.
- wiki/ingest-tracker.md: table mapping source files in raw/ to generated pages.
- wiki/log.md: human-readable log with ops limited to ingest | query | compile | lint | update.
- wiki/wiki-stats.md: drift, compression, extraction, and size dashboard.
- wiki/{sources,concepts,entities,synthesis}/{bucket}.md: bucket overview pages.
- wiki/_templates/*.md: source/entity/concept/synthesis/meeting/daily shapes for future ingest.

Citation rules:
- Use durable wiki/file citations only.
- Good: "Ending value was $40,053.97 (source file: coleman-brokerage-2026-03.pdf, Account Summary)."
- Good: "See [[source-coleman-brokerage-2026-03]]."
- Bad: ":contentReference[oaicite:10]{index=10}", hidden attachment ids, turn ids, or any citation that disappears outside the chat.

Good source page shape:
---
type: source
bucket: sources
summary: Demo brokerage statement for Sarah Coleman covering March 2026 account values, allocation, holdings, and withdrawals.
tags: [source, statement, demo]
created: YYYY-MM-DD
updated: YYYY-MM-DD
event_date: 2026-03-31
voice: claude-draft
---

# Source: Coleman Brokerage Statement, March 2026

Original file: coleman-brokerage-2026-03.pdf

## Summary
Direct-read summary with durable citations to the original file or source page.

## Context
- Link durable promoted pages when supported: [[demo-financial-statements]]

## Concrete Facts
- Fact with original file / section citation.

## Related Pages
- [[demo-financial-statements]] -- why this page connects

## Mentioned but missing
- Candidate -- why it was not promoted

## Inferences refused
- Tempting unsupported claim -- why it stayed out

Good promoted page rule:
- A concept/entity/synthesis page must link back to supporting sources with [[source-slug]].
- Do not promote demo-only names unless the name itself will help future retrieval.

Good ingest report shape:
# Ingest Report

## Files Created
## Links Made
## Inferences Refused
## Mentioned but Missing
## Needs Review

Self-check before returning:
1. Every wiki source, concept, entity, synthesis, and index page has YAML frontmatter.
2. No ChatGPT-only citation artifacts remain.
3. Every source page has Mentioned but missing and Inferences refused.
4. Every promoted page links back to a source page.
5. Source pages link to promoted pages where supported.
6. Fictional/demo-only names are not promoted unless useful durable entities.`;
}

export function serializeVaultContext(fileMap) {
  const entries = [...fileMap.entries()]
    .filter(([path]) => shouldIncludeInVaultContext(path))
    .sort(([left], [right]) => contextPathRank(left) - contextPathRank(right) || left.localeCompare(right));

  return entries.map(([path, body]) => {
    const budget = path.startsWith("wiki/sources/") ? 2400 : 1800;
    return `\`\`\`margins-file path="${path}"\n${truncateForPrompt(body, budget)}\n\`\`\``;
  }).join("\n\n") || "_No existing wiki context was loaded._";
}

export function serializeLlmFiles(fileMap) {
  return [...fileMap.entries()]
    .map(([path, body]) => `\`\`\`margins-file path="${path}"\n${body}\n\`\`\``)
    .join("\n\n");
}

export function serializeReviewQuestions(questions) {
  if (!questions.length) {
    return "- No material questions were generated. The user is giving optional filing guidance.";
  }
  return questions.map((question) => [
    `- ${question.question}`,
    `  Why Margins asked: ${question.reason}`,
    `  ${question.recommendation}`,
    `  File: ${question.path || "vault"}`
  ].join("\n")).join("\n");
}

export function truncateForPrompt(body, maxChars) {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trim()}\n\n[Truncated for prompt. Preserve this file unless the new source clearly requires an update.]`;
}

export function hasVaultWikiContent(fileMap) {
  return [...fileMap.entries()].some(([path, body]) => (
    isContextWikiPagePath(path) &&
    !isFolderIndexPath(path) &&
    !isSourceOnlyWikiPage(path, body)
  ));
}

export function shouldIncludeInVaultContext(path) {
  return isWikiPagePath(path) ||
    path === "CLAUDE.md" ||
    path.startsWith("commands/") ||
    path.startsWith("agents/") ||
    path === "operator-manual.md" ||
    path === "query-cookbook.md" ||
    path === "wiki/ingest-tracker.md" ||
    path === "wiki/log.md" ||
    path === "wiki/wiki-stats.md" ||
    path === "wiki/.margins/ingest-report.md";
}

export function contextPathRank(path) {
  if (path === "wiki/index.md") return 0;
  if (path.startsWith("wiki/sources/")) return 1;
  if (path.startsWith("wiki/concepts/")) return 2;
  if (path.startsWith("wiki/entities/")) return 3;
  if (path.startsWith("wiki/synthesis/")) return 4;
  return 5;
}

// ---------------------------------------------------------------------
// Internal — only used by hasVaultWikiContent
// ---------------------------------------------------------------------

function isSourceOnlyWikiPage(path, body) {
  if (path === "wiki/index.md" || /^wiki\/(ingest-tracker|log|wiki-stats)\.md$/.test(path)) return true;
  if (path.startsWith("wiki/sources/") || /^wiki\/[^/]+\/source[-/]/.test(path)) return true;
  if (isBucketOverviewPath(path)) return true;
  const type = String(frontmatterFields(body).type || "").toLowerCase();
  return ["source", "log", "index", "template"].includes(type);
}
