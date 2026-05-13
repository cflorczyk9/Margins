import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { compileVault } from "../../src/compiler.js";

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
      throw new Error(`raw file not found: ${fullRawPath}`);
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
