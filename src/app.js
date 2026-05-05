import { compileVault, vaultToFiles } from "./compiler.js";

const state = {
  files: [],
  vault: null,
  selectedPath: null
};

const els = {
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  sourceList: document.getElementById("source-list"),
  compileBtn: document.getElementById("compile-btn"),
  llmBtn: document.getElementById("llm-btn"),
  exportBtn: document.getElementById("export-btn"),
  copyBtn: document.getElementById("copy-btn"),
  wikiTree: document.getElementById("wiki-tree"),
  docTitle: document.getElementById("doc-title"),
  docBody: document.getElementById("doc-body"),
  graphSvg: document.getElementById("graph-svg"),
  stats: document.getElementById("stats"),
  operatorManual: document.getElementById("operator-manual"),
  queryCookbook: document.getElementById("query-cookbook"),
  commandsList: document.getElementById("commands-list"),
  agentsList: document.getElementById("agents-list"),
  editList: document.getElementById("edit-list")
};

els.folderInput.addEventListener("change", handleSourceSelection);
els.fileInput.addEventListener("change", handleSourceSelection);
hydrateChecklist();

async function handleSourceSelection(event) {
  const files = normalizeSelectedFiles([...event.target.files]);
  state.files = await Promise.all(files.map(readBrowserFile));
  state.vault = null;
  state.selectedPath = null;
  renderSources();
  els.compileBtn.disabled = state.files.length === 0;
  els.llmBtn.disabled = state.files.length === 0;
  els.exportBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.stats.textContent = `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
}

els.compileBtn.addEventListener("click", () => {
  state.vault = compileVault(state.files, { name: "Karpathy Original" });
  state.selectedPath = null;
  renderVault();
});

els.llmBtn.addEventListener("click", async () => {
  if (state.files.length === 0) return;
  await navigator.clipboard.writeText(buildLlmIngestPrompt(state.files));
  els.llmBtn.textContent = "Copied";
  setTimeout(() => { els.llmBtn.textContent = "Copy LLM ingest prompt"; }, 1100);
});

els.exportBtn.addEventListener("click", () => {
  if (!state.vault) return;
  const files = Object.fromEntries(vaultToFiles(state.vault));
  download("margins-vault.json", JSON.stringify({
    raw_sources: state.vault.rawSources.map(({ name, text }) => ({ name, text })),
    files
  }, null, 2));
});

els.copyBtn.addEventListener("click", async () => {
  if (!state.vault) return;
  await navigator.clipboard.writeText(state.vault.operatingLayer.operatorManual);
  els.copyBtn.textContent = "Copied";
  setTimeout(() => { els.copyBtn.textContent = "Copy operator manual"; }, 1100);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`${tab.dataset.view}-view`).classList.add("active");
  });
});

document.querySelectorAll("[data-check-id]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    localStorage.setItem(`margins-check-${checkbox.dataset.checkId}`, checkbox.checked ? "1" : "0");
  });
});

function renderSources() {
  if (state.files.length === 0) {
    els.sourceList.className = "source-list empty";
    els.sourceList.textContent = "No sources loaded.";
    return;
  }
  els.sourceList.className = "source-list";
  els.sourceList.innerHTML = state.files.map((file) => `
    <div class="source-item ${file.text ? "" : "needs-extraction"}">
      <strong>${escapeHtml(file.name)}</strong>
      <span>${file.text ? `${wordCount(file.text)} words` : "needs text extraction or LLM attachment"}</span>
    </div>
  `).join("");
}

function hydrateChecklist() {
  document.querySelectorAll("[data-check-id]").forEach((checkbox) => {
    checkbox.checked = localStorage.getItem(`margins-check-${checkbox.dataset.checkId}`) === "1";
  });
}

function renderVault() {
  const vault = state.vault;
  const fileMap = vaultToFiles(vault);
  const entries = [...fileMap.entries()].filter(([path]) => path.startsWith("wiki/") && path.endsWith(".md"));

  els.exportBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.stats.textContent = `${vault.manifest.counts.raw_sources} sources · ${vault.wiki.graph.nodes.length} nodes · ${vault.wiki.graph.edges.length} edges`;

  els.wikiTree.className = "tree-list";
  els.wikiTree.innerHTML = entries.map(([path, body]) => `
    <div class="tree-item" data-path="${escapeHtml(path)}">
      <strong>${escapeHtml(path)}</strong>
      <span>${wordCount(body)} words</span>
    </div>
  `).join("");

  els.wikiTree.querySelectorAll(".tree-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedPath = item.dataset.path;
      els.docTitle.textContent = state.selectedPath;
      els.docBody.textContent = fileMap.get(state.selectedPath);
    });
  });

  els.operatorManual.textContent = vault.operatingLayer.operatorManual;
  els.queryCookbook.textContent = vault.operatingLayer.queryCookbook;
  els.commandsList.innerHTML = Object.entries(vault.operatingLayer.commands).map(([name, body]) => `
    <div class="mini-card"><strong>/${escapeHtml(name)}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
  `).join("");
  els.agentsList.innerHTML = Object.entries(vault.operatingLayer.agents).map(([name, body]) => `
    <div class="mini-card"><strong>${escapeHtml(name)}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
  `).join("");

  els.editList.className = "edit-list";
  els.editList.innerHTML = vault.editProposals.map((proposal) => `
    <div class="edit-card">
      <strong>${escapeHtml(proposal.title)}</strong>
      <span>${escapeHtml(proposal.operation)} · ${escapeHtml(proposal.target)}</span>
      <div>${escapeHtml(proposal.rationale)}</div>
    </div>
  `).join("");

  drawGraph(vault.wiki.graph);
  if (entries[0]) {
    state.selectedPath = entries[0][0];
    els.docTitle.textContent = entries[0][0];
    els.docBody.textContent = entries[0][1];
  }
}

function drawGraph(graph) {
  const width = 980;
  const height = 560;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 210;
  const nodes = graph.nodes.map((node, index) => {
    const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const edgeSvg = graph.edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return "";
    return `<line class="edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
  }).join("");

  const nodeSvg = nodes.map((node) => `
    <g>
      <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius(node.type)}" fill="${nodeColor(node.type)}" />
      <text class="node-label" x="${node.x + 11}" y="${node.y + 4}">${escapeHtml(shortLabel(node.title))}</text>
    </g>
  `).join("");

  els.graphSvg.innerHTML = `${edgeSvg}${nodeSvg}`;
}

