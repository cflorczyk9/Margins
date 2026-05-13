import { readdir } from "node:fs/promises";
import path from "node:path";
import { readVaultManual } from "./vault-manual.js";
import { classifyVault, suggestionsForPersona } from "./persona.js";
import { samplePileBySnippets, detectFilenamePatterns } from "./pile-sampler.js";
import { scanRawForCompile } from "./pile-scan.js";
import { checkForUpdate } from "./version-check.js";
import { readConsent } from "./telemetry.js";

// Mode dispatch. Each persona maps to a response shape tuned for what that
// user actually needs from Claude at the start of a conversation.
//
//   A1/B1 (organized + linked) → synthesis: folder stats, proposals, manual.
//                                  Claude grounds answers in known structure.
//   A2/B2 (empty)              → empty: prompt the user to put files in.
//   A3/B3 (pile, no links)     → pile: representative sample + recurring
//                                  phrases + filename shapes. Claude names
//                                  what it sees and offers to organize.
//
// The pile mode is the load-bearing case for new installs — most users drop
// in a folder of unstructured stuff. Stats won't help them; a "I see what
// this is" moment will.

function modeFor(persona) {
  switch (persona.code) {
    case "A1":
    case "B1": return "synthesis";
    case "A2":
    case "B2": return "empty";
    case "A3":
    case "B3": return "pile";
    default:   return "synthesis";
  }
}

const GUIDANCE_BY_MODE = {
  pile:
    "This vault has files but little linking structure. If rawScan.priorityQueue " +
    "is non-empty, the user dropped source files into raw/ — your best move is " +
    "to start compiling the highest-priority ones into wiki source pages right " +
    "away. Call propose_compile_from_raw on each priorityQueue entry IN PARALLEL " +
    "in a single turn (read_page first to get the body, then propose_compile_from_raw " +
    "with a structured summary). The original stays in raw/; a summary lands in " +
    "wiki/sources/. After the first batch of proposals is staged, report back to " +
    "the user (X source pages staged, N remaining) and ask whether to continue " +
    "at this pace, focus on a specific topic, or stop. " +
    "Skip files in rawScan.duplicateGroups (keep the oldest) and rawScan.likelyEmpty. " +
    "If priorityQueue is empty (no raw/ folder, or everything already compiled), " +
    "read the sample directly and describe what you see in 2-3 sentences, then " +
    "offer concrete next moves: propose_wikilinks on a specific page, search_vault " +
    "by topic, or draft a top-level page that catalogs the vault.",
  empty:
    "This vault is empty or nearly empty. Ask the user what they want to put in it " +
    "(research notes, journal, project docs) and offer to scaffold templates via " +
    "propose_page.",
  synthesis:
    "This vault is organized and linked. Use search_vault, list_recent, and the " +
    "folder stats to ground your answers. Always cite specific file paths."
};

