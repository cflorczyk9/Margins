import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { compileVault } from "./compiler/compiler.js";
import { extractDocumentText, supportedExtensionsList } from "./document-text.js";
import { buildVaultIndex } from "./raw-index.js";
import { canonicalize } from "./paths.js";
import { hashFile, shortHash } from "./hash.js";
import { parseFrontmatter, extractRawFileRefs } from "./frontmatter.js";
import { readFile } from "node:fs/promises";

const MAX_RAW_BYTES = 50 * 1024 * 1024;       // 50MB cap on extraction inputs
const MIN_MEANINGFUL_CHARS = 20;              // below this, treat as empty (catches image-only PDFs)

export function createCompile(vault, proposals) {
  async function proposeCompileFromRaw(rawPath, review) {
    if (!rawPath || typeof rawPath !== "string") {
      throw new Error("rawPath is required");
    }

    const rel = canonicalize(await resolveSourceRel(vault, rawPath));
    const absRaw = vault.resolveInside(rel);

    let info;
    try {
      info = await stat(absRaw);
    } catch {
      throw new Error(await buildNotFoundError(vault, rel));
    }
    if (!info.isFile()) {
      throw new Error(
        `'${rel}' is not a regular file. propose_compile_from_raw needs a file path, not a directory or symlink target.`
      );
    }
    if (info.size > MAX_RAW_BYTES) {
      const mb = (info.size / 1024 / 1024).toFixed(1);
      throw new Error(
        `'${rel}' is ${mb}MB. Margins refuses to extract files over 50MB to avoid hangs. ` +
        `Split the file, OCR a subset, or compile a smaller representative excerpt.`
      );
    }

    const fileName = path.basename(absRaw);
    const force = Boolean(review && review.force);

    // Look up existing source page even when force=true. With force, we
    // continue rather than return — but if the user didn't specify a bucket
    // or destination_path override, we replace IN PLACE at the existing
    // path. Without this, force=true silently creates a duplicate when the
    // existing page is in a non-default bucket (the bug surfaced in
    // pressure testing: force-recompile of an Ex Machina source page in
    // wiki/ideas/ landed in wiki/sources/ instead of replacing).
    const index = await buildVaultIndex(vault);
    const existingPath = index.referenced.get(rel);
    if (existingPath && !force) {
      return {
        status: "already-filed",
        rawFile: rel,
        existingPath,
        message: `Source page already exists at ${existingPath} for raw file ${rel}. Pass force=true to compile again and replace it.`
      };
    }
    if (existingPath && force && !(review && (review.bucket || review.destination_path))) {
      // No explicit bucket/destination override — respect existing location.
      review = { ...(review || {}), destination_path: existingPath };
    }

    let text;
    try {
      text = await extractDocumentText(absRaw, rel);
    } catch (err) {
      throw new Error(
        `Failed to extract text from '${rel}': ${err.message}. ${extractionFailureHint(err)}`
      );
    }

    // TOCTOU check: if the file changed during extraction, the source page we
    // generated will be stale. Abort and tell the user to re-run.
    let postInfo;
    try { postInfo = await stat(absRaw); } catch { postInfo = null; }
    if (postInfo && (postInfo.mtimeMs !== info.mtimeMs || postInfo.size !== info.size)) {
      throw new Error(
        `'${rel}' changed during compile (file was edited while Margins was reading it). ` +
        `Re-run propose_compile_from_raw to capture the latest content.`
      );
    }

    if (!force) {
      const meaningfulChars = text.replace(/\s+/g, "").length;
      if (meaningfulChars < MIN_MEANINGFUL_CHARS) {
        throw new Error(
          `'${rel}' produced only ${meaningfulChars} characters of extractable text. ` +
          `This usually means an image-only PDF (try OCR — ocrmypdf works well), a corrupted file, ` +
          `or an empty document. Pass force=true to stage anyway if this is intentional.`
        );
      }
    }

    const rawSha = await hashFile(absRaw);
    const fullReview = buildReview(review || {}, fileName);

    const compiled = compileVault(
      [{ name: fileName, text }],
      {
        ingestReviews: { [fileName]: fullReview },
        promoteHeuristicCandidates: false
      }
    );

    const sourceNode = compiled.wiki.sources && compiled.wiki.sources[0];
    if (!sourceNode) {
      throw new Error(
        "compiler returned no source node. The review may be missing required fields " +
          "(summary, placement). Provide at least: { summary: '...', placement: { path: 'wiki/sources/foo.md' } }."
      );
    }

    // Slug collision: if another source page already lives at sourceNode.path
    // and points to a DIFFERENT raw file, append a deterministic hash suffix
    // so both can coexist. Idempotency check above already handled the
    // same-raw case.
    const disambiguatedPath = await disambiguateDestPath(vault, sourceNode.path, rel);
    if (disambiguatedPath !== sourceNode.path) {
      sourceNode.path = disambiguatedPath;
      sourceNode.markdown = sourceNode.markdown.replace(
        /^# Source: .*$/m,
        (match) => match
      );
    }

    const markdown = rewriteSourceMetadata(sourceNode.markdown, fileName, rel, rawSha, info.size);

    const destPath = sourceNode.path;
    const proposalResult = await proposals.proposePage(destPath, markdown, { force });
    return {
      ...proposalResult,
      status: "proposal-staged",
      rawFile: rel,
      rawSha256: rawSha,
      rawSize: info.size,
      title: sourceNode.title,
      bucket: sourceNode.path.split("/")[1] || "sources",
      summary: sourceNode.summary,
      termsExtracted: sourceNode.terms,
      entitiesExtracted: sourceNode.entities,
      markdown
    };
  }

  return { proposeCompileFromRaw };
}

