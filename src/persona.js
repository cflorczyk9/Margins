import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Persona codes correspond to the 6-cell user-state matrix:
//   A1 = Obsidian, organized + linked vault (Sarah)
//   A2 = Obsidian, empty / near-empty (Jamie)
//   A3 = Obsidian, many files but few wikilinks (Mark)
//   B1 = no Obsidian, organized markdown
//   B2 = no Obsidian, empty / near-empty
//   B3 = no Obsidian, many files but few wikilinks
//
// Margins gives each persona a different first-conversation suggestion set
// so the same margins_start call serves all six well.

export const PERSONA_LABELS = {
  A1: "Obsidian power user with an organized, linked vault",
  A2: "Obsidian user with an empty or near-empty vault",
  A3: "Obsidian user with many files but few wikilinks",
  B1: "Markdown user (no Obsidian) with organized files",
  B2: "Markdown user (no Obsidian) with an empty folder",
  B3: "Markdown user (no Obsidian) with many files but few wikilinks"
};

const WIKILINK_RE = /\[\[[^\]]+\]\]/g;
const EMPTY_THRESHOLD = 5;
const LOW_LINK_THRESHOLD = 0.3; // average wikilinks per file
const SAMPLE_SIZE = 30;

export async function classifyVault(vault) {
  const files = await vault.listFiles();
  const hasObsidian = await dirExists(vault.resolveInside(".obsidian"));

  if (files.length <= EMPTY_THRESHOLD) {
    return {
      code: hasObsidian ? "A2" : "B2",
      hasObsidian,
      fileCount: files.length,
      wikilinkDensity: 0,
      label: PERSONA_LABELS[hasObsidian ? "A2" : "B2"]
    };
  }

  const sample = pickEvenly(files, SAMPLE_SIZE);
  let totalLinks = 0;
  for (const abs of sample) {
    try {
      const body = await readFile(abs, "utf8");
      const matches = body.match(WIKILINK_RE);
      totalLinks += matches ? matches.length : 0;
    } catch {
      // skip unreadable file
    }
  }
  const density = sample.length > 0 ? totalLinks / sample.length : 0;

  let code;
  if (density >= LOW_LINK_THRESHOLD) {
    code = hasObsidian ? "A1" : "B1";
  } else {
    code = hasObsidian ? "A3" : "B3";
  }

  return {
    code,
    hasObsidian,
    fileCount: files.length,
    wikilinkDensity: Math.round(density * 100) / 100,
    label: PERSONA_LABELS[code]
  };
}

async function dirExists(abs) {
  try {
    const info = await stat(abs);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function pickEvenly(arr, n) {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

export function suggestionsForPersona(persona, topFolders) {
  const { code, hasObsidian, fileCount, wikilinkDensity } = persona;
  const folderLabel = (f) => (f.folder === "(root)" ? "the root folder" : `${f.folder}/`);
  const top = topFolders[0];

  switch (code) {
    case "A1":
    case "B1":
      return [
        top
          ? `Use search_vault to find pages by keyword. ${top.count} pages live in ${folderLabel(top)}.`
          : `Use search_vault to find pages by keyword.`,
        `Use list_recent to see what you've changed recently.`,
        topFolders.length >= 2
          ? `Ask: "what threads connect ${folderLabel(topFolders[0]).replace(/\/$/, "")} and ${folderLabel(topFolders[1]).replace(/\/$/, "")}?"`
          : `Ask: "summarize my recent notes from this week."`
      ];

    case "A2":
    case "B2":
      return [
        `Your vault has ${fileCount} files. Try: "create today's daily note in wiki/daily/ with my plans for today."`,
        hasObsidian
          ? `Ask: "scaffold a daily-notes template and a meeting-notes template that fit my Obsidian workflow."`
          : `Ask: "scaffold a daily-notes template I can use going forward."`,
        `Ask: "what folder structure would you recommend for [my use case: research / journaling / projects]?"`
      ];

    case "A3":
    case "B3":
      return [
        `You have ${fileCount} files but few wikilinks (${wikilinkDensity} per file). Try: "scan ${top ? folderLabel(top).replace(/\/$/, "") + "/something.md" : "any of my pages"} and propose wikilinks to other vault pages."`,
        `Use propose_wikilinks on a single page to surface connections you didn't see yourself.`,
        `Ask: "find duplicate or overlapping topics across my vault."`
      ];

    default:
      return [];
  }
}
