import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

// Preferences live INSIDE the vault at .margins/preferences.md.
// Vault-scoped (not user-scoped) so they travel with the vault between machines
// and stay readable as plain Markdown the user can audit or hand-edit.
const PREFS_REL = ".margins/preferences.md";

const PREFS_HEADER = `# Vault preferences

Margins-learned conventions. Claude appends here when the user corrects a proposal
or states a durable rule. The file is plain Markdown — you can audit it, hand-edit
it, or delete sections that no longer apply.

`;

export function createPreferences(vault) {
  function absPath() {
    return vault.resolveInside(PREFS_REL);
  }

  async function exists() {
    try {
      await stat(absPath());
      return true;
    } catch {
      return false;
    }
  }

  async function read() {
    if (!(await exists())) return "";
    return readFile(absPath(), "utf8");
  }

  async function append(observation, { category } = {}) {
    if (!observation || !observation.trim()) {
      throw new Error("observation is required");
    }
    const trimmed = observation.trim();
    const today = new Date().toISOString().slice(0, 10);

    let body = await read();
    if (!body) {
      body = PREFS_HEADER;
    }

    const heading = `## ${today}`;
    const tag = category ? ` (${category})` : "";
    const bullet = `- ${trimmed}${tag}`;

    if (body.includes(`\n${heading}\n`) || body.startsWith(`${heading}\n`)) {
      // Append to the existing dated section.
      body = body.replace(
        new RegExp(`(${escapeRegExp(heading)}\\n[\\s\\S]*?)(?=\\n## |$)`),
        (match) => `${match.trimEnd()}\n${bullet}\n`
      );
    } else {
      // Start a new dated section at the end.
      body = body.trimEnd() + `\n\n${heading}\n${bullet}\n`;
    }

    await mkdir(path.dirname(absPath()), { recursive: true });
    await writeFile(absPath(), body, "utf8");
    return { observation: trimmed, category: category || null, date: today, path: PREFS_REL };
  }

  async function recent(limit = 5) {
    const body = await read();
    if (!body) return [];
    const bullets = [];
    let currentDate = null;
    for (const line of body.split(/\r?\n/)) {
      const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        currentDate = dateMatch[1];
        continue;
      }
      const bulletMatch = line.match(/^- (.+)$/);
      if (bulletMatch && currentDate) {
        bullets.push({ date: currentDate, text: bulletMatch[1] });
      }
    }
    bullets.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return bullets.slice(0, limit);
  }

  return { absPath, exists, read, append, recent, relPath: PREFS_REL };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