async function disambiguateDestPath(vault, candidatePath, currentRawRel) {
  let destAbs;
  try {
    destAbs = vault.resolveInside(candidatePath);
  } catch {
    return candidatePath;
  }
  let body;
  try {
    body = await readFile(destAbs, "utf8");
  } catch {
    return candidatePath; // destination doesn't exist, no collision
  }
  const parsed = parseFrontmatter(body);
  if (!parsed) return candidatePath;
  const existingRefs = extractRawFileRefs(parsed.data).map((r) => canonicalize(r));
  if (existingRefs.includes(canonicalize(currentRawRel))) return candidatePath; // same raw, idempotent
  // Collision: different raw wants the same slug. Append short hash of the raw path.
  const suffix = shortHash(currentRawRel);
  return candidatePath.replace(/\.md$/i, `-${suffix}.md`);
}

async function resolveSourceRel(vault, rawPath) {
  const raw = String(rawPath).trim();
  const explicitRoot = raw.startsWith("./") || raw.startsWith(".\\");
  const trimmed = raw.replace(/^\.\//, "").replace(/^\.\\/, "");
  if (explicitRoot || trimmed.includes("/") || trimmed.includes("\\")) {
    return trimmed;
  }

  // Back-compat: a bare filename historically meant raw/<filename>. But
  // list_unprocessed can return root-level files for new users who dropped a
  // pile into the vault root. In that case, passing the listed path directly
  // must compile the root file, not fail looking for raw/<filename>.
  const rootExists = await fileExists(vault.resolveInside(trimmed));
  const rawExists = await fileExists(vault.resolveInside(`raw/${trimmed}`));
  if (rootExists && !rawExists) return trimmed;
  return `raw/${trimmed}`;
}

async function fileExists(abs) {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

function rewriteSourceMetadata(markdown, fileName, rel, rawSha, rawSize) {
  const compilerDefault = `raw/${fileName}`;
  let out = markdown;
  if (rel !== compilerDefault) {
    out = out
      .replace(/^raw_file:\s*"?[^"\n]+"?\s*$/m, `raw_file: ${rel}`)
      .replace(/Original file:\s*`raw\/[^`]+`/, `Original file: \`${rel}\``);
  }
  // Inject raw_sha256 and raw_size after raw_file (always; even when rel matched the default).
  out = out.replace(
    /^raw_file:\s*([^\n]+)$/m,
    `raw_file: $1\nraw_sha256: ${rawSha}\nraw_size: ${rawSize}`
  );
  return out;
}

function buildReview(input, fileName) {
  const inferredSlug = fileName.replace(/\.[^.]+$/, "");
  const placement = input.placement || {};
  const bucket = placement.bucket || input.bucket || "sources";
  const placementPath =
    placement.path ||
    (input.destination_path
      ? input.destination_path
      : `wiki/${bucket === "sources" ? "sources" : bucket}/source-${inferredSlug}.md`);

  return {
    source: "api",
    provider: "margins-mcp",
    reviewedAt: new Date().toISOString(),
    filingPlan: {
      placement: {
        path: placementPath,
        bucket,
        title: input.title || titleize(inferredSlug)
      },
      bucket
    },
    summary: input.summary || "",
    missionFrame: input.missionFrame || (input.summary ? { oneLine: input.summary } : undefined),
    summaryBullets: input.summaryBullets || (input.summary ? [input.summary] : []),
    takeaways: normalizeTakeaways(input.takeaways),

    // Rich source-page fields (Brooks-shape rendering)
    pageType: normalizePageType(input.pageType),
    tags: normalizeStringList(input.tags),
    keyLinks: normalizeStringList(input.keyLinks),
    eventDate: typeof input.eventDate === "string" ? input.eventDate.trim() : "",
    sourceUrl: typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "",
    participants: normalizeStringList(input.participants),
    sources: normalizeStringList(input.sources),
    headerNote: typeof input.headerNote === "string" ? input.headerNote.trim() : "",
    sourceCaveat: typeof input.sourceCaveat === "string" ? input.sourceCaveat.trim() : "",
    sections: normalizeSections(input.sections),
    relevanceCallout: normalizeCallout(input.relevanceCallout),
    applications: normalizeStringList(input.applications),
    propagationNotes: typeof input.propagationNotes === "string" ? input.propagationNotes.trim() : "",
    related: normalizeRelated(input.related)
  };
}

function normalizePageType(value) {
  const allowed = new Set(["source", "concept", "synthesis"]);
  const v = String(value || "").trim().toLowerCase();
  return allowed.has(v) ? v : "source";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeSections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const heading = String(item.heading || "").trim();
      const body = String(item.body || "").trim();
      if (!heading || !body) return null;
      return { heading, body };
    })
    .filter(Boolean);
}

