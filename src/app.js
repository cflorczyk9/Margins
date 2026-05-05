import { compileVault, vaultToFiles } from "./compiler.js";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const initialTheme = localStorage.getItem("margins-theme") || "dark";
document.documentElement.dataset.theme = initialTheme;

const state = {
  files: [],
  vault: null,
  selectedPath: null,
  currentFileMap: null,
  theme: initialTheme,
  reviewMode: localStorage.getItem("margins-review-mode") || "suggested",
  llmFiles: new Map(),
  llmSelectedPath: null,
  currentMaterialQuestions: [],
  llmPromptCopied: false,
  hasSavedCurrent: false,
  vaultHandle: null,
  vaultName: ""
};

const els = {
  themeToggle: document.getElementById("theme-toggle"),
  workflowGuidance: document.getElementById("workflow-guidance"),
  workflowBtn: document.getElementById("workflow-btn"),
  sourceDropZone: document.getElementById("source-drop-zone"),
  folderInput: document.getElementById("folder-input"),
  fileInput: document.getElementById("file-input"),
  sourceList: document.getElementById("source-list"),
  extractBtn: document.getElementById("extract-btn"),
  compileBtn: document.getElementById("compile-btn"),
  llmBtn: document.getElementById("llm-btn"),
  createVaultBtn: document.getElementById("create-vault-btn"),
  openVaultBtn: document.getElementById("open-vault-btn"),
  saveVaultBtn: document.getElementById("save-vault-btn"),
  reviewMode: document.getElementById("review-mode"),
  reviewModeHelp: document.getElementById("review-mode-help"),
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
  reviewQuestions: document.getElementById("review-questions"),
  reviewReply: document.getElementById("review-reply"),
  reviewResponseBtn: document.getElementById("review-response-btn"),
  llmFileList: document.getElementById("llm-file-list"),
  llmPreviewTitle: document.getElementById("llm-preview-title"),
  llmPreviewBody: document.getElementById("llm-preview-body"),
  operatorManual: document.getElementById("operator-manual"),
  queryCookbook: document.getElementById("query-cookbook"),
  commandsList: document.getElementById("commands-list"),
  agentsList: document.getElementById("agents-list"),
  editList: document.getElementById("edit-list")
};

els.themeToggle.checked = state.theme === "dark";
els.folderInput.addEventListener("change", handleSourceSelection);
els.fileInput.addEventListener("change", handleSourceSelection);
els.reviewMode.value = state.reviewMode;
updateReviewModeHelp();
hydrateChecklist();
updateWorkflowState();

els.themeToggle.addEventListener("change", () => {
  state.theme = els.themeToggle.checked ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("margins-theme", state.theme);
});

els.workflowBtn.addEventListener("click", runWorkflowStep);

els.sourceDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.sourceDropZone.classList.add("dragging");
});

els.sourceDropZone.addEventListener("dragleave", () => {
  els.sourceDropZone.classList.remove("dragging");
});

els.sourceDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  els.sourceDropZone.classList.remove("dragging");
  await setSourceFiles([...event.dataTransfer.files]);
});

async function handleSourceSelection(event) {
  await setSourceFiles([...event.target.files]);
}

async function setSourceFiles(files) {
  const normalized = normalizeSelectedFiles(files);
  state.files = await Promise.all(normalized.map(readBrowserFile));
  state.vault = null;
  state.selectedPath = null;
  state.currentFileMap = null;
  state.llmPromptCopied = false;
  state.hasSavedCurrent = false;
  renderSources();
  updateActionState();
  els.exportBtn.disabled = true;
  els.saveVaultBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.stats.textContent = `${state.files.length} source${state.files.length === 1 ? "" : "s"} loaded · 0 nodes · 0 edges`;
  updateWorkflowState();
  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus !== "extracted")) {
    await extractPdfSources();
  }
}

els.extractBtn.addEventListener("click", extractPdfSources);

els.compileBtn.addEventListener("click", () => {
  state.vault = compileVault(state.files, { name: "Karpathy Original" });
  state.selectedPath = null;
  state.currentFileMap = null;
  state.hasSavedCurrent = false;
  renderVault();
  updateWorkflowState();
});

