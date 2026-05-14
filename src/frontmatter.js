import yaml from "js-yaml";

/**
 * Parse YAML frontmatter from a markdown document.
 *
 * Returns { data, body, raw } or null if no frontmatter.
 *   data — parsed YAML object (always an object, never an array or scalar)
 *   body — markdown body after the closing ---
 *   raw  — the frontmatter text (after BOM/CRLF normalization)
 *
 * Hardens against the failure modes the ad-hoc regex parser missed:
 *   - UTF-8 BOM at file start (Obsidian sometimes writes these)
 *   - CRLF line endings (Windows-authored or Git auto-converted files)
 *   - Single-quoted, double-quoted, plain, and multiline YAML values
 *   - YAML comments (# at line start)
 *   - YAML arrays for raw_files: lists
 *   - Type values written as "source", 'source', or source (unquoted)
 */
export function parseFrontmatter(body) {
  if (body == null) return null;
  let s = String(body);
  if (!s) return null;

  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!s.startsWith("---\n")) return null;
  const endIdx = s.indexOf("\n---", 4);
  if (endIdx < 0) return null;
  const fmText = s.slice(4, endIdx);

  let data;
  let yamlError = null;
  try {
    data = yaml.load(fmText, { schema: yaml.JSON_SCHEMA });
  } catch (err) {
    yamlError = err;
    // Permissive fallback: extract just the keys Margins needs (type,
    // raw_file, raw_files, source) via line-based regex. Users often write
    // summaries with `: ` in them that break strict YAML; we shouldn't
    // silently drop the page over a punctuation choice. The page enters
    // sourcePages if a type field is recoverable.
    data = permissiveExtract(fmText);
    if (data === null) {
      // Re-throw so the caller can record this as a parse failure.
      throw yamlError;
    }
  }
  if (data == null) data = {};
  if (typeof data !== "object" || Array.isArray(data)) {
    if (yamlError) throw yamlError;
    return null;
  }

  let bodyStart = endIdx + 4;
  if (s[bodyStart] === "\n") bodyStart++;

  return { data, body: s.slice(bodyStart), raw: fmText, recovered: yamlError != null };
}

function permissiveExtract(fmText) {
  const out = {};
  const t = fmText.match(/^type:\s*"?([^"\n]+?)"?\s*$/m);
  if (t) out.type = t[1].trim();
  const rf = fmText.match(/^raw_file:\s*"?([^"\n]+?)"?\s*$/m);
  if (rf) out.raw_file = rf[1].trim();
  const src = fmText.match(/^source:\s*"?([^"\n]+?)"?\s*$/m);
  if (src) out.source = src[1].trim();
  const rfs = fmText.match(/^raw_files:\s*\n((?:[ \t]*-\s+.+(?:\n|$))+)/m);
  if (rfs) {
    const items = [...rfs[1].matchAll(/^\s*-\s+"?([^"\n]+?)"?\s*$/gm)];
    out.raw_files = items.map((m) => m[1].trim());
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Pull every raw-file reference from a parsed frontmatter object.
 * Source pages may use any of: raw_file (string), raw_files (list), source (legacy).
 */
export function extractRawFileRefs(data) {
  if (!data || typeof data !== "object") return [];
  const refs = [];
  if (typeof data.raw_file === "string" && data.raw_file.trim()) {
    refs.push(data.raw_file.trim());
  }
  if (Array.isArray(data.raw_files)) {
    for (const r of data.raw_files) {
      if (typeof r === "string" && r.trim()) refs.push(r.trim());
    }
  }
  if (typeof data.source === "string" && data.source.trim()) {
    refs.push(data.source.trim());
  }
  return refs;
}

export function getType(data) {
  if (!data || typeof data !== "object") return null;
  const t = data.type;
  return typeof t === "string" ? t.trim() : null;
}
