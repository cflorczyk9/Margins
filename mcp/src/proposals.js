import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const PROPOSED_DIR = "proposed";

export function createProposals(vault) {
  function resolveProposed(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return vault.resolveInside(`${PROPOSED_DIR}/${safe}`);
  }

  function relProposal(rel) {
    const safe = vault.toRel(vault.resolveInside(rel));
    return `${PROPOSED_DIR}/${safe}`;
  }

  async function exists(abs) {
    try {
      await stat(abs);
      return true;
    } catch {
      return false;
    }
  }

  async function readCurrentBody(rel) {
    const proposedAbs = resolveProposed(rel);
    if (await exists(proposedAbs)) {
      return { body: await readFile(proposedAbs, "utf8"), source: "proposal" };
    }
    const vaultAbs = vault.resolveInside(rel);
    if (await exists(vaultAbs)) {
      return { body: await readFile(vaultAbs, "utf8"), source: "vault" };
    }
    return { body: null, source: null };
  }

  async function writeProposal(rel, body) {
    const abs = resolveProposed(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
    return { proposalPath: relProposal(rel), destinationPath: rel };
  }

  async function proposePage(rel, body) {
    if (!rel || typeof rel !== "string") {
      throw new Error("path is required");
    }
    if (rel.startsWith(PROPOSED_DIR + "/") || rel === PROPOSED_DIR) {
      throw new Error(`destination path cannot start with ${PROPOSED_DIR}/`);
    }
    const vaultAbs = vault.resolveInside(rel);
    if (await exists(vaultAbs)) {
      throw new Error(
        `${rel} already exists in vault. Use propose_edit or append_to instead.`
      );
    }
    const replaced = await exists(resolveProposed(rel));
    const result = await writeProposal(rel, body);
    return { ...result, replacedExisting: replaced };
  }

  async function proposeEdit(rel, before, after) {
    if (!before) throw new Error("'before' is required and must be non-empty");
    if (typeof after !== "string") {
      throw new Error("'after' is required (use empty string to delete)");
    }
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`edit path cannot start with ${PROPOSED_DIR}/`);
    }
    const { body, source } = await readCurrentBody(rel);
    if (body === null) {
      throw new Error(`${rel} does not exist. Use propose_page to create it.`);
    }
    const occurrences = countOccurrences(body, before);
    if (occurrences === 0) {
      throw new Error(`'before' text not found in ${rel}.`);
    }
    if (occurrences > 1) {
      throw new Error(
        `'before' appears ${occurrences} times in ${rel}; add surrounding context so it's unique.`
      );
    }
    const newBody = body.replace(before, after);
    const result = await writeProposal(rel, newBody);
    return { ...result, readFrom: source };
  }

  async function appendTo(rel, content) {
    if (typeof content !== "string") throw new Error("'content' is required");
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      throw new Error(`append path cannot start with ${PROPOSED_DIR}/`);
    }
    const { body } = await readCurrentBody(rel);
    const base = body ?? "";
    const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
    const newBody = base + separator + content;
    return writeProposal(rel, newBody);
  }

  async function listProposals() {
    const root = vault.resolveInside(PROPOSED_DIR);
    if (!(await exists(root))) return [];
    const out = [];
    await walk(root, root, out);
    out.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
    return out;
  }

  async function walk(root, dir, out) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(root, abs, out);
      } else if (entry.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const vaultAbs = vault.resolveInside(rel);
        out.push({
          proposalPath: `${PROPOSED_DIR}/${rel}`,
          destinationPath: rel,
          willOverwrite: await exists(vaultAbs),
          size: (await stat(abs)).size
        });
      }
    }
  }

  async function resolveProposal(rel, action) {
    if (rel.startsWith(PROPOSED_DIR + "/")) {
      rel = rel.slice(PROPOSED_DIR.length + 1);
    }
    const proposalAbs = resolveProposed(rel);
    if (!(await exists(proposalAbs))) {
      throw new Error(`no pending proposal for ${rel}`);
    }
    if (action === "reject") {
      await rm(proposalAbs, { force: true });
      return { destinationPath: rel, action: "rejected" };
    }
    if (action === "accept") {
      const destAbs = vault.resolveInside(rel);
      await mkdir(path.dirname(destAbs), { recursive: true });
      await rename(proposalAbs, destAbs);
      return { destinationPath: rel, action: "accepted" };
    }
    throw new Error(`unknown action '${action}'; use 'accept' or 'reject'`);
  }

  return {
    proposePage,
    proposeEdit,
    appendTo,
    listProposals,
    resolveProposal
  };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
