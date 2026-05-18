// Split-mode compile: take one raw document and stage N segment source pages
// plus a hub page that lists them. Hub gets the tracker row; segments use
// type:source_segment so they don't generate their own rows but still count
// as "filed" for raw-index purposes.
//
// Idempotency contract: a raw file is "already split" if any pending hub
// proposal OR any vault hub page exists with the same raw_sha256. force=true
// clears prior segments + hub (staged or landed) and re-stages from scratch.
import { stat } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  extractDocumentText,
  splitTextByHeading,
  PDF_EXTENSIONS
} from "./document-text.js";
import { hashFile } from "./hash.js";
import { canonicalize } from "./paths.js";
import { parseFrontmatter, getType } from "./frontmatter.js";

const DEFAULT_MAX_SEGMENTS = 50;
const MIN_SEGMENT_CHARS = 30;

export async function runSplitCompile({ vault, proposals, rel, absRaw, info, fileName, review }) {
  const ext = path.extname(fileName).toLowerCase();
  if (PDF_EXTENSIONS.has(ext)) {
    throw new Error(
      `Split mode does not support PDFs yet — pdf.js text output is too lossy for reliable heading detection. ` +
      `Convert the PDF to Markdown/DOCX first, then compile with split.`
    );
  }

  const rawSha = await hashFile(absRaw);
  const text = await extractDocumentText(absRaw, rel);

  // TOCTOU: file changed during extraction → bail. The caller already
  // checked the single-compile path; we check again here because split
  // mode does a second extraction after the first stat.
  let postInfo;
  try { postInfo = await stat(absRaw); } catch { postInfo = null; }
  if (postInfo && (postInfo.mtimeMs !== info.mtimeMs || postInfo.size !== info.size)) {
    throw new Error(
      `'${rel}' changed during split compile (file was edited while Margins was reading it). Re-run.`
    );
  }

  const splitOn = normalizeSplitOn(review.split, ext);
  const segments = splitTextByHeading(text, splitOn === "heading-h2" || splitOn === "sheet" ? "h2" : "h1")
    .filter((seg) => seg.body.replace(/\s+/g, "").length >= MIN_SEGMENT_CHARS);

  if (segments.length === 0) {
    throw new Error(
      `'${rel}' has no headings at level ${splitOn} with non-trivial content. ` +
      `Try a different splitOn value or compile without split mode.`
    );
  }
  if (segments.length === 1) {
    throw new Error(
      `'${rel}' has only one segment at splitOn=${splitOn}. Split mode requires at least 2. ` +
      `Compile without split, or try a deeper heading level.`
    );
  }

  const maxSegments = clampMaxSegments(review.maxSegments);
  const overflow = segments.length > maxSegments;
  const used = overflow ? segments.slice(0, maxSegments) : segments;

  const force = Boolean(review.force);
  const baseSlug = slugifyBase(fileName);
  const hubSlug = `${baseSlug}-hub`;

  // Idempotency: any landed/staged hub for this raw_sha256?
  const existingHub = await findExistingHubForRaw(vault, proposals, rel, rawSha);
  if (existingHub && !force) {
    return {
      status: "already-split",
      rawFile: rel,
      rawSha256: rawSha,
      hubPath: existingHub.path,
      hubLocation: existingHub.location, // "vault" | "proposed"
      message: `${rel} is already split — hub at ${existingHub.path}. Pass force=true to re-stage all segments and hub.`
    };
  }

  // Bucket resolution order:
  //   1. explicit review.bucket / review.hubBucket
  //   2. landed hub's bucket (when force=true rebuilding an existing split)
  //   3. default 'sources'
  // Without step 2, force=true on a hub that landed under wiki/projects/
  // would re-stage everything under wiki/sources/ and leave the old hub
  // orphaned in the original bucket — duplicate hubs for the same raw file.
  let bucket = review.bucket || review.hubBucket;
  if (!bucket && existingHub && existingHub.location === "vault") {
    const parts = existingHub.path.split("/");
    if (parts.length >= 3 && parts[0] === "wiki") {
      bucket = parts[1];
    }
  }
  bucket = bucket || "sources";
  const hubDest = `wiki/${bucket}/${hubSlug}.md`;

  if (existingHub && force) {
    await clearExistingSplit(vault, proposals, rel, rawSha, existingHub);
  }

  // Stage every segment proposal first. Each is independent in proposals.js
  // and inherits the per-destination mutex.
  const segmentEntries = [];
  for (const seg of used) {
    const segSlug = buildSegmentSlug(baseSlug, seg.index, seg.heading);
    const segDest = `wiki/${bucket}/source-${segSlug}.md`;
    const segBody = buildSegmentBody({
      title: seg.heading,
      rawFile: rel,
      rawSha256: rawSha,
      rawSize: info.size,
      segmentIndex: seg.index,
      segmentsCount: used.length,
      hubSlug,
      bodyText: seg.body
    });
    const result = await proposals.proposePage(segDest, segBody, { force });
    segmentEntries.push({
      destinationPath: result.destinationPath,
      proposalPath: result.proposalPath,
      slug: segSlug,
      heading: seg.heading,
      segmentIndex: seg.index
    });
  }

  // Stage hub LAST so a partial failure leaves orphan segments that the
  // user can either re-run (force=true clears them) or inspect.
  const hubBody = buildHubBody({
    title: stripExt(fileName),
    rawFile: rel,
    rawSha256: rawSha,
    rawSize: info.size,
    segmentsCount: used.length,
    totalHeadingsFound: segments.length,
    overflow,
    splitOn,
    segments: segmentEntries
  });
  const hubResult = await proposals.proposePage(hubDest, hubBody, { force });

  return {
    status: "split-staged",
    rawFile: rel,
    rawSha256: rawSha,
    rawSize: info.size,
    hubPath: hubResult.destinationPath,
    hubProposalPath: hubResult.proposalPath,
    bucket,
    segmentsCount: used.length,
    totalHeadingsFound: segments.length,
    overflow,
    overflowDropped: overflow ? segments.length - maxSegments : 0,
    splitOn,
    segments: segmentEntries
  };
}

