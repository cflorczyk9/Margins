// Vault context surface for the model: entity slugs, active project slugs,
// and the in-use semantic tag taxonomy. Powers `get_vault_context`.
//
// Why this exists: when the model compiles a raw file into a source page, it
// needs to wikilink entities ([[ellis-rutili]] not "Ellis"), tag with the
// vault's existing taxonomy, and surface the active projects/decisions a
// source bears on. Without this, every compile is a wikilink-poor island.
//
// Cache strategy: keyed on the max mtime across markdown files in the wiki
// roots. If nothing has changed, return the cached payload. Cheap enough to
// recheck on every call; avoids re-parsing 1000+ files when nothing changed.

import { readFile, stat } from "node:fs/promises";
import { parseFrontmatter } from "./frontmatter.js";

const ENTITY_FRONTMATTER_TYPES = new Set(["entity", "person", "company", "organization", "place", "tool", "project"]);
const ACTIVE_PROJECT_TYPES = new Set(["project", "synthesis", "concept"]);
const REGION_VIBRANCE_RE = /^(region|vibrance)\//i;
const ACTIVE_RECENCY_DAYS = 60;
const MAX_ENTITIES = 200;
const MAX_PROJECTS = 80;
const MAX_TAGS = 120;

export function createVaultContext(vault) {
  let cache = null;

  async function get({ refresh = false } = {}) {
    const files = await vault.listFiles();
    const wikiFiles = files.filter((abs) => {
      const rel = vault.toRel(abs);
      return rel.startsWith("wiki/") &&
        rel.endsWith(".md") &&
        !rel.startsWith("wiki/.margins/") &&
        !rel.startsWith("wiki/_templates/");
    });

    let maxMtime = 0;
    const stats = [];
    for (const abs of wikiFiles) {
      try {
        const info = await stat(abs);
        stats.push({ abs, mtimeMs: info.mtimeMs });
        if (info.mtimeMs > maxMtime) maxMtime = info.mtimeMs;
      } catch {
        // skip unreadable
      }
    }

    if (!refresh && cache && cache.cacheKey === `${wikiFiles.length}:${maxMtime}`) {
      return cache.payload;
    }

    const cutoffMs = Date.now() - ACTIVE_RECENCY_DAYS * 24 * 60 * 60 * 1000;
    const entities = [];
    const projects = [];
    const tagCounts = new Map();
    const linkCounts = new Map();

    for (const { abs, mtimeMs } of stats) {
      let body;
      try {
        body = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const rel = vault.toRel(abs);
      const slug = slugFromPath(rel);
      const parsed = parseFrontmatter(body);
      const fm = parsed?.data || {};
      const type = String(fm.type || "").trim().toLowerCase();
      const summary = cleanLine(fm.summary || "");
      const title = extractH1(body) || titleFromSlug(slug);
      const priority = String(fm.priority || "").trim().toLowerCase();

      // Tally tags (excluding region/vibrance)
      const tags = parseTagList(fm.tags);
      for (const tag of tags) {
        if (REGION_VIBRANCE_RE.test(tag)) continue;
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }

      // Tally inbound wikilinks (for backlink-based entity detection)
      for (const link of extractWikilinkSlugs(body)) {
        linkCounts.set(link, (linkCounts.get(link) || 0) + 1);
      }

      // Entity candidacy
      if (ENTITY_FRONTMATTER_TYPES.has(type) || rel.startsWith("wiki/entities/") || rel.startsWith("wiki/people/")) {
        entities.push({ slug, title, type: type || "entity", oneLine: summary });
      }

      // Active project candidacy
      const isProjectShape = ACTIVE_PROJECT_TYPES.has(type) || rel.startsWith("wiki/projects/");
      const isActive = priority === "active" || mtimeMs >= cutoffMs;
      if (isProjectShape && isActive) {
        projects.push({ slug, title, priority: priority || (mtimeMs >= cutoffMs ? "recent" : ""), oneLine: summary });
      }
    }

    // Augment entities with high-backlink slugs that don't yet have a page
    // — surfaces names the user keeps mentioning even if no entity page exists.
    const slugSet = new Set(entities.map((e) => e.slug));
    const inferredEntities = [...linkCounts.entries()]
      .filter(([slug, count]) => count >= 3 && !slugSet.has(slug))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([slug]) => ({ slug, title: titleFromSlug(slug), type: "inferred", oneLine: "" }));

    const combinedEntities = entities
      .concat(inferredEntities)
      .slice(0, MAX_ENTITIES);

    const sortedProjects = projects
      .sort((a, b) => (a.priority === "active" ? -1 : 1) - (b.priority === "active" ? -1 : 1))
      .slice(0, MAX_PROJECTS);

    const sortedTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TAGS)
      .map(([tag]) => tag);

    const payload = {
      entities: combinedEntities,
      activeProjects: sortedProjects,
      tags: sortedTags,
      generatedAt: new Date().toISOString(),
      vaultFiles: wikiFiles.length
    };

    cache = { cacheKey: `${wikiFiles.length}:${maxMtime}`, payload };
    return payload;
  }

  function invalidate() {
    cache = null;
  }

  return { get, invalidate };
}

function slugFromPath(rel) {
  const name = rel.split("/").pop() || rel;
  return name.replace(/\.md$/i, "");
}

function titleFromSlug(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractH1(body) {
  const match = String(body || "").match(/^#\s+(.+)$/m);
  if (!match) return "";
  return match[1].replace(/^Source:\s*/i, "").trim();
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .slice(0, 220);
}

function parseTagList(value) {
  if (Array.isArray(value)) return value.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((t) => t.trim().replace(/^['"]|['"]$/g, "").toLowerCase()).filter(Boolean);
  }
  return raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function extractWikilinkSlugs(body) {
  const out = [];
  const re = /\[\[([^\]|#]+)/g;
  let match;
  const text = String(body || "");
  while ((match = re.exec(text)) !== null) {
    const slug = match[1].trim().replace(/\.md$/i, "");
    if (slug) out.push(slug);
  }
  return out;
}
