import { readFile, stat } from "node:fs/promises";

// The vault's CLAUDE.md is the user's operating manual for their own vault.
// Margins injects it into the conversation start context so Claude obeys
// vault-specific rules without the user having to copy-paste them.
const MANUAL_NAMES = ["CLAUDE.md", "claude.md", "OPERATING.md"];

export async function readVaultManual(vault) {
  for (const name of MANUAL_NAMES) {
    const abs = vault.resolveInside(name);
    try {
      await stat(abs);
      const body = await readFile(abs, "utf8");
      return { name, body };
    } catch {
      continue;
    }
  }
  return null;
}
