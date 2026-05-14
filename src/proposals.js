import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const PROPOSED_DIR = "proposed";

export function createProposals(vault) {
  function resolveProposed(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return vault.resolveInside(`${PROPOSED_DIR}/${safe}`);
  }

  function relProposal(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return `${PROPOSED_DIR}/${safe}`;
  }

  async function exists(abs) {
    try {
      await stat(abs);
      return true;
    } catch {
      return false;
    }
  }

  async function readCurrentBody(rel) {
    const proposedAbs = resolveProposed(rel);
    if (await exists(proposedAbs)) {
      return { body: await readFile(proposedAbs, "utf8"), source: "proposal" };
    }
    const vaultAbs = vault.resolveInside(rel);
    if (await exists(vaultAbs)) {
      return { body: await readFile(vaultAbs, "utf8"), source: "vault" };
    }
    return { body: null, source: null };
  }

  async function writeProposal(rel, body) {
    const abs = resolveProposed(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
    return { proposalPath: relProposal(rel), destinationPath: rel };
  }

  async function proposePage(rel, body, options = {}) {
    if (!rel || typeof rel !== "string") {
      throw new Error("path is required");
    }
    if (rel.startsWith(PROPOSED_DIR + "/") || rel === PROPOSED_DIR) {
      throw new Error(`destination path cannot start with ${PROPOSED_DIR}/`);
    }
    const vaultAbs = vault.resolveInside(rel);
    const replacesVaultFile = await exists(vaultAbs);
    if (replacesVaultFile && !options.force) {
      throw new Error(
        `${rel} already exists in vault. Use propose_edit or append_to instead.`
      );
    }
    const replaced = await exists(resolveProposed(rel));
    const result = await writeProposal(rel, body);
    return { ...result, replacedExisting: replaced, replacesVaultFile };
  }

  async function proposeEdit(rel, before, after) {
    if (!before) throw new Error("'before' is required and must be non-empty");
    if (typeof after !== "string") {
      throw new Error("'after' is required (use empty string to delete)");
    }
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`edit path cannot start with ${PROPOSED_DIR}/`);
    }
    const { body, source } = await readCurrentBody(rel);
    if (body === null) {
      throw new Error(`${rel} does not exist. Use propose_page to create it.`);
    }
    const occurrences = countOccurrences(body, before);
    if (occurrences === 0) {
      throw new Error(`'before' text not found in ${rel}.`);
    }
    if (occurrences > 1) {
      throw new Error(
        `'before' appears ${occurrences} times in ${rel}; add surrounding context so it's unique.`
      );
    }
    const newBody = body.replace(before, after);
    const result = await writeProposal(rel, newBody);
    return { ...result, readFrom: source };
  }

  async function appendTo(rel, content) {
    if (typeof content !== "string") throw new Error("'content' is required");
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`append path cannot start with ${PROPOSED_DIR}/`);
    }
    const { body } = await readCurrentBody(rel);
    const base = body ?? "";
    const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
    const newBody = base + separator + content;
    return writeProposal(rel, newBody);
  }

  async function listProposals() {
    const root = vault.resolveInside(PROPOSED_DIR);
    if (!(await exists(root))) return [];
    const out = [];
    await walk(root, root, out);
    out.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
    return out;
  }

  async function walk(root, dir, out) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(root, abs, out);
      } else if (entry.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const vaultAbs = vault.resolveInside(rel);
        out.push({
          proposalPath: `${PROPOSED_DIR}/${rel}`,
          destinationPath: rel,
          willOverwrite: await exists(vaultAbs),
          size: (await stat(abs)).size
        });
      }
    }
  }

  async function resolveProposal(rel, action) {
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      rel = rel.slice(PROPOSED_DIR.length + 1);
    }
    const proposalAbs = resolveProposed(rel);
    if (!(await exists(proposalAbs))) {
      throw new Error(`no pending proposal for ${rel}`);
    }
    if (action === "reject") {
      await rm(proposalAbs, { force: true });
      return { destinationPath: rel, action: "rejected" };
    }
    if (action === "accept") {
      const destAbs = vault.resolveInside(rel);
      const proposalBody = await readFile(proposalAbs, "utf8");
      await mkdir(path.dirname(destAbs), { recursive: true });
      await rm(destAbs, { force: true });
      await rename(proposalAbs, destAbs);
      const trackerUpdate = await maybeAppendTrackerRow(vault, rel, proposalBody);
      return { destinationPath: rel, action: "accepted", trackerUpdated: trackerUpdate };
    }
    throw new Error(`unknown action '${action}'; use 'accept' or 'reject'`);
  }

  return {
    proposePage,
    proposeEdit,
    appendTo,
    listProposals,
    resolveProposal
  };
}

