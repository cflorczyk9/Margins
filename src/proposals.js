import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, extractRawFileRefs, getType } from "./frontmatter.js";
import { canonicalize } from "./paths.js";

const PROPOSED_DIR = "proposed";

// Per-destination async mutex. All read-modify-write flows on a given
// destination path (proposeEdit, appendTo, resolveProposal) must serialize so
// two concurrent calls don't lose updates. Tracker writes share a dedicated
// key so two accepts running in parallel don't clobber each other's row.
// Pure-write paths (proposePage) also lock to keep ordering deterministic.
function createPathLocks() {
  const inflight = new Map();
  return function withLock(key, fn) {
    const prev = inflight.get(key) || Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    const settled = next.then(() => {}, () => {});
    inflight.set(key, settled);
    settled.then(() => {
      if (inflight.get(key) === settled) inflight.delete(key);
    });
    return next;
  };
}

const TRACKER_LOCK_KEY = "__tracker__";

export function createProposals(vault) {
  const withLock = createPathLocks();

  function resolveProposed(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return vault.resolveInside(`${PROPOSED_DIR}/${safe}`);
  }

  function relProposal(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return `${PROPOSED_DIR}/${safe}`;
  }

  // Canonical lock key per destination — derived from the resolved relative
  // path so callers passing the same logical path with slight string variation
  // (leading "./", trailing "/", redundant segments) still hit the same lock.
  function lockKeyFor(rel) {
    return vault.toRel(vault.resolveInside(rel));
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
    // Atomic write so a crash mid-stage can't leave a torn proposal that the
    // next read interprets as truncated truth.
    await atomicWrite(abs, body);
    return { proposalPath: relProposal(rel), destinationPath: rel };
  }

  async function proposePage(rel, body, options = {}) {
    if (!rel || typeof rel !== "string") {
      throw new Error("path is required");
    }
    if (rel.startsWith(PROPOSED_DIR + "/") || rel === PROPOSED_DIR) {
      throw new Error(`destination path cannot start with ${PROPOSED_DIR}/`);
    }
    return withLock(lockKeyFor(rel), async () => {
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
    });
  }

  async function proposeEdit(rel, before, after) {
    if (!before) throw new Error("'before' is required and must be non-empty");
    if (typeof after !== "string") {
      throw new Error("'after' is required (use empty string to delete)");
    }
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`edit path cannot start with ${PROPOSED_DIR}/`);
    }
    return withLock(lockKeyFor(rel), async () => {
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
    });
  }

  async function appendTo(rel, content) {
    if (typeof content !== "string") throw new Error("'content' is required");
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`append path cannot start with ${PROPOSED_DIR}/`);
    }
    return withLock(lockKeyFor(rel), async () => {
      const { body } = await readCurrentBody(rel);
      const base = body ?? "";
      const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
      const newBody = base + separator + content;
      return writeProposal(rel, newBody);
    });
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
        const willOverwrite = await exists(vaultAbs);
        const proposalSize = (await stat(abs)).size;
        const item = {
          proposalPath: `${PROPOSED_DIR}/${rel}`,
          destinationPath: rel,
          willOverwrite,
          size: proposalSize
        };
        if (willOverwrite) {
          item.overwriteDelta = await buildOverwriteDelta(abs, vaultAbs, proposalSize);
        }
        out.push(item);
      }
    }
  }

  async function resolveProposal(rel, action) {
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      rel = rel.slice(PROPOSED_DIR.length + 1);
    }
    // Lock on the destination path so a concurrent propose_edit/append_to
    // can't squeeze a write into proposed/<rel> between our read and delete.
    // Tracker writes are wrapped in their own lock further in.
    return withLock(lockKeyFor(rel), async () => {
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

        // Order matters. Write destination first (atomically). If the tracker
        // update fails, the source page exists but the tracker is out of sync —
        // detectable and repairable via margins_doctor. If we wrote the tracker
        // first and the destination write failed, the tracker would point to a
        // non-existent file, which is harder to diagnose.
        await mkdir(path.dirname(destAbs), { recursive: true });
        await atomicWrite(destAbs, proposalBody);

        const trackerUpdate = await withLock(TRACKER_LOCK_KEY, () =>
          maybeAppendTrackerRow(vault, rel, proposalBody)
        );

        // Only delete the proposal after both writes succeeded. If the tracker
        // step throws, the proposal stays — user can re-run resolve_proposal.
        await rm(proposalAbs, { force: true });

        return { destinationPath: rel, action: "accepted", trackerUpdated: trackerUpdate };
      }
      throw new Error(`unknown action '${action}'; use 'accept' or 'reject'`);
    });
  }

  async function resetAllProposals() {
    const items = await listProposals();
    const deleted = [];
    for (const item of items) {
      const abs = vault.resolveInside(item.proposalPath);
      try {
        await rm(abs, { force: true });
        deleted.push(item.proposalPath);
      } catch {
        // skip files that can't be removed (concurrent delete, permission issue)
      }
    }
    return deleted;
  }

  return {
    proposePage,
    proposeEdit,
    appendTo,
    listProposals,
    resolveProposal,
    resetAllProposals
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
  const parsed = parseFrontmatter(body);
  if (!parsed) return { changed: false, reason: "no-frontmatter" };
  if (getType(parsed.data) !== "source") return { changed: false, reason: "not-a-source-page" };
  const refs = extractRawFileRefs(parsed.data);
  if (!refs.length) return { changed: false, reason: "no-raw-file" };
  const rawFile = canonicalize(refs[0]);

  const trackerAbs = vault.resolveInside(TRACKER_PATH);
  let current;
  try {
    current = await readFile(trackerAbs, "utf8");
  } catch {
    current = null;
  }

  const slug = destPath.split("/").pop().replace(/\.md$/i, "");
  const row = `| ${rawFile} | ingested | [[${slug}]] | - |  |  |`;

  if (current === null) {
    const text = TRACKER_HEADER + row + "\n" + TRACKER_FOOTER;
    await mkdir(path.dirname(trackerAbs), { recursive: true });
    await atomicWrite(trackerAbs, text);
    return { changed: true, action: "created", rawFile };
  }

  // Find any existing row for this raw file (matches by leading `| <rawFile> |`).
  // The previous implementation used substring-includes which would falsely
  // match a "pending" placeholder row left by a prior reconciliation. We now
  // detect and either skip (if the row already says the right thing) or
  // replace (if it's a stale pending/placeholder row).
  const escapedRaw = rawFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowRe = new RegExp(`^\\|\\s+${escapedRaw}\\s+\\|.*$`, "m");
  const existing = current.match(rowRe);
  if (existing) {
    if (existing[0] === row) {
      return { changed: false, reason: "already-tracked", rawFile };
    }
    const replaced = current.replace(rowRe, row);
    await atomicWrite(trackerAbs, replaced);
    return { changed: true, action: "replaced", rawFile };
  }

  const lines = current.split("\n");
  let insertAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\|\s+[^|\n]+?\/[^|\n]+?\s+\|/.test(lines[i]) || lines[i].startsWith("|---")) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) {
    const next = current.endsWith("\n") ? current + row + "\n" : current + "\n" + row + "\n";
    await atomicWrite(trackerAbs, next);
    return { changed: true, action: "appended-end", rawFile };
  }
  lines.splice(insertAt, 0, row);
  await atomicWrite(trackerAbs, lines.join("\n"));
  return { changed: true, action: "appended", rawFile };
}

