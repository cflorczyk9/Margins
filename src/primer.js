import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readVaultManual } from "./vault-manual.js";
import { classifyVault, suggestionsForPersona } from "./persona.js";

export function createPrimer(vault, { proposals, preferences } = {}) {
  async function summarize() {
    const files = await vault.listFiles();
    const persona = await classifyVault(vault);
    const summary = {
      totalFiles: files.length,
      foldersByCount: [],
      suggestedQueries: [],
      persona,
      pendingProposals: { count: 0, paths: [] },
      uningestedRaw: { count: 0, files: [] },
      recentPreferences: [],
      vaultManual: null
    };

    if (files.length) {
      const counts = new Map();
      for (const abs of files) {
        const rel = vault.toRel(abs);
        const folder = rel.split("/").slice(0, -1).join("/") || "(root)";
        counts.set(folder, (counts.get(folder) || 0) + 1);
      }
      summary.foldersByCount = [...counts.entries()]
        .map(([folder, count]) => ({ folder, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
    }
    summary.suggestedQueries = suggestionsForPersona(persona, summary.foldersByCount.slice(0, 5));

    if (proposals) {
      const pending = await proposals.listProposals();
      summary.pendingProposals = {
        count: pending.length,
        paths: pending.slice(0, 10).map((p) => p.destinationPath)
      };
    }

    summary.uningestedRaw = await detectUningestedRaw(vault);

    if (preferences) {
      summary.recentPreferences = await preferences.recent(5);
    }

    summary.vaultManual = await readVaultManual(vault);

    return summary;
  }

  return { summarize };
}

async function detectUningestedRaw(vault) {
  const rawDir = vault.resolveInside("raw");
  let rawFiles;
  try {
    rawFiles = await readdir(rawDir, { withFileTypes: true });
  } catch {
    return { count: 0, files: [] };
  }
  const rawNames = rawFiles
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => !name.startsWith("."));

  if (!rawNames.length) return { count: 0, files: [] };

  // Build a set of slugs that already have a source page somewhere in the vault.
  // Heuristic: filename without extension shows up as "source-<slug>.md" anywhere.
  const allFiles = await vault.listFiles();
  const ingestedSlugs = new Set();
  for (const abs of allFiles) {
    const base = path.basename(abs, path.extname(abs));
    if (base.startsWith("source-")) {
      ingestedSlugs.add(base.slice("source-".length));
    }
  }

  const uningested = rawNames.filter((name) => {
    const slug = path.basename(name, path.extname(name));
    return !ingestedSlugs.has(slug);
  });

  return {
    count: uningested.length,
    files: uningested.slice(0, 10)
  };
}

export function formatSummary(summary) {
  const lines = [];
  if (summary.persona) {
    lines.push(`Vault persona: ${summary.persona.code} — ${summary.persona.label}`);
    lines.push("");
  }
  if (summary.totalFiles === 0) {
    lines.push("Your vault is empty.");
  } else {
    lines.push(
      `Vault: ${summary.totalFiles} markdown files across ${summary.foldersByCount.length}+ folders.`
    );
    lines.push("");
    lines.push("Top folders:");
    for (const f of summary.foldersByCount) {
      lines.push(`  ${f.folder.padEnd(40)} ${f.count} pages`);
    }
  }

  if (summary.uningestedRaw.count > 0) {
    lines.push("");
    lines.push(`Uningested raw files: ${summary.uningestedRaw.count}`);
    for (const f of summary.uningestedRaw.files) {
      lines.push(`  raw/${f}`);
    }
    lines.push("  → Ingest by calling propose_compile_from_raw on each one.");
  }

  if (summary.pendingProposals.count > 0) {
    lines.push("");
    lines.push(`Pending proposals: ${summary.pendingProposals.count}`);
    for (const p of summary.pendingProposals.paths) {
      lines.push(`  proposed/${p}`);
    }
    lines.push("  → Review with list_proposals, accept with resolve_proposal.");
  }

  if (summary.recentPreferences.length > 0) {
    lines.push("");
    lines.push("Recent user preferences (follow these before proposing writes):");
    for (const p of summary.recentPreferences) {
      lines.push(`  - ${p.text}  (${p.date})`);
    }
  }

  if (summary.vaultManual) {
    lines.push("");
    lines.push(`Vault operating manual (from ${summary.vaultManual.name}):`);
    lines.push("---");
    lines.push(summary.vaultManual.body.trim());
    lines.push("---");
  }

  if (summary.suggestedQueries.length > 0) {
    lines.push("");
    lines.push("Try asking me:");
    for (const q of summary.suggestedQueries) {
      lines.push(`- ${q}`);
    }
  }

  return lines.join("\n");
}