function normalizeCallout(value) {
  if (!value || typeof value !== "object") return null;
  const body = String(value.body || "").trim();
  if (!body) return null;
  const links = normalizeStringList(value.links);
  return { body, links };
}

function normalizeRelated(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const slug = item.trim();
        return slug ? { slug, note: "" } : null;
      }
      if (typeof item === "object") {
        const slug = String(item.slug || "").trim();
        if (!slug) return null;
        const note = String(item.note || "").trim();
        return { slug, note };
      }
      return null;
    })
    .filter(Boolean);
}

function extractionFailureHint(err) {
  const message = String(err && err.message ? err.message : err || "");
  if (/GlobalWorkerOptions\.workerSrc|fake worker|pdf\.worker|workerSrc/i.test(message)) {
    return (
      "This is a PDF.js worker configuration failure, not evidence that the PDF is scanned. " +
      "Update/reinstall the Margins MCP bundle and retry."
    );
  }
  return "If the file is a scanned/image-only PDF, run OCR on it first (e.g. ocrmypdf), then retry.";
}

function normalizeTakeaways(takeaways) {
  if (!Array.isArray(takeaways)) return [];
  return takeaways
    .map((t) => {
      if (!t) return null;
      if (typeof t === "string") return { point: t };
      if (typeof t === "object") return { point: t.point || "", evidence: t.evidence };
      return null;
    })
    .filter(Boolean);
}

function titleize(slug) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function buildNotFoundError(vault, rel) {
  const wantedInRaw = rel.startsWith("raw/");
  if (wantedInRaw) {
    const requested = rel.slice(4);
    let entries;
    try {
      entries = await readdir(vault.resolveInside("raw"), { withFileTypes: true });
    } catch {
      return `raw/ directory not found in this vault. Drop a supported source file (${supportedExtensionsList()}) anywhere in the vault, then try again. (Files can live anywhere — raw/ is the conventional inbox.)`;
    }
    const available = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => !n.startsWith("."));
    if (available.length === 0) {
      return `file not found: ${rel}. The raw/ folder is empty — drop your source file in the vault (anywhere; raw/ is just a convention).`;
    }
    const closest = findClosest(requested, available);
    if (closest && closest !== requested) {
      return `file not found: ${rel}. Did you mean: raw/${closest}?`;
    }
    const preview = available.slice(0, 5).join(", ");
    const more = available.length > 5 ? `, +${available.length - 5} more` : "";
    return `file not found: ${rel}. Available in raw/: ${preview}${more}.`;
  }
  return `file not found: ${rel}. Confirm the path is relative to the vault root.`;
}

function findClosest(target, candidates) {
  if (!candidates.length) return null;
  const lower = target.toLowerCase();
  let best = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  const threshold = Math.max(2, Math.floor(Math.max(target.length, best.length) / 2));
  if (bestDistance > threshold) return null;
  return best;
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
