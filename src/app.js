import { compileVault, vaultToFiles } from "./compiler.js";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const state = {
  files: [],
  vault: null,
  selectedPath: null,
  currentFileMap: null,
  llmFiles: new Map(),
  llmSelectedPath: null,
  vaultHandle: null,
  vaultName: ""
};

const els = {
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  sourceList: document.getElementById("source-list"),
  extractBtn: document.getElementById("extract-btn"),
  compileBtn: document.getElementById("compile-btn"),
  llmBtn: document.getElementById("llm-btn"),
  createVaultBtn: document.getElementById("create-vault-btn"),
  openVaultBtn: document.getElementById("open-vault-btn"),
  saveVaultBtn: document.getElementById("save-vault-btn"),
  exportBtn: document.getElementById("export-btn"),
  copyBtn: document.getElementById("copy-btn"),
  wikiTree: document.getElementById("wiki-tree"),
  docTitle: document.getElementById("doc-title"),
  docBody: document.getElementById("doc-body"),
  graphSvg: document.getElementById("graph-svg"),
  stats: document.getElementById("stats"),
  llmInput: document.getElementById("llm-input"),
  parseLlmBtn: document.getElementById("parse-llm-btn"),
  repairLlmBtn: document.getElementById("repair-llm-btn"),
  acceptLlmBtn: document.getElementById("accept-llm-btn"),
  llmStatus: document.getElementById("llm-status"),
  llmFileList: document.getElementById("llm-file-list"),
  llmPreviewTitle: document.getElementById("llm-preview-title"),
  llmPreviewBody: document.getElementById("llm-preview-body"),
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
  state.currentFileMap = null;
  renderSources();
  updateActionState();
  els.exportBtn.disabled = true;
  els.saveVaultBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.stats.textContent = `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
}

els.extractBtn.addEventListener("click", extractPdfSources);

els.compileBtn.addEventListener("click", () => {
  state.vault = compileVault(state.files, { name: "Karpathy Original" });
  state.selectedPath = null;
  state.currentFileMap = null;
  renderVault();
});

els.llmBtn.addEventListener("click", async () => {
  if (state.files.length === 0) return;
  await navigator.clipboard.writeText(buildLlmIngestPrompt(state.files));
  els.llmBtn.textContent = "Copied";
  setTimeout(() => { els.llmBtn.textContent = "Copy LLM ingest prompt"; }, 1100);
});

els.exportBtn.addEventListener("click", () => {
  if (state.vault) {
    const files = Object.fromEntries(vaultToFiles(state.vault));
    download("margins-vault.json", JSON.stringify({
      raw_sources: state.vault.rawSources.map(({ name, text }) => ({ name, text })),
      files
    }, null, 2));
    return;
  }
  if (state.currentFileMap) {
    download("margins-llm-wiki.json", JSON.stringify({
      raw_sources: state.files.map(({ name, text }) => ({ name, text })),
      files: Object.fromEntries(state.currentFileMap)
    }, null, 2));
  }
});

els.createVaultBtn.addEventListener("click", createVault);
els.openVaultBtn.addEventListener("click", openVault);
els.saveVaultBtn.addEventListener("click", saveCurrentVault);

els.copyBtn.addEventListener("click", async () => {
  if (!state.vault) return;
  await navigator.clipboard.writeText(state.vault.operatingLayer.operatorManual);
  els.copyBtn.textContent = "Copied";
  setTimeout(() => { els.copyBtn.textContent = "Copy operator manual"; }, 1100);
});

async function createVault() {
  if (!("showDirectoryPicker" in window)) {
    els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    els.stats.textContent = `Created vault structure in: ${handle.name}`;
    return handle;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault creation failed: ${error.message || "unknown error"}`;
    }
    return null;
  }
}