els.llmBtn.addEventListener("click", async () => {
  await copyLlmIngestPrompt();
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
  updateWorkflowState();
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
    state.hasSavedCurrent = true;
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
    updateWorkflowState();
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

els.reviewMode.addEventListener("change", () => {
  state.reviewMode = els.reviewMode.value;
  localStorage.setItem("margins-review-mode", state.reviewMode);
  updateReviewModeHelp();
  if (state.llmFiles.size > 0) renderLlmReview();
  updateWorkflowState();
});

els.llmInput.addEventListener("input", () => {
  const parsed = parseLlmFiles(els.llmInput.value);
  if (parsed.size === 0 && state.llmFiles.size === 0) {
    updateWorkflowState();
    return;
  }
  if (parsed.size > 0 && serializeLlmFiles(parsed) !== serializeLlmFiles(state.llmFiles)) {
    els.reviewReply.value = "";
  }
  state.llmFiles = parsed;
  state.currentFileMap = null;
  state.hasSavedCurrent = false;
  els.saveVaultBtn.disabled = true;
  els.exportBtn.disabled = true;
  renderLlmReview();
});

els.parseLlmBtn.addEventListener("click", () => {
  state.llmFiles = parseLlmFiles(els.llmInput.value);
  els.reviewReply.value = "";
  state.currentFileMap = null;
  state.hasSavedCurrent = false;
  els.saveVaultBtn.disabled = true;
  els.exportBtn.disabled = true;
  renderLlmReview();
});

els.repairLlmBtn.addEventListener("click", async () => {
  await copyLlmRepairPrompt();
});

els.reviewReply.addEventListener("input", () => {
  updateReviewResponseState();
  updateWorkflowState();
});

els.reviewResponseBtn.addEventListener("click", async () => {
  await copyReviewResponsePrompt();
});

els.acceptLlmBtn.addEventListener("click", () => {
  acceptLlmFiles();
});

async function copyLlmIngestPrompt() {
  if (state.files.length === 0) return;
  await navigator.clipboard.writeText(buildLlmIngestPrompt(state.files));
  state.llmPromptCopied = true;
  els.llmBtn.textContent = "Copied";
  setTimeout(() => { els.llmBtn.textContent = "Copy LLM ingest prompt"; }, 1100);
  activateTab("llm");
  els.llmInput.focus();
  updateWorkflowState();
}

async function copyLlmRepairPrompt() {
  if (state.llmFiles.size === 0) return;
  await navigator.clipboard.writeText(buildLlmRepairPrompt(state.llmFiles));
  els.repairLlmBtn.textContent = "Copied";
  setTimeout(() => { els.repairLlmBtn.textContent = "Copy repair prompt"; }, 1100);
  activateTab("llm");
  updateWorkflowState();
}

async function copyReviewResponsePrompt() {
  const reply = els.reviewReply.value.trim();
  if (state.llmFiles.size === 0 || !reply) return;
  await navigator.clipboard.writeText(buildReviewResponsePrompt(
    state.llmFiles,
    state.currentMaterialQuestions,
    reply,
    state.reviewMode
  ));
  els.reviewResponseBtn.textContent = "Copied";
  setTimeout(() => { els.reviewResponseBtn.textContent = "Copy review response prompt"; }, 1100);
  activateTab("llm");
  updateWorkflowState();
}

function acceptLlmFiles() {
  if (state.llmFiles.size === 0) return false;
  state.vault = null;
  state.currentFileMap = new Map(state.llmFiles);
  state.selectedPath = null;
  state.hasSavedCurrent = false;
  renderWikiFiles(state.currentFileMap);
  renderOperatingLayer(state.currentFileMap);
  renderAcceptedLlmEditState();
  drawGraph(graphFromFileMap(state.currentFileMap));
  els.exportBtn.disabled = false;
  els.saveVaultBtn.disabled = false;
  els.copyBtn.disabled = true;
  activateTab("wiki");
  updateWorkflowState();
  return true;
}

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

function updateReviewModeHelp() {
  els.reviewModeHelp.textContent = {
    auto: "File automatically unless serious warnings appear.",
    suggested: "Ask only about durable wiki decisions, with a recommended default.",
    strict: "Ask before promotions, synthesis, and sensitive-source saves."
  }[state.reviewMode] || "";
}

async function runWorkflowStep() {
  const step = workflowStep();
  if (step.disabled) return;

  if (step.action === "vault") {
    await openVault();
  } else if (step.action === "sources") {
    els.fileInput.value = "";
    els.fileInput.click();
  } else if (step.action === "extract") {
    await extractPdfSources();
  } else if (step.action === "copyPrompt") {
    await copyLlmIngestPrompt();
  } else if (step.action === "paste") {
    activateTab("llm");
    els.llmInput.focus();
  } else if (step.action === "repair") {
    await copyLlmRepairPrompt();
  } else if (step.action === "reviewReply") {
    await copyReviewResponsePrompt();
  } else if (step.action === "acceptSave") {
    if (acceptLlmFiles()) await saveCurrentVault();
  } else if (step.action === "save") {
    await saveCurrentVault();
  }

  updateWorkflowState();
}

function updateWorkflowState() {
  const step = workflowStep();
  els.workflowGuidance.textContent = step.guidance;
  els.workflowBtn.textContent = step.label;
  els.workflowBtn.disabled = !!step.disabled;
}

function workflowStep() {
  if (!state.vaultHandle) {
    return {
      action: "vault",
      label: "Choose vault folder",
      guidance: "Pick or create the local folder Margins will keep updating."
    };
  }

  if (state.files.length === 0) {
    return {
      action: "sources",
      label: "Add documents",
      guidance: `Vault selected: ${state.vaultName}. Now drop documents onto Sources or add files.`
    };
  }

  if (state.files.some((file) => file.extractionStatus === "extracting")) {
    return {
      action: "extracting",
      label: "Extracting PDFs...",
      guidance: "Margins is reading PDF text locally before it builds the LLM prompt.",
      disabled: true
    };
  }

  if (state.files.some((file) => file.type === "pdf" && file.extractionStatus === "needed")) {
    return {
      action: "extract",
      label: "Extract PDF text",
      guidance: "Some PDFs still need readable text before the language model can organize them."
    };
  }

  if (state.hasSavedCurrent) {
    return {
      action: "sources",
      label: "Add more documents",
      guidance: `Saved to ${state.vaultName}. You can add another document whenever you're ready.`
    };
  }

  if (state.currentFileMap) {
    return {
      action: "save",
      label: "Save to vault",
      guidance: `The wiki is accepted. Save it into ${state.vaultName}.`
    };
  }

  if (state.llmFiles.size > 0) {
    if (els.reviewReply.value.trim()) {
      return {
        action: "reviewReply",
        label: "Copy reply for LLM",
        guidance: "You wrote guidance for the model. Send it back once, then paste the revised output here."
      };
    }

    const warningCount = llmBlockingWarningCount();
    if (warningCount > 0) {
      return {
        action: "repair",
        label: "Copy cleanup prompt",
        guidance: `${warningCount} blocking formatting issue${warningCount === 1 ? "" : "s"} found. One cleanup pass should fix the output before saving.`
      };
    }

    const questionCount = state.currentMaterialQuestions.length;
    return {
      action: "acceptSave",
      label: "Accept and save",
      guidance: questionCount
        ? `${questionCount} optional review question${questionCount === 1 ? "" : "s"} found. Answer only if something looks wrong; otherwise save.`
        : "Clean LLM output is ready. Accept it and write the vault."
    };
  }

  if (els.llmInput.value.trim()) {
    return {
      action: "paste",
      label: "Paste LLM answer",
      guidance: "The pasted text does not include margins-file blocks yet. Paste the model's full Margins output."
    };
  }

  if (state.llmPromptCopied) {
    return {
      action: "paste",
      label: "Paste LLM answer",
      guidance: "The prompt is copied. Paste it into your LLM, then paste the returned files here."
    };
  }

  const failedPdfCount = state.files.filter((file) => file.type === "pdf" && !file.text).length;
  return {
    action: "copyPrompt",
    label: "Organize with LLM",
    guidance: failedPdfCount
      ? `${failedPdfCount} PDF${failedPdfCount === 1 ? "" : "s"} need to be attached in the LLM chat. The copied prompt will list them.`
      : "Copy one prompt for the language model. When API mode exists, this step becomes automatic."
  };
}

function llmBlockingWarningCount() {
  const warningsByPath = validateLlmFiles(state.llmFiles);
  return [...warningsByPath.values()].reduce((sum, warnings) => (
    sum + warnings.filter((warning) => /contentReference|Missing YAML|not valid JSON/i.test(warning)).length
  ), 0);
}

function renderVault() {
  const vault = state.vault;
  const fileMap = vaultToFiles(vault);

  els.exportBtn.disabled = false;
  els.saveVaultBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.stats.textContent = `${vault.manifest.counts.raw_sources} sources · ${vault.wiki.graph.nodes.length} nodes · ${vault.wiki.graph.edges.length} edges`;
  state.currentFileMap = fileMap;
  state.hasSavedCurrent = false;
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
  updateWorkflowState();
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
  const questions = buildMaterialQuestions(state.llmFiles, warningsByPath, state.reviewMode);
  state.currentMaterialQuestions = questions;
  const warningCount = [...warningsByPath.values()].reduce((sum, warnings) => sum + warnings.length, 0);
  els.acceptLlmBtn.disabled = entries.length === 0;
  els.repairLlmBtn.disabled = entries.length === 0 || warningCount === 0;
  els.llmStatus.textContent = entries.length
    ? `${entries.length} file${entries.length === 1 ? "" : "s"} parsed · ${warningCount} review warning${warningCount === 1 ? "" : "s"} · ${questions.length} material question${questions.length === 1 ? "" : "s"}`
    : "No files found. Paste output that uses ```margins-file path=\"...\" fenced blocks.";

  if (entries.length === 0) {
    els.llmFileList.className = "tree-list empty";
    els.llmFileList.textContent = "No parsed files.";
    els.llmPreviewTitle.textContent = "No LLM file selected";
    els.llmPreviewBody.textContent = "Paste model output, then click Parse LLM files.";
    renderMaterialQuestions([]);
    els.repairLlmBtn.disabled = true;
    updateReviewResponseState();
    updateWorkflowState();
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
  renderMaterialQuestions(questions);
  updateReviewResponseState();
  updateWorkflowState();
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

function renderMaterialQuestions(questions) {
  if (questions.length === 0) {
    els.reviewQuestions.className = "review-list empty";
    els.reviewQuestions.textContent = state.reviewMode === "auto"
      ? "Auto-file mode: no material blockers found."
      : "No material review questions.";
    return;
  }

  els.reviewQuestions.className = "review-list";
  els.reviewQuestions.innerHTML = questions.map((question) => `
    <div class="review-card ${question.severity}">
      <div class="review-meta">${escapeHtml(question.kind)}</div>
      <strong>${escapeHtml(question.question)}</strong>
      <p>${escapeHtml(question.reason)}</p>
      <div class="recommendation">${escapeHtml(question.recommendation)}</div>
      <div class="review-path">${escapeHtml(question.path || "vault")}</div>
    </div>
  `).join("");
}

function updateReviewResponseState() {
  els.reviewResponseBtn.disabled = state.llmFiles.size === 0 || !els.reviewReply.value.trim();
}

function buildMaterialQuestions(fileMap, warningsByPath, mode) {
  if (mode === "auto") {
    return buildAutoFileQuestions(fileMap, warningsByPath);
  }

  const questions = [
    ...promotionQuestions(fileMap),
    ...synthesisQuestions(fileMap),
    ...riskQuestions(fileMap),
    ...rawSourceQuestions(fileMap)
  ];

  if (mode === "strict") {
    questions.push(...strictReviewQuestions(fileMap));
  }

  return dedupeQuestions(questions).slice(0, mode === "strict" ? 12 : 6);
}

function buildAutoFileQuestions(fileMap, warningsByPath) {
  const warningQuestions = [];
  for (const [path, warnings] of warningsByPath.entries()) {
    for (const warning of warnings) {
      if (/contentReference|Missing YAML|not valid JSON|raw source/i.test(warning)) {
        warningQuestions.push(reviewQuestion(
          "blocker",
          "I need to fix this first",
          path,
          "I found a formatting issue I should clean up before saving this.",
          warning,
          "My take: use the repair prompt first, then we can file the cleaned version."
        ));
      }
    }
  }
  return warningQuestions.slice(0, 4);
}

function promotionQuestions(fileMap) {
  const questions = [];
  for (const [path, body] of fileMap.entries()) {
    if (path.startsWith("wiki/entities/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      const demoLike = /\bdemo\b|\bfictional\b|\bplaceholder\b|\bnot an actual\b|\bexample\b/i.test(body);
      questions.push(reviewQuestion(
        demoLike ? "warn" : "suggest",
        "Quick check",
        path,
        demoLike
          ? `I found "${title}", but it looks like sample/demo data. Should I keep it tucked inside the source note instead of making it a main page?`
          : `I found "${title}" and I can make a page for it. Is this something you'll probably want to find again later?`,
        demoLike
          ? "I don't want to clutter your graph with fake clients, sample advisors, or placeholder companies."
          : "I usually make separate pages for real people, companies, projects, tools, accounts, or places that will matter again.",
        demoLike ? "My take: keep it in the source note unless you expect this name to come up again." : "My take: save it as a page if it's real and likely to come up again."
      ));
    }
    if (path.startsWith("wiki/concepts/")) {
      const title = markdownTitle(body) || titleFromSlug(basename(path).replace(/\.md$/, ""));
      questions.push(reviewQuestion(
        "suggest",
        "Quick check",
        path,
        `I found the theme "${title}". Do you want that to become a page I can connect future files to?`,
        "If this is just a label from one document, I can leave it inside the source note. If it's a recurring idea, a page will make future search and linking better.",
        "My take: save it if you can imagine asking about this topic later."
      ));
    }
  }
  return questions;
}

function synthesisQuestions(fileMap) {
  return [...fileMap.entries()]
    .filter(([path]) => path.startsWith("wiki/synthesis/"))
    .map(([path, body]) => reviewQuestion(
      "suggest",
      "Quick check",
      path,
      "I connected a few notes into a bigger-picture summary. Does that connection feel useful to keep?",
      "This is where the wiki becomes more than file summaries, but I only want to keep connections that actually help you think or retrieve later.",
      /\bnot directly stated\b|\bhypothesis\b|\bnot stated\b/i.test(body)
        ? "My take: keep it as a draft if the connection is useful, but don't treat it as fact yet."
        : "My take: keep it if it explains a real connection across files."
    ));
}

function riskQuestions(fileMap) {
  const sensitive = [];
  for (const [path, body] of fileMap.entries()) {
    if (!path.startsWith("wiki/sources/")) continue;
    if (/\b(account number|ssn|social security|medical|diagnosis|legal|attorney|customer|client|salary|tax|bank|routing)\b/i.test(body)) {
      sensitive.push(reviewQuestion(
        "warn",
        "Careful",
        path,
        "This file looks sensitive. Do you want me to slow down and review it more carefully before saving?",
        "I saw terms that often show up in financial, legal, medical, customer, or work files. A bad summary in those areas is more costly.",
        "My take: use Strict review here, or save only the source note if you're unsure."
      ));
    }
  }
  return sensitive;
}

function rawSourceQuestions() {
  if (state.files.length > 0) return [];
  return [reviewQuestion(
    "warn",
    "Before saving",
    "raw_sources/",
    "I don't have the original files loaded right now. Should I pause before saving the generated notes?",
    "The vault is much more trustworthy when it keeps the original files next to the notes I generated from them.",
    "My take: reload the original files first so I can save both."
  )];
}

function strictReviewQuestions(fileMap) {
  const sourceCount = [...fileMap.keys()].filter((path) => path.startsWith("wiki/sources/")).length;
  const promotedCount = [...fileMap.keys()].filter((path) => (
    path.startsWith("wiki/entities/") ||
    path.startsWith("wiki/concepts/") ||
    path.startsWith("wiki/synthesis/")
  )).length;
  if (sourceCount === 0 || promotedCount === 0) return [];
  return [reviewQuestion(
    "suggest",
    "Careful",
    "wiki/",
    "Since Strict review is on, do you want to approve the new pages one at a time before I save them?",
    "This is useful when the files are important enough that every new page should be intentional.",
    "My take: approve the new pages one by one."
  )];
}

function reviewQuestion(severity, kind, path, question, reason, recommendation) {
  return { severity, kind, path, question, reason, recommendation };
}

function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const key = `${question.kind}:${question.path}:${question.question}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  updateWorkflowState();

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
  updateWorkflowState();
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
  updateWorkflowState();
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

function buildReviewResponsePrompt(fileMap, questions, reply, reviewMode) {
  return `You are operating Margins, a local-first personal wiki compiler.

The user is responding conversationally to review questions about the generated wiki. Use their reply as judgment, then regenerate the complete file set.

Current review mode: ${reviewModeLabel(reviewMode)}

Operating context:

${wikiSchemaPack()}

Review questions Margins asked:

${serializeReviewQuestions(questions)}

User reply:

${reply}

Task:
1. Apply the user's guidance conservatively to the wiki files below.
2. Return the complete replacement file set, not a patch.
3. Keep the exact \`\`\`margins-file path="..."\`\`\` fenced block format.
4. Prefer fewer, stronger concept/entity/synthesis pages over many weak pages.
5. Demote nodes the user does not want into source-page sections, "Mentioned but missing", or draft synthesis notes as appropriate.
6. Preserve source pages and concrete facts unless the user explicitly says they are wrong.
7. Keep all synthesis labeled. Do not turn guesses into facts.
8. If the user's reply contains a stable preference for future ingests, create or update .margins/preferences.json with a concise machine-readable preference.
9. Only add a follow-up question if the user's answer is needed to avoid a wrong durable wiki decision.

Current file set:

${serializeLlmFiles(fileMap)}`;
}

function serializeReviewQuestions(questions) {
  if (!questions.length) {
    return "- No material questions were generated. The user is giving optional filing guidance.";
  }
  return questions.map((question) => [
    `- ${question.question}`,
    `  Why Margins asked: ${question.reason}`,
    `  ${question.recommendation}`,
    `  File: ${question.path || "vault"}`
  ].join("\n")).join("\n");
}

function reviewModeLabel(mode) {
  return {
    auto: "Auto-file",
    suggested: "Suggested review",
    strict: "Strict review"
  }[mode] || mode;
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