export function createPrimer(vault, { proposals, preferences } = {}) {
  async function summarize() {
    const files = await vault.listFiles();
    const persona = await classifyVault(vault);
    const mode = modeFor(persona);

    const summary = {
      mode,
      persona,
      totalFiles: files.length,
      foldersByCount: foldersByCount(files, vault),
      suggestedQueries: [],
      pendingProposals: { count: 0, paths: [] },
      uningestedRaw: { count: 0, files: [] },
      recentPreferences: [],
      vaultManual: null,
      guidance: GUIDANCE_BY_MODE[mode] || ""
    };

    summary.suggestedQueries = suggestionsForPersona(persona, summary.foldersByCount.slice(0, 5));

    if (proposals) {
      const pending = await proposals.listProposals();
      summary.pendingProposals = {
        count: pending.length,
        paths: pending.slice(0, 10).map((p) => p.destinationPath)
      };
    }

    summary.uningestedRaw = await detectUningestedRaw(vault);
    if (preferences) summary.recentPreferences = await preferences.recent(5);
    summary.vaultManual = await readVaultManual(vault);

    if (mode === "pile") {
      const pile = await samplePileBySnippets(vault, { count: 18 });
      const relPaths = files.map((abs) => vault.toRel(abs));
      summary.sample = pile.sample;
      summary.earliestMtime = pile.earliestMtime;
      summary.latestMtime = pile.latestMtime;
      summary.filenamePatterns = detectFilenamePatterns(relPaths);
      summary.rawScan = await scanRawForCompile(vault, { topN: 5 });
    }

    // Update check (silent on failure) — surfaces an updateAvailable hint
    // when the installed version is behind the latest published on npm.
    // Cached 24h per vault. Works for both npm and .mcpb install channels.
    try {
      const upd = await checkForUpdate(vault);
      if (upd) summary.updateAvailable = upd;
    } catch {
      // never block startup
    }

    // Chat-flow telemetry consent fallback — used when a user installed via
    // .mcpb double-click and never saw the CLI consent prompt. If no consent
    // record exists, flag it; Claude relays the question in chat and calls
    // record_telemetry_consent with the answer.
    const consent = await readConsent();
    if (!consent) summary.telemetryConsentNeeded = true;

    return summary;
  }

  return { summarize };
}