async function openVault() {
  if (!("showDirectoryPicker" in window)) {
    els.stats.textContent = "Local vaults need Chrome or Edge on localhost. Use Download vault JSON for now.";
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await scaffoldVault(handle);
    setActiveVault(handle, handle.name);
    els.stats.textContent = `Opened vault: ${handle.name}`;
    return handle;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault open failed: ${error.message || "unknown error"}`;
    }
    return null;
  }
}

function setActiveVault(handle, name) {
  state.vaultHandle = handle;
  state.vaultName = name;
  els.createVaultBtn.textContent = `Vault: ${shortLabel(name)}`;
  els.openVaultBtn.textContent = "Open another vault";
  els.saveVaultBtn.disabled = !state.currentFileMap;
}

async function saveCurrentVault() {
  if (!state.currentFileMap) return;
  const vault = state.vaultHandle || await createVault();
  if (!vault) return;

  els.saveVaultBtn.disabled = true;
  const originalText = els.saveVaultBtn.textContent;
  els.saveVaultBtn.textContent = "Saving...";

  try {
    const writtenRaw = await writeRawSources(vault, state.files);
    const writtenFiles = await writeFileMap(vault, state.currentFileMap);
    await writeTextFile(vault, ".margins/export-summary.json", JSON.stringify({
      saved_at: new Date().toISOString(),
      vault: state.vaultName,
      raw_sources: writtenRaw,
      generated_files: writtenFiles,
      source_count: state.files.length,
      file_count: state.currentFileMap.size,
      write_mode: "direct-vault-save",
      warning: state.files.length === 0
        ? "No raw source files were loaded in the browser when this folder was written."
        : ""
    }, null, 2));
    els.stats.textContent = state.files.length === 0
      ? `Saved ${writtenFiles} wiki/operating files to ${state.vaultName}, but no raw sources were loaded.`
      : `Saved ${writtenFiles} wiki/operating file${writtenFiles === 1 ? "" : "s"} + ${writtenRaw} raw source${writtenRaw === 1 ? "" : "s"} to ${state.vaultName}`;
    els.saveVaultBtn.textContent = "Saved";
    setTimeout(() => { els.saveVaultBtn.textContent = originalText; }, 1500);
  } catch (error) {
    if (error.name !== "AbortError") {
      els.stats.textContent = `Vault save failed: ${error.message || "unknown error"}`;
    }
    els.saveVaultBtn.textContent = originalText;
  } finally {
    els.saveVaultBtn.disabled = !state.currentFileMap;
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.view);
  });
});

document.querySelectorAll("[data-check-id]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    localStorage.setItem(`margins-check-${checkbox.dataset.checkId}`, checkbox.checked ? "1" : "0");
  });
});

els.parseLlmBtn.addEventListener("click", () => {
  state.llmFiles = parseLlmFiles(els.llmInput.value);
  renderLlmReview();
});

els.repairLlmBtn.addEventListener("click", async () => {
  if (state.llmFiles.size === 0) return;
  await navigator.clipboard.writeText(buildLlmRepairPrompt(state.llmFiles));
  els.repairLlmBtn.textContent = "Copied";
  setTimeout(() => { els.repairLlmBtn.textContent = "Copy repair prompt"; }, 1100);
});

els.acceptLlmBtn.addEventListener("click", () => {
  if (state.llmFiles.size === 0) return;
  state.vault = null;
  state.currentFileMap = new Map(state.llmFiles);
  state.selectedPath = null;
  renderWikiFiles(state.currentFileMap);
  renderOperatingLayer(state.currentFileMap);
  renderAcceptedLlmEditState();
  drawGraph(graphFromFileMap(state.currentFileMap));
  els.exportBtn.disabled = false;
  els.saveVaultBtn.disabled = false;
  els.copyBtn.disabled = true;
  activateTab("wiki");
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

  els.exportBtn.disabled = false;
  els.saveVaultBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.stats.textContent = `${vault.manifest.counts.raw_sources} sources · ${vault.wiki.graph.nodes.length} nodes · ${vault.wiki.graph.edges.length} edges`;
  state.currentFileMap = fileMap;
  renderWikiFiles(fileMap);

  renderOperatingLayer(fileMap);
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
}

function renderOperatingLayer(fileMap) {
  els.operatorManual.textContent = fileMap.get("operator-manual.md") || "No operator manual found in this file set.";
  els.queryCookbook.textContent = fileMap.get("query-cookbook.md") || "No query cookbook found in this file set.";

  const commands = [...fileMap.entries()].filter(([path]) => path.startsWith("commands/") && path.endsWith(".md"));
  const agents = [...fileMap.entries()].filter(([path]) => path.startsWith("agents/") && path.endsWith(".md"));

  els.commandsList.innerHTML = commands.length
    ? commands.map(([path, body]) => `
      <div class="mini-card"><strong>/${escapeHtml(basename(path).replace(/\.md$/, ""))}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
    `).join("")
    : `<div class="mini-card"><strong>No commands</strong><br><span>Ask the LLM to return commands/*.md files when needed.</span></div>`;

  els.agentsList.innerHTML = agents.length
    ? agents.map(([path, body]) => `
      <div class="mini-card"><strong>${escapeHtml(basename(path).replace(/\.md$/, ""))}</strong><br><span>${escapeHtml(firstLine(body))}</span></div>
    `).join("")
    : `<div class="mini-card"><strong>No agents</strong><br><span>Ask the LLM to return agents/*.md files when needed.</span></div>`;
}

function renderAcceptedLlmEditState() {
  const editLog = state.currentFileMap.get(".margins/edit-log.jsonl") || "";
  const proposals = editLog
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);

  if (proposals.length === 0) {
    els.editList.className = "edit-list empty";
    els.editList.textContent = "LLM files accepted. No structured edit proposals were returned.";
    return;
  }

  els.editList.className = "edit-list";
  els.editList.innerHTML = proposals.map((proposal) => `
    <div class="edit-card">
      <strong>${escapeHtml(proposal.title || proposal.operation || "Edit proposal")}</strong>
      <span>${escapeHtml(proposal.operation || "review")} · ${escapeHtml(proposal.target || "unknown target")}</span>
      <div>${escapeHtml(proposal.rationale || proposal.summary || "Review this proposed change before writing it locally.")}</div>
    </div>
  `).join("");
}

function renderWikiFiles(fileMap) {
  const entries = [...fileMap.entries()].filter(([path]) => path.startsWith("wiki/") && path.endsWith(".md"));
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

  if (entries[0]) {
    state.selectedPath = entries[0][0];
    els.docTitle.textContent = entries[0][0];
    els.docBody.textContent = entries[0][1];
  } else {
    els.wikiTree.className = "tree-list empty";
    els.wikiTree.textContent = "No wiki Markdown files found.";
    els.docTitle.textContent = "No node selected";
    els.docBody.textContent = "Paste LLM output or compile sources to generate wiki nodes.";
  }
}

function renderLlmReview() {
  const entries = [...state.llmFiles.entries()];
  const warningsByPath = validateLlmFiles(state.llmFiles);
  const warningCount = [...warningsByPath.values()].reduce((sum, warnings) => sum + warnings.length, 0);
  els.acceptLlmBtn.disabled = entries.length === 0;
  els.repairLlmBtn.disabled = entries.length === 0 || warningCount === 0;
  els.llmStatus.textContent = entries.length
    ? `${entries.length} file${entries.length === 1 ? "" : "s"} parsed · ${warningCount} review warning${warningCount === 1 ? "" : "s"}`
    : "No files found. Paste output that uses ```margins-file path=\"...\" fenced blocks.";

  if (entries.length === 0) {
    els.llmFileList.className = "tree-list empty";
    els.llmFileList.textContent = "No parsed files.";
    els.llmPreviewTitle.textContent = "No LLM file selected";
    els.llmPreviewBody.textContent = "Paste model output, then click Parse LLM files.";
    els.repairLlmBtn.disabled = true;
    return;
  }

  els.llmFileList.className = "tree-list";
  els.llmFileList.innerHTML = entries.map(([path, body]) => `
    <div class="tree-item" data-path="${escapeHtml(path)}">
      <strong>${escapeHtml(path)}</strong>
      <span>${wordCount(body)} words${warningLabel(warningsByPath.get(path) || [])}</span>
    </div>
  `).join("");

  els.llmFileList.querySelectorAll(".tree-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.llmSelectedPath = item.dataset.path;
      renderLlmPreview(warningsByPath);
    });
  });

  state.llmSelectedPath = entries[0][0];
  renderLlmPreview(warningsByPath);
}

function renderLlmPreview(warningsByPath) {
  const body = state.llmFiles.get(state.llmSelectedPath) || "";
  const warnings = warningsByPath.get(state.llmSelectedPath) || [];
  els.llmPreviewTitle.textContent = warnings.length
    ? `${state.llmSelectedPath} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
    : state.llmSelectedPath;
  els.llmPreviewBody.textContent = warnings.length
    ? `Review warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n\n${body}`
    : body;
}

function validateLlmFiles(fileMap) {
  const warningsByPath = new Map();
  const entries = [...fileMap.entries()];
  const promotedPages = entries.filter(([path]) => (
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/synthesis/")
  ));
  const hasPromotedPages = promotedPages.length > 0;

  for (const [path, body] of entries) {
    const warnings = [];
    if (path.startsWith("wiki/") && path.endsWith(".md") && !hasYamlFrontmatter(body)) {
      warnings.push("Missing YAML frontmatter.");
    }
    if (/:contentReference\[|oaicite:/i.test(body)) {
      warnings.push("Contains ChatGPT contentReference citations. Replace with durable source/file citations.");
    }
    if (path.startsWith("wiki/sources/")) {
      if (!/##\s+Mentioned but missing/i.test(body)) warnings.push("Source page is missing a Mentioned but missing section.");
      if (!/##\s+Inferences refused/i.test(body)) warnings.push("Source page is missing an Inferences refused section.");
      if (hasPromotedPages && extractWikiLinks(body).length === 0) {
        warnings.push("Source page does not link to promoted concepts, entities, or synthesis pages.");
      }
    }
    if ((path.startsWith("wiki/concepts/") || path.startsWith("wiki/entities/") || path.startsWith("wiki/synthesis/")) && !body.includes("[[source-")) {
      warnings.push("Promoted page does not link back to a source page.");
    }
    if (path.startsWith("wiki/entities/") && /\bfictional\b|\bdemo\b|\bis this a real\b/i.test(body)) {
      warnings.push("Entity may be fictional or demo-only. Review before keeping it as a first-class entity.");
    }
    if (path === ".margins/edit-log.jsonl") {
      const invalidLines = body.split("\n").filter((line) => line.trim() && !parseJsonLine(line));
      if (invalidLines.length > 0) warnings.push(`${invalidLines.length} edit-log line${invalidLines.length === 1 ? "" : "s"} are not valid JSON.`);
    }
    warningsByPath.set(path, warnings);
  }

  return warningsByPath;
}

function hasYamlFrontmatter(body) {
  return /^---\n[\s\S]+?\n---\n/.test(body);
}

function warningLabel(warnings) {
  return warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
}

function drawGraph(graph) {
  const width = 980;
  const height = 560;
  if (!graph || graph.nodes.length === 0) {
    els.graphSvg.innerHTML = `<text class="node-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">No accepted graph nodes yet.</text>`;
    return;
  }
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

function graphFromFileMap(fileMap) {
  const nodeEntries = [...fileMap.entries()]
    .filter(([path]) => isGraphNodePath(path))
    .map(([path, body]) => nodeFromMarkdownFile(path, body));
  const nodes = nodeEntries.map(({ node }) => node);
  const bySlug = new Map();
  const byPath = new Map();

  for (const entry of nodeEntries) {
    byPath.set(entry.path, entry.node);
    bySlug.set(entry.slug, entry.node);
    bySlug.set(entry.node.id, entry.node);
    bySlug.set(slugifyLoose(entry.node.title), entry.node);
  }

  const edges = [];
  const seen = new Set();
  for (const { path, body, node } of nodeEntries) {
    for (const target of extractWikiLinks(body)) {
      const to = resolveGraphLink(target, byPath, bySlug);
      if (!to || to.id === node.id) continue;
      const key = `${node.id}->${to.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: node.id, to: to.id, type: "wiki-link" });
    }
  }

  const graph = { nodes, edges };
  els.stats.textContent = `${fileMap.size} accepted file${fileMap.size === 1 ? "" : "s"} · ${nodes.length} reviewed nodes · ${edges.length} cited links`;
  return graph;
}

function nodeFromMarkdownFile(path, body) {
  const slug = basename(path).replace(/\.md$/, "");
  const id = path.replace(/^wiki\//, "").replace(/\.md$/, "");
  return {
    path,
    body,
    slug,
    node: {
      id,
      type: graphTypeFromPath(path),
      title: markdownTitle(body) || titleFromSlug(slug)
    }
  };
}

function isGraphNodePath(path) {
  return /^wiki\/(sources|concepts|entities|synthesis)\/[^/]+\.md$/.test(path) || path === "wiki/index.md";
}

function graphTypeFromPath(path) {
  if (path.startsWith("wiki/sources/")) return "source";
  if (path.startsWith("wiki/concepts/")) return "concept";
  if (path.startsWith("wiki/entities/")) return "entity";
  if (path.startsWith("wiki/synthesis/")) return "synthesis";
  return "index";
}

function extractWikiLinks(body) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function resolveGraphLink(target, byPath, bySlug) {
  const trimmed = target.replace(/^\//, "").replace(/\.md$/, "");
  const pathCandidates = [
    target,
    `${trimmed}.md`,
    `wiki/sources/${trimmed}.md`,
    `wiki/concepts/${trimmed}.md`,
    `wiki/entities/${trimmed}.md`,
    `wiki/synthesis/${trimmed}.md`
  ];

  for (const candidate of pathCandidates) {
    const node = byPath.get(candidate);
    if (node) return node;
  }

  return bySlug.get(slugifyLoose(trimmed)) || bySlug.get(trimmed);
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
Turn raw sources into a useful wiki, not a chat transcript and not a generic file organizer. Preserve raw sources as evidence. Create source pages first, then only create durable concept/entity/synthesis pages when the source material actually supports them.

Use this operating context as law:

${wikiSchemaPack()}

The model behavior should match this operating philosophy:
- The wiki is the user's external memory. Correct recall matters more than producing many nodes.
- Source pages are faithful direct reads. Synthesis is allowed only when labeled.
- The best graph is conservative: fewer true links beat many weak links.
- Do not infer silently. If a relationship, role, date, amount, intent, next move, or strategic implication is not a direct read, flag it as an open question or Claude synthesis.
- If you considered an inference but did not write it as fact, list it in an "Inferences refused" section.

Important:
- The following files did not expose text in the browser and must be attached or extracted before you summarize them:
${attachmentList}
- Do not pretend to have read an attachment unless it is actually available in this conversation.
- If a source is unavailable, create a source placeholder and mark it "needs text extraction".

Output format:
Return Markdown files in this exact fenced-block format so Margins can parse them:

\`\`\`margins-file path="wiki/sources/source-example.md"
---
type: source
bucket: sources
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

# Source: Example

Markdown body here.
\`\`\`

Use one fenced block per file. Return files in this structure:
- wiki/sources/source-{slug}.md
- wiki/concepts/{slug}.md
- wiki/entities/{slug}.md
- wiki/synthesis/{slug}.md
- wiki/index.md
- operator-manual.md
- query-cookbook.md
- commands/ingest.md
- commands/query.md
- commands/compile.md
- commands/lint.md
- agents/wiki-ingest.md
- .margins/ingest-report.md
- .margins/edit-log.jsonl

Page rules:
- Every wiki Markdown file must start with YAML frontmatter.
- Every factual claim needs a durable source citation. Do not use ChatGPT-only citation tokens such as :contentReference, oaicite, turn references, or hidden attachment ids. Cite with source page links and plain file/section references that will still make sense after export.
- Synthesis is allowed, but label it as synthesis.
- Do not invent account balances, transaction details, dates, roles, or relationships.
- Prefer useful connection-point summaries over generic tags.
- Only create concept pages for durable ideas that will remain useful across future sources.
- Only create entity pages for real people, organizations, named accounts, tools, securities, projects, or places.
- Do not create concept/entity pages for generic labels, PDF artifacts, table headers, UI labels, or section names such as page, positions, spec, inch, flow, append, value, account, or description.
- Treat "positions" as source content or a synthesis section unless the source names a specific position that matters.
- Add wiki links only when the relationship is explicit and useful. Weak keyword overlap should stay unlinked.
- Make edit proposals before changing important structure.
- Use wiki links for source-supported proper nouns and durable pages only.
- When you create a concept, entity, or synthesis page, add backlinks from the relevant source pages using [[page-slug]] links so the graph is navigable.
- Promoted concept/entity/synthesis pages must link back to their supporting source pages.
- Do not create stub pages just to resolve a mention. Put those in "Mentioned but missing" instead.

For each source:
1. Write a faithful source page with frontmatter, summary, context, key takeaways, concrete facts, and open questions.
2. Extract concrete entities, dates, accounts, projects, decisions, and unresolved questions, but keep weak candidates inside the source page.
3. Identify concepts that should become durable wiki pages. A concept should be reusable across future sources, not just a word that appeared in this file.
4. Add a "Mentioned but missing" section for proper nouns that might need pages but should not be auto-promoted.
5. Add an "Inferences refused" section for tempting claims you did not promote because the source does not directly support them.

Across sources:
1. Link related source nodes only when the connection is explicit or strongly source-supported.
2. Create synthesis pages that explain why sources connect, and label them as synthesis / not user-confirmed.
3. Create entity pages only for real named people, organizations, named accounts, tools, securities, projects, or places that matter.
4. Create concept pages only for load-bearing ideas that will help future retrieval.
5. List open questions and next actions separately from direct-read facts.

Operating-layer files:
- operator-manual.md should teach a future language model how to read, query, edit, and avoid overreaching in this wiki.
- query-cookbook.md should include practical lookup patterns.
- commands/*.md should be short executable workflow specs.
- agents/wiki-ingest.md should describe the conservative ingest workflow: source page first, direct-read propagation, inference refusal, and review before promotion.
- .margins/ingest-report.md should summarize files created, links made, inferences refused, mentioned-but-missing candidates, and anything that needs user review.

Extracted text sources:

${sourceBlocks}`;
}

function wikiSchemaPack() {
  return `## Margins Wiki Schema Pack

Architecture:
- raw_sources/ stores immutable evidence.
- wiki/ stores LLM-operable Markdown: source pages, concept pages, entity pages, synthesis pages, and index pages.
- operator-manual.md, query-cookbook.md, commands/, agents/, and .margins/ tell future models how to operate the wiki.

Required frontmatter for every wiki/*.md file:
---
type: source | concept | entity | synthesis | index
bucket: sources | concepts | entities | synthesis | index
summary: One sentence direct-read summary.
tags: [source]
created: YYYY-MM-DD
updated: YYYY-MM-DD
voice: claude-draft
---

Citation rules:
- Use durable wiki/file citations only.
- Good: "Ending value was $40,053.97 (source file: coleman-brokerage-2026-03.pdf, Account Summary)."
- Good: "See [[source-coleman-brokerage-2026-03]]."
- Bad: ":contentReference[oaicite:10]{index=10}", hidden attachment ids, turn ids, or any citation that disappears outside the chat.

Good source page shape:
---
type: source
bucket: sources
summary: Demo brokerage statement for Sarah Coleman covering March 2026 account values, allocation, holdings, and withdrawals.
tags: [source, statement, demo]
created: YYYY-MM-DD
updated: YYYY-MM-DD
event_date: 2026-03-31
voice: claude-draft
---

# Source: Coleman Brokerage Statement, March 2026

Raw file: coleman-brokerage-2026-03.pdf

## Summary
Direct-read summary with durable citations to the raw file or source page.

## Context
- Link durable promoted pages when supported: [[demo-financial-statements]]

## Concrete Facts
- Fact with raw file / section citation.

## Related Pages
- [[demo-financial-statements]] -- why this page connects

## Mentioned but missing
- Candidate -- why it was not promoted

## Inferences refused
- Tempting unsupported claim -- why it stayed out

Good promoted page rule:
- A concept/entity/synthesis page must link back to supporting sources with [[source-slug]].
- Do not promote demo-only names unless the name itself will help future retrieval.

Good ingest report shape:
# Ingest Report

## Files Created
## Links Made
## Inferences Refused
## Mentioned but Missing
## Needs Review

Self-check before returning:
1. Every wiki/*.md file has YAML frontmatter.
2. No ChatGPT-only citation artifacts remain.
3. Every source page has Mentioned but missing and Inferences refused.
4. Every promoted page links back to a source page.
5. Source pages link to promoted pages where supported.
6. Fictional/demo-only names are not promoted unless useful durable entities.`;
}

function buildLlmRepairPrompt(fileMap) {
  const warningsByPath = validateLlmFiles(fileMap);
  const groupedWarnings = [...warningsByPath.entries()]
    .filter(([, warnings]) => warnings.length > 0)
    .map(([path, warnings]) => `## ${path}\n${warnings.map((warning) => `- ${warning}`).join("\n")}`)
    .join("\n\n") || "No warnings.";

  return `Repair this Margins wiki output.

Use this operating context as law:

${wikiSchemaPack()}

Your task:
1. Regenerate the complete file set, not a patch.
2. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
3. Fix every warning listed below.
4. Remove all :contentReference, oaicite, hidden attachment ids, and turn references.
5. Add YAML frontmatter to every wiki/*.md file.
6. Use durable citations only: source page links, raw filenames, and plain section names.
7. Add source-page backlinks to promoted pages where supported.
8. Demote fictional/demo-only entity pages into Mentioned but missing or Needs Review unless they are useful durable entities.
9. Preserve good source facts and refused inferences.

Review warnings:

${groupedWarnings}

Current output to repair:

${serializeLlmFiles(fileMap)}`;
}

function parseLlmFiles(value) {
  const files = new Map();
  const pattern = /```margins-file\s+path="([^"]+)"\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const path = match[1].trim();
    const body = match[2].trim();
    if (path && body) files.set(path, body);
  }

  return files;
}

function serializeLlmFiles(fileMap) {
  return [...fileMap.entries()]
    .map(([path, body]) => `\`\`\`margins-file path="${path}"\n${body}\n\`\`\``)
    .join("\n\n");
}

function activateTab(view) {
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((item) => {
    item.classList.toggle("active", item.id === `${view}-view`);
  });
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

async function scaffoldVault(rootHandle) {
  await ensureDirectory(rootHandle, "raw_sources");
  await ensureDirectory(rootHandle, "wiki/sources");
  await ensureDirectory(rootHandle, "wiki/concepts");
  await ensureDirectory(rootHandle, "wiki/entities");
  await ensureDirectory(rootHandle, "wiki/synthesis");
  await ensureDirectory(rootHandle, "commands");
  await ensureDirectory(rootHandle, "agents");
  await ensureDirectory(rootHandle, ".margins");
  await writeTextFileIfMissing(rootHandle, "raw_sources/README.md", `# Raw Sources

Drop original source files here. Margins treats this folder as evidence and writes generated knowledge into wiki/.
`);
  await writeTextFileIfMissing(rootHandle, "wiki/index.md", `---
type: index
bucket: index
summary: Index for this Margins vault.
tags: [index]
created: ${todayString()}
updated: ${todayString()}
voice: claude-draft
---

# Wiki Index

Save generated wiki files from Margins to populate this vault.
`);
  await writeTextFileIfMissing(rootHandle, "operator-manual.md", "# Operator Manual\n\nMargins will write model operating instructions here.\n");
  await writeTextFileIfMissing(rootHandle, "query-cookbook.md", "# Query Cookbook\n\nMargins will write query recipes here.\n");
  await writeTextFileIfMissing(rootHandle, ".margins/manifest.json", JSON.stringify({
    name: "Margins Vault",
    template: "karpathy-original",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    storage: "local-folder"
  }, null, 2));
}

async function ensureDirectory(rootHandle, path) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function writeRawSources(rootHandle, files) {
  if (files.length === 0) {
    await writeTextFile(rootHandle, "raw_sources/README.md", `# Raw Sources

No raw source files were loaded in the browser when this Margins folder was written.

To preserve raw evidence, reload the original files in Margins before clicking "Save changes." Browsers clear selected file handles after refresh for security.
`);
    return 0;
  }

  let count = 0;
  for (const file of files) {
    const path = rawSourceOutputPath(file.name || `source-${count + 1}.txt`);
    if (file.browserFile) {
      await writeBlobFile(rootHandle, path, file.browserFile);
    } else {
      await writeTextFile(rootHandle, path, file.text || "");
    }
    count += 1;
  }
  return count;
}

function rawSourceOutputPath(path) {
  const safePath = safeRelativePath(path);
  return safePath.startsWith("raw_sources/")
    ? safePath
    : `raw_sources/${safePath}`;
}

async function writeFileMap(rootHandle, fileMap) {
  let count = 0;
  for (const [path, body] of fileMap.entries()) {
    await writeTextFile(rootHandle, safeRelativePath(path), body);
    count += 1;
  }
  return count;
}

async function writeTextFile(rootHandle, path, body) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(body);
  await writable.close();
}

async function writeTextFileIfMissing(rootHandle, path, body) {
  try {
    await fileHandleForPath(rootHandle, path, false);
  } catch {
    await writeTextFile(rootHandle, path, body);
  }
}

async function writeBlobFile(rootHandle, path, blob) {
  const fileHandle = await fileHandleForPath(rootHandle, path);
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function fileHandleForPath(rootHandle, path, create = true) {
  const parts = safeRelativePath(path).split("/").filter(Boolean);
  const fileName = parts.pop();
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir.getFileHandle(fileName || "untitled.md", { create });
}

function safeRelativePath(path) {
  return String(path)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001F]/g, "-"))
    .join("/");
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function firstLine(text) {
  return text.split("\n").find((line) => line.trim() && !line.startsWith("#")) || "";
}

function basename(path) {
  return path.split("/").pop() || path;
}

function markdownTitle(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugifyLoose(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
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
