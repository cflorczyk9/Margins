import { readFile, stat } from "node:fs/promises";
import { buildVaultIndex } from "./raw-index.js";
import { parseFrontmatter } from "./frontmatter.js";
import { hashFile } from "./hash.js";

const LARGE_RAW_THRESHOLD = 10 * 1024 * 1024;
const TRACKER_PATH = "wiki/ingest-tracker.md";
const TRACKER_SUMMARY_RE = /(\d+)\s+raw files mapped\b[\s\S]*?;\s*(\d+)\s+pending\b/i;
// Match a tracker row regardless of spaces or special characters in the raw
// filename. The path is "anything between '| ' and ' |' that contains a slash."
// `[^|\n]+?` is non-greedy and pipe-excluding so the column boundary is hard.
const TRACKER_ROW_RE = /^\|\s+([^|\n]+?\/[^|\n]+?)\s+\|\s+(\S+)\s+\|\s+\[\[([^\]]+)\]\]/;

/**
 * Diagnose a Margins vault. Returns a structured report of issues a user
 * (or Claude) can act on. Read-only: never modifies the vault.
 *
 * Issue kinds:
 *   - orphan-source       : source page references a raw_file that no longer exists
 *   - tracker-missing     : source page in vault but no row in ingest-tracker.md
 *   - tracker-orphan      : tracker row points to a slug that has no source page
 *   - parse-failure       : a file's frontmatter couldn't be parsed
 *   - large-raw           : raw file exceeds the LARGE_RAW_THRESHOLD
 */
export async function diagnoseVault(vault) {
  const index = await buildVaultIndex(vault);
  const issues = [];

  for (const [rawRel, sourcePage] of index.referenced) {
    try {
      await stat(vault.resolveInside(rawRel));
    } catch {
      issues.push({
        kind: "orphan-source",
        sourcePage,
        rawFile: rawRel,
        severity: "warn",
        message:
          `Source page ${sourcePage} references ${rawRel}, but that file no longer exists in the vault. ` +
          `The source page is now an orphan. Either restore the raw file, edit the source page's raw_file frontmatter, or delete the source page.`
      });
    }
  }

  for (const entry of index.parseFailures || []) {
    const rel = typeof entry === "string" ? entry : entry.path;
    const errDetail = typeof entry === "object" && entry.error ? ` (${entry.error})` : "";
    issues.push({
      kind: "parse-failure",
      path: rel,
      severity: "error",
      message:
        `Failed to parse frontmatter in ${rel}${errDetail}. Common cause: an unquoted YAML value containing a colon-space sequence (e.g., "summary: Key terms: ...") — wrap the value in double quotes. ` +
        `Margins's permissive fallback couldn't recover type/raw_file either, so the page is silently invisible to ingest detection until fixed.`
    });
  }

  for (const candidate of index.candidates) {
    let info;
    try {
      info = await stat(vault.resolveInside(candidate));
    } catch {
      continue;
    }
    if (info.size >= LARGE_RAW_THRESHOLD) {
      const mb = (info.size / 1024 / 1024).toFixed(1);
      issues.push({
        kind: "large-raw",
        path: candidate,
        size: info.size,
        severity: "info",
        message: `${candidate} is ${mb}MB. Extraction will work but may be slow. Margins refuses files over 50MB outright.`
      });
    }
  }

  const trackerIssues = await diagnoseTracker(vault, index);
  issues.push(...trackerIssues);

  const staleIssues = await diagnoseStaleSources(vault, index);
  issues.push(...staleIssues);

  const hubIssues = await diagnoseSplitHubs(vault, index);
  issues.push(...hubIssues);

  return {
    summary: {
      candidates: index.candidates.length,
      filed: index.candidates.length - index.pending.length,
      pending: index.pending.length,
      source_pages: index.sourcePagesCount,
      ingest_roots: index.ingestRoots,
      issues_found: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
      infos: issues.filter((i) => i.severity === "info").length
    },
    issues
  };
}