async function readBrowserFile(file) {
  const isPdf = /\.pdf$/i.test(file.name);
  return {
    name: file.webkitRelativePath || file.name,
    text: isPdf ? "" : await file.text()
  };
}

function normalizeSelectedFiles(files) {
  const seen = new Set();
  const normalized = [];

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (!path || shouldIgnorePath(path)) continue;

    const key = `${path}::${file.size}::${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(file);
  }

  return normalized.sort((a, b) => {
    const left = a.webkitRelativePath || a.name;
    const right = b.webkitRelativePath || b.name;
    return left.localeCompare(right);
  });
}

function buildLlmIngestPrompt(files) {
  const textFiles = files.filter((file) => file.text.trim());
  const attachmentFiles = files.filter((file) => !file.text.trim());
  const attachmentList = attachmentFiles.map((file) => `- ${file.name}`).join("\n") || "- none";
  const sourceBlocks = textFiles.map((file) => (
    `## Source: ${file.name}\n\n${file.text.trim()}`
  )).join("\n\n---\n\n") || "_No extracted text sources were available._";

  return `You are operating Margins, a local-first personal wiki compiler.

Goal:
Turn raw sources into a useful wiki, not a chat transcript. Preserve raw sources as evidence. Create source nodes, concept nodes, entity nodes, synthesis nodes, and edit proposals.

Important:
- The following files did not expose text in the browser and must be attached or extracted before you summarize them:
${attachmentList}
- Do not pretend to have read an attachment unless it is actually available in this conversation.
- If a source is unavailable, create a source placeholder and mark it "needs text extraction".

Output format:
Return Markdown files in this structure:
- wiki/sources/source-{slug}.md
- wiki/concepts/{slug}.md
- wiki/entities/{slug}.md
- wiki/synthesis/{slug}.md
- wiki/index.md
- .margins/edit-log.jsonl

Page rules:
- Every factual claim needs a source citation.
- Synthesis is allowed, but label it as synthesis.
- Do not invent account balances, transaction details, dates, roles, or relationships.
- Prefer useful connection-point summaries over generic tags.
- Make edit proposals before changing important structure.

For each source:
1. Write a faithful summary.
2. Extract concrete entities, dates, accounts, projects, decisions, and unresolved questions.
3. Identify concepts that should become durable wiki pages.

Across sources:
1. Link related source nodes.
2. Create synthesis pages that explain why the sources connect.
3. List open questions and next actions.

Extracted text sources:

${sourceBlocks}`;
}

function shouldIgnorePath(path) {
  const parts = path.split("/");
  if (parts.includes("sample") && parts.includes("output")) return true;
  return parts.some((part) => (
    part.startsWith(".") ||
    part === "node_modules" ||
    part === "output" ||
    part === "dist" ||
    part === "build"
  ));
}

function download(name, body) {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function firstLine(text) {
  return text.split("\n").find((line) => line.trim() && !line.startsWith("#")) || "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodeColor(type) {
  return {
    source: "#b8b1a4",
    concept: "#6a4f8c",
    entity: "#2c5aa0",
    synthesis: "#b83a2f"
  }[type] || "#20201d";
}

function nodeRadius(type) {
  return type === "synthesis" ? 10 : type === "source" ? 7 : 8;
}

function shortLabel(label) {
  return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}