function foldersByCount(files, vault) {
  if (!files.length) return [];
  const counts = new Map();
  for (const abs of files) {
    const rel = vault.toRel(abs);
    const folder = rel.split("/").slice(0, -1).join("/") || "(root)";
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
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

  return { count: uningested.length, files: uningested.slice(0, 10) };
}

export function formatSummary(summary) {
  if (summary.mode === "pile") return formatPileSummary(summary);
  if (summary.mode === "empty") return formatEmptySummary(summary);
  return formatSynthesisSummary(summary);
}

function formatPileSummary(summary) {
  const lines = [];
  lines.push(`Mode: pile — ${summary.persona.code}: ${summary.persona.label}`);
  lines.push("");

  const earliest = summary.earliestMtime
    ? new Date(summary.earliestMtime).toISOString().slice(0, 10)
    : "?";
  const latest = summary.latestMtime
    ? new Date(summary.latestMtime).toISOString().slice(0, 10)
    : "?";
  lines.push(`Vault: ${summary.totalFiles} markdown files, dating ${earliest} → ${latest}.`);
  lines.push("");

  if (summary.rawScan && summary.rawScan.totalRawFiles > 0) {
    const rs = summary.rawScan;
    lines.push(
      `raw/: ${rs.totalRawFiles} files (${rs.uncompiledCount} uncompiled, ` +
      `${rs.alreadyCompiledCount} already have a source page).`
    );
    if (rs.duplicateGroups.length) {
      lines.push(`  Duplicate groups: ${rs.duplicateGroups.length} (will skip duplicates, keep oldest).`);
    }
    if (rs.likelyEmpty.length) {
      lines.push(`  Likely empty (skip): ${rs.likelyEmpty.length} files.`);
    }
    if (rs.detectedPrefixes.length) {
      const prefixSummary = rs.detectedPrefixes
        .slice(0, 4)
        .map((p) => `${p.prefix}- (${p.count})`)
        .join(", ");
      lines.push(`  Detected prefixes: ${prefixSummary}.`);
    }
    if (rs.priorityQueue.length) {
      lines.push("");
      lines.push(`Priority queue — start by compiling these ${rs.priorityQueue.length} files (call propose_compile_from_raw on each, in parallel):`);
      for (const q of rs.priorityQueue) {
        lines.push(`  [${q.score.toFixed(2)}] ${q.path}  (${q.reason})`);
      }
    }
    lines.push("");
  }

  if (summary.filenamePatterns?.length) {
    lines.push("Filename patterns (across whole vault):");
    for (const p of summary.filenamePatterns) {
      const ex = p.examples[0] ? `   e.g. ${p.examples[0]}` : "";
      lines.push(`  ${p.pattern.padEnd(28)} ${String(p.count).padStart(4)} files${ex}`);
    }
    lines.push("");
  }

  if (summary.sample?.length) {
    lines.push(`Sample of ${summary.sample.length} vault files (stratified across time):`);
    lines.push("");
    for (const f of summary.sample) {
      const date = new Date(f.mtimeMs).toISOString().slice(0, 10);
      lines.push(`--- ${f.path}  (${date}, ${f.size}b)`);
      lines.push(f.snippet || "(empty)");
      lines.push("");
    }
  }

  appendCommonSections(lines, summary);
  appendGuidance(lines, summary);
  return lines.join("\n");
}

function formatEmptySummary(summary) {
  const lines = [];
  lines.push(`Mode: empty — ${summary.persona.code}: ${summary.persona.label}`);
  lines.push("");
  if (summary.totalFiles === 0) {
    lines.push("Your vault is empty.");
  } else {
    lines.push(
      `Vault: ${summary.totalFiles} markdown files across ${summary.foldersByCount.length}+ folders.`
    );
    if (summary.foldersByCount.length) {
      lines.push("");
      lines.push("Folders:");
      for (const f of summary.foldersByCount) {
        lines.push(`  ${f.folder.padEnd(40)} ${f.count} pages`);
      }
    }
  }
  appendCommonSections(lines, summary);
  if (summary.suggestedQueries.length > 0) {
    lines.push("");
    lines.push("Try asking me:");
    for (const q of summary.suggestedQueries) lines.push(`- ${q}`);
  }
  appendGuidance(lines, summary);
  return lines.join("\n");
}

function formatSynthesisSummary(summary) {
  const lines = [];
  lines.push(`Mode: synthesis — ${summary.persona.code}: ${summary.persona.label}`);
  lines.push("");
  lines.push(
    `Vault: ${summary.totalFiles} markdown files across ${summary.foldersByCount.length}+ folders.`
  );
  lines.push("");
  lines.push("Top folders:");
  for (const f of summary.foldersByCount) {
    lines.push(`  ${f.folder.padEnd(40)} ${f.count} pages`);
  }

  appendCommonSections(lines, summary);

  if (summary.suggestedQueries.length > 0) {
    lines.push("");
    lines.push("Try asking me:");
    for (const q of summary.suggestedQueries) lines.push(`- ${q}`);
  }
  appendGuidance(lines, summary);
  return lines.join("\n");
}

function appendCommonSections(lines, summary) {
  if (summary.uningestedRaw.count > 0) {
    lines.push("");
    lines.push(`Uningested raw files: ${summary.uningestedRaw.count}`);
    for (const f of summary.uningestedRaw.files) lines.push(`  raw/${f}`);
    lines.push("  -> Ingest by calling propose_compile_from_raw on each one.");
  }
  if (summary.pendingProposals.count > 0) {
    lines.push("");
    lines.push(`Pending proposals: ${summary.pendingProposals.count}`);
    for (const p of summary.pendingProposals.paths) lines.push(`  proposed/${p}`);
    lines.push("  -> Review with list_proposals, accept with resolve_proposal.");
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
}

function appendGuidance(lines, summary) {
  if (summary.updateAvailable) {
    lines.push("");
    lines.push(
      `[!] Margins update available: ${summary.updateAvailable.current} -> ${summary.updateAvailable.latest}. ` +
        summary.updateAvailable.hint
    );
    lines.push("   Mention this to the user once at the start of the conversation.");
  }
  if (summary.telemetryConsentNeeded) {
    lines.push("");
    lines.push(
      "[!] Telemetry consent not yet recorded. Ask the user once in chat: " +
        "'Margins can send anonymous tool-use counts (no vault content, no file paths) " +
        "to help guide what gets built next. Opt in?' Then call record_telemetry_consent " +
        "with enabled=true or enabled=false based on their answer."
    );
  }
  if (summary.guidance) {
    lines.push("");
    lines.push("Guidance:");
    lines.push(summary.guidance);
  }
}
