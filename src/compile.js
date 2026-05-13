import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { compileVault } from "./compiler/compiler.js";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export function createCompile(vault, proposals) {
  async function proposeCompileFromRaw(rawPath, review) {
    if (!rawPath || typeof rawPath !== "string") {
      throw new Error("rawPath is required");
    }
    const normalized = rawPath.replace(/^raw\//, "");
    const fullRawPath = `raw/${normalized}`;
    const absRaw = vault.resolveInside(fullRawPath);

    let info;
    try {
      info = await stat(absRaw);
    } catch {
      throw new Error(await buildNotFoundError(vault, fullRawPath, normalized));
    }
    if (!info.isFile()) {
      throw new Error(`not a file: ${fullRawPath}`);
    }

    const ext = path.extname(absRaw).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      throw new Error(
        `unsupported file type ${ext}. Supported: .md, .markdown, .txt. ` +
          `Convert PDFs/DOCX to text first; native binary support is planned for v0.4.`
      );
    }

    const text = await readFile(absRaw, "utf8");
    const fileName = path.basename(absRaw);

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

    const destPath = sourceNode.path;
    const proposalResult = await proposals.proposePage(destPath, sourceNode.markdown);
    return {
      ...proposalResult,
      rawFile: fullRawPath,
      title: sourceNode.title,
      bucket: sourceNode.path.split("/")[1] || "sources",
      summary: sourceNode.summary,
      termsExtracted: sourceNode.terms,
      entitiesExtracted: sourceNode.entities
    };
  }

  return { proposeCompileFromRaw };
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
    takeaways: normalizeTakeaways(input.takeaways)
  };
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

async function buildNotFoundError(vault, fullRawPath, requested) {
  // If raw/ itself is missing, that's the actionable hint.
  let entries;
  try {
    entries = await readdir(vault.resolveInside("raw"), { withFileTypes: true });
  } catch {
    return `raw/ directory not found in this vault. Drop a markdown or text file at <vault>/raw/<your-file> first, then try again.`;
  }
  const available = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !n.startsWith("."));
  if (available.length === 0) {
    return `raw file not found: ${fullRawPath}. The raw/ folder is empty — drop your source file there first.`;
  }
  const closest = findClosest(requested, available);
  if (closest && closest !== requested) {
    return `raw file not found: ${fullRawPath}. Did you mean: raw/${closest}?`;
  }
  const preview = available.slice(0, 5).join(", ");
  const more = available.length > 5 ? `, +${available.length - 5} more` : "";
  return `raw file not found: ${fullRawPath}. Available in raw/: ${preview}${more}.`;
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
  // Only suggest if reasonably close — half the longer string's length, min 2.
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