async function atomicWrite(absPath, content) {
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, absPath);
  } catch (err) {
    try { await rm(tmp, { force: true }); } catch {}
    throw err;
  }
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

const DELTA_LINE_CAP = 200;

// For proposals that will overwrite an existing vault file, surface a small
// preview so a reviewer can tell at a glance whether accepting will clobber
// real content. Without this, list_proposals just says "willOverwrite: true"
// and a 22KB diff vanishes silently on accept.
async function buildOverwriteDelta(proposalAbs, vaultAbs, proposalSize) {
  let proposalBody;
  let vaultBody;
  try {
    proposalBody = await readFile(proposalAbs, "utf8");
  } catch {
    return { error: "could-not-read-proposal" };
  }
  try {
    vaultBody = await readFile(vaultAbs, "utf8");
  } catch {
    return { error: "could-not-read-destination" };
  }
  const vaultBytes = Buffer.byteLength(vaultBody, "utf8");
  // Fast path for the very common case where re-staging regenerates the same
  // page. Skip the line-by-line walk if the bytes are identical.
  if (proposalBody === vaultBody) {
    return {
      destinationBytes: vaultBytes,
      proposalBytes: proposalSize,
      bytesDelta: 0,
      destinationLines: countLines(vaultBody),
      proposalLines: countLines(proposalBody),
      identical: true,
      firstDiff: null
    };
  }
  const proposalLines = proposalBody.split(/\r?\n/);
  const vaultLines = vaultBody.split(/\r?\n/);
  const firstDiff = findFirstDiff(proposalLines, vaultLines);
  return {
    destinationBytes: vaultBytes,
    proposalBytes: proposalSize,
    bytesDelta: proposalSize - vaultBytes,
    destinationLines: vaultLines.length,
    proposalLines: proposalLines.length,
    identical: firstDiff === null,
    firstDiff: firstDiff
      ? {
          line: firstDiff.line,
          fromVault: truncateForPreview(firstDiff.fromVault),
          fromProposal: truncateForPreview(firstDiff.fromProposal)
        }
      : null
  };
}

function findFirstDiff(proposalLines, vaultLines) {
  const limit = Math.max(proposalLines.length, vaultLines.length);
  for (let i = 0; i < limit; i++) {
    const fromProposal = proposalLines[i];
    const fromVault = vaultLines[i];
    if (fromProposal !== fromVault) {
      return {
        line: i + 1,
        fromProposal: fromProposal ?? null,
        fromVault: fromVault ?? null
      };
    }
  }
  return null;
}

function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function truncateForPreview(line) {
  if (line === null) return null;
  if (line.length <= DELTA_LINE_CAP) return line;
  return line.slice(0, DELTA_LINE_CAP) + "…";
}
