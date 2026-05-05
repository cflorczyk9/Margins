import { compileVault, vaultToFiles } from "./compiler.js";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const state = {
  files: [],
  vault: null,
  selectedPath: null
};

const els = {
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  sourceList: document.getElementById("source-list"),
  extractBtn: document.getElementById("extract-btn"),
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
  updateActionState();
  els.exportBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.stats.textContent = `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
}

els.extractBtn.addEventListener("click", extractPdfSources);

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
    <div class="source-item ${sourceClass(file)}">
      <strong>${escapeHtml(file.name)}</strong>
      <span>${escapeHtml(sourceStatus(file))}</span>
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
    text: isPdf ? "" : await file.text(),
    browserFile: file,
    type: isPdf ? "pdf" : "text",
    extractionStatus: isPdf ? "needed" : "ready",
    extractionError: ""
  };
}

async function extractPdfSources() {
  const targets = state.files.filter((file) => file.type === "pdf" && file.extractionStatus !== "extracted");
  if (targets.length === 0) return;

  els.extractBtn.disabled = true;
  els.extractBtn.textContent = "Extracting PDFs...";
  state.vault = null;
  state.selectedPath = null;

  for (const file of targets) {
    file.extractionStatus = "extracting";
    file.extractionError = "";
    renderSources();

    try {
      const text = await extractPdfText(file.browserFile);
      file.text = text.trim();
      file.extractionStatus = file.text ? "extracted" : "failed";
      if (!file.text) file.extractionError = "No selectable text found.";
    } catch (error) {
      file.text = "";
      file.extractionStatus = "failed";
      file.extractionError = error.message || "PDF extraction failed.";
    }
  }

  els.extractBtn.textContent = "Extract PDF text";
  renderSources();
  updateActionState();
  els.stats.textContent = `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
}

async function extractPdfText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`Page ${pageNumber}\n${text}`);
  }

  return pages.join("\n\n");
}

function updateActionState() {
  const hasFiles = state.files.length > 0;
  const hasPendingPdf = state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted");
  els.extractBtn.disabled = !hasPendingPdf;
  els.compileBtn.disabled = !hasFiles;
  els.llmBtn.disabled = !hasFiles;
}

function sourceClass(file) {
  if (file.text) return "";
  if (file.type === "pdf") return "needs-extraction";
  return "";
}

function sourceStatus(file) {
  if (file.text) {
    const suffix = file.type === "pdf" ? " extracted" : "";
    return `${wordCount(file.text)} words${suffix}`;
  }
  if (file.type === "pdf" && file.extractionStatus === "extracting") return "extracting text...";
  if (file.type === "pdf" && file.extractionStatus === "failed") {
    return `extraction failed: ${file.extractionError || "needs text extraction or LLM attachment"}`;
  }
  if (file.type === "pdf") return "needs text extraction or LLM attachment";
  return "0 words";
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
