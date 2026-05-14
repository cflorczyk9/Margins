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
  try {
    data = yaml.load(fmText, { schema: yaml.JSON_SCHEMA });
  } catch {
    return null;
  }
  if (data == null) data = {};
  if (typeof data !== "object" || Array.isArray(data)) return null;

  let bodyStart = endIdx + 4;
  if (s[bodyStart] === "\n") bodyStart++;

  return { data, body: s.slice(bodyStart), raw: fmText };
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