function normalizeSplitOn(split, ext) {
  if (split === "sheet") return "sheet";
  if (split === "heading-h1") return "heading-h1";
  if (split === "heading-h2") return "heading-h2";
  if (split === "auto" || split === true) {
    // Sheets are already h2-marked by extractXlsxText. Markdown / DOCX
    // typically split well on h1.
    if (ext === ".xlsx" || ext === ".xlsm" || ext === ".ods") return "sheet";
    return "heading-h1";
  }
  return "heading-h1";
}

function clampMaxSegments(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_SEGMENTS;
  if (n < 2) return 2;
  if (n > 200) return 200;
  return Math.floor(n);
}

function slugifyBase(fileName) {
  return stripExt(fileName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "doc";
}

function stripExt(fileName) {
  return fileName.replace(/\.[^./]+$/, "");
}

function slugifyHeading(heading) {
  return String(heading || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    || "untitled";
}

function buildSegmentSlug(baseSlug, index, heading) {
  const segNum = String(index + 1).padStart(2, "0");
  return `${baseSlug}-s${segNum}-${slugifyHeading(heading)}`;
}

function buildSegmentBody({ title, rawFile, rawSha256, rawSize, segmentIndex, segmentsCount, hubSlug, bodyText }) {
  const fm = [
    "---",
    "type: source_segment",
    `title: ${yamlString(title)}`,
    `raw_file: ${rawFile}`,
    `raw_sha256: ${rawSha256}`,
    `raw_size: ${rawSize}`,
    `segment_index: ${segmentIndex}`,
    `segments_count: ${segmentsCount}`,
    `hub: "[[${hubSlug}]]"`,
    "voice: claude-draft",
    "---"
  ].join("\n");
  return `${fm}\n\n# ${title}\n\n${bodyText}\n`;
}

function buildHubBody({ title, rawFile, rawSha256, rawSize, segmentsCount, totalHeadingsFound, overflow, splitOn, segments }) {
  const fm = [
    "---",
    "type: source",
    `title: ${yamlString(title)}`,
    `raw_file: ${rawFile}`,
    `raw_sha256: ${rawSha256}`,
    `raw_size: ${rawSize}`,
    `segments_count: ${segmentsCount}`,
    `split_on: ${splitOn}`,
    "is_hub: true",
    "voice: claude-draft",
    "---"
  ].join("\n");
  const intro = overflow
    ? `Hub for the split of ${rawFile}. ${segmentsCount} segments staged; ${totalHeadingsFound - segmentsCount} additional headings dropped due to maxSegments cap.`
    : `Hub for the split of ${rawFile}. ${segmentsCount} segments staged.`;
  // Segment files land at wiki/<bucket>/source-<segSlug>.md, so the
  // Obsidian-style wikilink must include the `source-` prefix to resolve
  // to the real basename. Previously linked [[<segSlug>]] which pointed at
  // a non-existent page, breaking the hub's main navigation block.
  const lines = segments.map((s) => `- [[source-${s.slug}]] — ${s.heading}`);
  return `${fm}\n\n# ${title}\n\n${intro}\n\n## Segments\n\n${lines.join("\n")}\n`;
}

function yamlString(s) {
  if (typeof s !== "string") return `"${String(s)}"`;
  if (/[:#\n\r"']/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

// Locate an existing hub for a raw file. Searches both proposed/ and the
// landed vault. Returns { path, location } or null.
async function findExistingHubForRaw(vault, proposals, rel, rawSha) {
  const canonRel = canonicalize(rel);

  // Pending hub proposals first — listProposals stat-only is fast.
  const pending = await proposals.listProposals({ includeDelta: false });
  for (const item of pending) {
    const abs = vault.resolveInside(item.proposalPath);
    const hub = await readHubMatching(abs, canonRel, rawSha);
    if (hub) return { path: item.destinationPath, location: "proposed" };
  }

  // Landed hubs in the vault.
  const allFiles = await vault.listFiles();
  for (const abs of allFiles) {
    const hub = await readHubMatching(abs, canonRel, rawSha);
    if (hub) return { path: canonicalize(vault.toRel(abs)), location: "vault" };
  }
  return null;
}

async function readHubMatching(abs, canonRel, rawSha) {
  let body;
  try {
    body = await readFile(abs, "utf8");
  } catch { return false; }
  const parsed = parseFrontmatter(body);
  if (!parsed) return false;
  if (getType(parsed.data) !== "source") return false;
  if (parsed.data.is_hub !== true && String(parsed.data.is_hub).toLowerCase() !== "true") return false;
  const rawMatches = canonicalize(parsed.data.raw_file || "") === canonRel ||
    parsed.data.raw_sha256 === rawSha;
  return rawMatches;
}

async function clearExistingSplit(vault, proposals, rel, rawSha, existingHub) {
  // Remove every pending proposal whose frontmatter ties it to this hub —
  // segments by `hub` link OR raw_sha256, plus the hub itself.
  const canonRel = canonicalize(rel);
  const pending = await proposals.listProposals({ includeDelta: false });
  for (const item of pending) {
    const abs = vault.resolveInside(item.proposalPath);
    let body;
    try { body = await readFile(abs, "utf8"); } catch { continue; }
    const parsed = parseFrontmatter(body);
    if (!parsed) continue;
    const fmType = getType(parsed.data);
    const ties =
      parsed.data.raw_sha256 === rawSha ||
      canonicalize(parsed.data.raw_file || "") === canonRel;
    if (!ties) continue;
    if (fmType === "source" || fmType === "source_segment" || fmType === "synthesis") {
      await proposals.resolveProposal(item.destinationPath, "reject");
    }
  }
  // Note: this does NOT delete landed segments/hub from the vault. force=true
  // re-stages over the same destinations; the user resolves the new proposals
  // (which will show willOverwrite=true) to replace them atomically. Leaving
  // the vault untouched here keeps split-mode's destructive surface confined
  // to the proposal queue.
}
