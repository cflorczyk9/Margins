import path from "node:path";

export function createPrimer(vault) {
  async function summarize() {
    const files = await vault.listFiles();
    if (!files.length) {
      return {
        totalFiles: 0,
        foldersByCount: [],
        suggestedQueries: [
          "Drop some markdown files into your vault, then ask me again.",
          "Try `propose_page` to create your first note.",
          "Check the vault root: " + vault.root
        ]
      };
    }

    const counts = new Map();
    for (const abs of files) {
      const rel = vault.toRel(abs);
      const folder = rel.split("/").slice(0, -1).join("/") || "(root)";
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }

    const foldersByCount = [...counts.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => b.count - a.count);

    const topFolders = foldersByCount.slice(0, 5);
    const suggestedQueries = buildSuggestions(topFolders);

    return {
      totalFiles: files.length,
      foldersByCount: foldersByCount.slice(0, 15),
      suggestedQueries
    };
  }

  return { summarize };
}

function buildSuggestions(topFolders) {
  if (!topFolders.length) return [];
  const out = [];
  const folderLabel = (f) => (f.folder === "(root)" ? "the root folder" : `${f.folder}/`);

  out.push(
    `Use list_recent to see what I've changed recently — it'll surface fresh notes from across ${folderLabel(topFolders[0])} and elsewhere.`
  );

  if (topFolders[0]) {
    out.push(
      `Use search_vault to find pages by keyword. ${topFolders[0].count} pages live in ${folderLabel(topFolders[0])} — try a query that would hit it.`
    );
  }

  if (topFolders.length >= 2) {
    out.push(
      `Ask: "what threads connect ${folderLabel(topFolders[0]).replace(/\/$/, "")} and ${folderLabel(topFolders[1]).replace(/\/$/, "")}?" The vault has ${topFolders[0].count} and ${topFolders[1].count} pages there respectively.`
    );
  } else {
    out.push(
      `Ask: "summarize my recent notes from this week" — I'll combine list_recent and read_page to pull them together.`
    );
  }

  return out;
}

export function formatSummary(summary) {
  if (summary.totalFiles === 0) {
    return [
      "Your vault is empty.",
      "",
      ...summary.suggestedQueries.map((q) => `- ${q}`)
    ].join("\n");
  }
  const folderLines = summary.foldersByCount
    .map((f) => `  ${f.folder.padEnd(40)} ${f.count} pages`)
    .join("\n");
  return [
    `Vault: ${summary.totalFiles} markdown files across ${summary.foldersByCount.length}+ folders.`,
    "",
    "Top folders:",
    folderLines,
    "",
    "Try asking me:",
    ...summary.suggestedQueries.map((q) => `- ${q}`)
  ].join("\n");
}