const TRACKER_PATH = "wiki/ingest-tracker.md";
const TRACKER_HEADER = `---
type: tracker
bucket: system
summary: Source-file processing tracker for this Margins vault.
tags: [tracker, ingest, system]
voice: claude-draft
---

# Ingest Tracker

This is the single source of truth for which source files in raw/ have been converted into wiki pages. Update it whenever ingest creates, rewrites, or skips a source.

| Source file | Status | Source page | Connected pages | Words | Notes |
|---|---|---|---|---:|---|
`;
const TRACKER_FOOTER = `
## Status Vocabulary

- ingested: source text was available and a wiki source page exists.
- needs-extraction: the original file is preserved in raw/, but readable text was not available to the compiler.
- skipped: the user intentionally chose not to file this source.
- superseded: a newer source replaced this one as the preferred reference.
`;

async function maybeAppendTrackerRow(vault, destPath, body) {
  const parsed = parseSourceFrontmatter(body);
  if (!parsed || !parsed.rawFile) return { changed: false, reason: "no-raw-file" };

  const trackerAbs = vault.resolveInside(TRACKER_PATH);
  let current;
  try {
    current = await readFile(trackerAbs, "utf8");
  } catch {
    current = null;
  }

  const slug = destPath.split("/").pop().replace(/\.md$/i, "");
  const rowKey = `| ${parsed.rawFile} |`;
  const row = `| ${parsed.rawFile} | ingested | [[${slug}]] | - |  |  |`;

  if (current === null) {
    const text = TRACKER_HEADER + row + "\n" + TRACKER_FOOTER;
    await mkdir(path.dirname(trackerAbs), { recursive: true });
    await writeFile(trackerAbs, text, "utf8");
    return { changed: true, action: "created", rawFile: parsed.rawFile };
  }

  if (current.includes(rowKey)) {
    return { changed: false, reason: "already-tracked", rawFile: parsed.rawFile };
  }

  const lines = current.split("\n");
  let insertAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\|\s+\S+\/\S+\s+\|/.test(lines[i]) || lines[i].startsWith("|---")) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) {
    const next = current.endsWith("\n") ? current + row + "\n" : current + "\n" + row + "\n";
    await writeFile(trackerAbs, next, "utf8");
    return { changed: true, action: "appended-end", rawFile: parsed.rawFile };
  }
  lines.splice(insertAt, 0, row);
  await writeFile(trackerAbs, lines.join("\n"), "utf8");
  return { changed: true, action: "appended", rawFile: parsed.rawFile };
}

function parseSourceFrontmatter(body) {
  if (!body || !body.startsWith("---\n")) return null;
  const end = body.indexOf("\n---", 4);
  if (end < 0) return null;
  const fm = body.slice(4, end);
  const typeMatch = fm.match(/^type:\s*"?source"?\s*$/m);
  if (!typeMatch) return null;
  const rawMatch = fm.match(/^raw_file:\s*"?([^"\n]+?)"?\s*$/m);
  if (!rawMatch) return null;
  return { rawFile: rawMatch[1].trim() };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