async function diagnoseStaleSources(vault, index) {
  const stale = [];
  for (const [rawRel, sourcePagePath] of index.referenced) {
    let body;
    try {
      body = await readFile(vault.resolveInside(sourcePagePath), "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(body);
    if (!parsed) continue;
    const knownSha = typeof parsed.data.raw_sha256 === "string" ? parsed.data.raw_sha256 : null;
    const knownSize = typeof parsed.data.raw_size === "number" ? parsed.data.raw_size : null;
    if (!knownSha && knownSize == null) continue; // no staleness contract — skip silently

    let info;
    try {
      info = await stat(vault.resolveInside(rawRel));
    } catch {
      continue; // raw file missing — orphan-source already reported
    }

    if (knownSize != null && info.size !== knownSize) {
      stale.push({
        kind: "stale-source",
        sourcePage: sourcePagePath,
        rawFile: rawRel,
        reason: "size-mismatch",
        severity: "warn",
        message:
          `Raw file ${rawRel} has size ${info.size} bytes but source page records ${knownSize}. ` +
          `The raw file was modified after compile. Re-run propose_compile_from_raw with force=true to refresh the source page.`
      });
      continue;
    }

    if (knownSha) {
      let currentSha;
      try {
        currentSha = await hashFile(vault.resolveInside(rawRel));
      } catch {
        continue;
      }
      if (currentSha !== knownSha) {
        stale.push({
          kind: "stale-source",
          sourcePage: sourcePagePath,
          rawFile: rawRel,
          reason: "hash-mismatch",
          severity: "warn",
          message:
            `Raw file ${rawRel} content has changed since it was compiled (sha256 differs). ` +
            `Re-run propose_compile_from_raw with force=true to refresh the source page.`
        });
      }
    }
  }
  return stale;
}

async function diagnoseTracker(vault, index) {
  const trackerAbs = vault.resolveInside(TRACKER_PATH);
  let body;
  try {
    body = await readFile(trackerAbs, "utf8");
  } catch {
    if (index.referenced.size === 0) return [];
    return [
      {
        kind: "tracker-missing-file",
        path: TRACKER_PATH,
        severity: "warn",
        message:
          `${TRACKER_PATH} doesn't exist, but the vault has ${index.referenced.size} source page${index.referenced.size === 1 ? "" : "s"}. ` +
          `Accepting a source proposal will create the tracker; or rebuild it manually from the source pages.`
      }
    ];
  }

  const trackerRefs = new Set();
  const trackerSlugs = new Set();
  for (const line of body.split("\n")) {
    const m = line.match(TRACKER_ROW_RE);
    if (!m) continue;
    trackerRefs.add(m[1]);
    trackerSlugs.add(m[3]);
  }

  const issues = [];
  const summaryClaim = parseTrackerSummaryClaim(body);
  if (summaryClaim) {
    const actualMapped = index.candidates.length - index.pending.length;
    const actualPending = index.pending.length;
    if (summaryClaim.mapped !== actualMapped || summaryClaim.pending !== actualPending) {
      issues.push({
        kind: "tracker-summary-stale",
        path: TRACKER_PATH,
        severity: "warn",
        message:
          `${TRACKER_PATH} says ${summaryClaim.mapped} raw files mapped and ${summaryClaim.pending} pending, ` +
          `but the live index has ${actualMapped} mapped and ${actualPending} pending. ` +
          `Update the tracker prose/header so it matches the table and live vault state.`
      });
    }
  }

  for (const rawRel of index.referenced.keys()) {
    if (!trackerRefs.has(rawRel)) {
      const sourcePage = index.referenced.get(rawRel);
      // Pending proposals haven't been accepted into the vault yet, so they
      // legitimately have no tracker row. The tracker row is appended by
      // resolve_proposal on accept; flagging proposals as drift produces a
      // false positive on every stage.
      if (sourcePage.startsWith("proposed/")) continue;
      issues.push({
        kind: "tracker-missing-row",
        sourcePage,
        rawFile: rawRel,
        severity: "warn",
        message:
          `Source page ${sourcePage} references ${rawRel}, but the tracker has no row for it. ` +
          `Source pages authored before Margins's auto-append landed (or imported from another tool) need a manual tracker row. ` +
          `Add the line directly to wiki/ingest-tracker.md, or compile any new file to trigger an auto-update of the surrounding rows. ` +
          `resolve_proposal only updates the tracker for proposals it accepts — it cannot retroactively fill rows for pages already in the vault.`
      });
    }
  }

  const knownSlugs = new Set();
  for (const sourcePage of index.referenced.values()) {
    const slug = sourcePage.split("/").pop().replace(/\.md$/i, "");
    knownSlugs.add(slug);
  }
  for (const slug of trackerSlugs) {
    if (!knownSlugs.has(slug)) {
      issues.push({
        kind: "tracker-orphan-row",
        slug,
        severity: "warn",
        message:
          `Tracker has a row for [[${slug}]], but no source page with that slug exists in the vault. ` +
          `The source page may have been deleted or renamed. Remove the tracker row to keep the index honest.`
      });
    }
  }

  return issues;
}

// Split-mode hub: type:source with is_hub:true and segments_count:N. Walk
// every hub in the vault, count segment pages whose frontmatter hub: points
// at this hub, warn if mismatch. Catches deleted segments, half-resolved
// proposal queues, or hub/segment drift after manual edits.
async function diagnoseSplitHubs(vault, index) {
  const issues = [];
  const hubs = [];
  const segmentsByHubSlug = new Map();

  for (const [, sourcePagePath] of index.referenced) {
    if (sourcePagePath.startsWith("proposed/")) continue;
    let body;
    try {
      body = await readFile(vault.resolveInside(sourcePagePath), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try { parsed = parseFrontmatter(body); }
    catch { continue; }
    if (!parsed) continue;
    const isHub = parsed.data.is_hub === true || String(parsed.data.is_hub).toLowerCase() === "true";
    if (isHub && typeof parsed.data.segments_count === "number") {
      const slug = sourcePagePath.split("/").pop().replace(/\.md$/i, "");
      hubs.push({ path: sourcePagePath, slug, expected: parsed.data.segments_count });
    }
  }

  // Walk vault again for type:source_segment pages. They aren't in
  // index.referenced (which maps raw_file -> page) but they are listed in the
  // sourcePagesCount because raw-index treats them as referenced. To find
  // them, walk the whole file list and look for the marker.
  //
  // parseFrontmatter is wrapped in try/catch because a single malformed-YAML
  // page anywhere in the vault would otherwise crash the entire doctor run.
  // The existing parse-failure issue (surfaced via index.parseFailures) is
  // the right place to report those; here we just skip and keep walking.
  const allFiles = await vault.listFiles();
  for (const abs of allFiles) {
    let body;
    try {
      body = await readFile(abs, "utf8");
    } catch { continue; }
    let parsed;
    try { parsed = parseFrontmatter(body); }
    catch { continue; }
    if (!parsed) continue;
    const type = parsed.data.type;
    if (type !== "source_segment") continue;
    const hubLink = String(parsed.data.hub || "").trim();
    const m = hubLink.match(/^\[\[(.+?)\]\]$/);
    if (!m) continue;
    const hubSlug = m[1].trim();
    const list = segmentsByHubSlug.get(hubSlug) || [];
    list.push(vault.toRel(abs));
    segmentsByHubSlug.set(hubSlug, list);
  }

  for (const hub of hubs) {
    const found = segmentsByHubSlug.get(hub.slug) || [];
    if (found.length === hub.expected) continue;
    issues.push({
      kind: "hub-segment-mismatch",
      hubPath: hub.path,
      expected: hub.expected,
      found: found.length,
      severity: "warn",
      message:
        `Hub ${hub.path} expects ${hub.expected} segment${hub.expected === 1 ? "" : "s"} but ${found.length} ` +
        `segment page${found.length === 1 ? "" : "s"} link${found.length === 1 ? "s" : ""} back to it. ` +
        (found.length < hub.expected
          ? `Missing ${hub.expected - found.length}. Possible causes: segments were deleted, the hub was re-staged with fewer segments, or some segment proposals never landed.`
          : `Extra segments are linking to this hub — likely from a prior split that wasn't cleaned up. Reject the orphan segments or re-run propose_compile_from_raw with force=true to re-stage cleanly.`)
    });
  }

  return issues;
}

function parseTrackerSummaryClaim(body) {
  const match = body.match(TRACKER_SUMMARY_RE);
  if (!match) return null;
  return {
    mapped: Number(match[1]),
    pending: Number(match[2])
  };
}
