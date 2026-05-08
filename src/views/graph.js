// Graph view — force-directed layout of the wiki link graph.
//
// Phase 4 of the module-split refactor. Pulls 33 graph-domain
// functions out of app.js along with the `graphView` mutable view-
// state object, the graph-specific helpers `nodeRadius` and
// `shortLabel`, and the wiring for SVG pointer/wheel/dblclick.
//
// External shape required from the host (set via initGraphView):
//   - els: DOM-element cache. Reads .graphSvg, .graphSelection,
//     .graphSelectionMeta, .graphSelectionTitle, .stats
//   - onOpenNode(path: string): callback for when a node is opened
//     (host typically activates the wiki tab and selects the path).
//
// Cross-module deps:
//   - state from core/state.js (reads state.currentFileMap)
//   - clamp, hashString, escapeHtml from core/utils.js
//   - basename, extractWikiLinks, frontmatterFields, markdownTitle,
//     normalizeEntityTag, slugifyLoose, titleFromSlug from core/wiki.js

import { state } from "../core/state.js";
import { clamp, escapeHtml, hashString } from "../core/utils.js";
import {
  basename,
  extractWikiLinks,
  frontmatterFields,
  graphTypeFromPath,
  markdownTitle,
  normalizeEntityTag,
  slugifyLoose,
  titleFromSlug
} from "../core/wiki.js";

// ---------------------------------------------------------------------
// Mutable view state (singleton)
// ---------------------------------------------------------------------

export const graphView = {
  width: 1120,
  height: 700,
  nodes: [],
  edges: [],
  transform: { x: 0, y: 0, k: 1 },
  selectedId: "",
  hoverId: "",
  alpha: 0,
  tick: 0,
  raf: 0,
  pointer: null,
  bound: false
};

// ---------------------------------------------------------------------
// Host-supplied wiring (DOM + callbacks)
// ---------------------------------------------------------------------

let els = null;
let onOpenNode = () => {};

export function initGraphView(deps) {
  els = deps.els;
  if (typeof deps.onOpenNode === "function") {
    onOpenNode = deps.onOpenNode;
  }
}

// ---------------------------------------------------------------------
// Graph-specific style helpers
// ---------------------------------------------------------------------

export function nodeRadius(type, degree = 0) {
  const base = {
    index: 13,
    source: 7.5,
    concept: 9,
    entity: 9,
    project: 9.5,
    synthesis: 10.5
  }[type] || 8;
  return Math.min(18, base + Math.sqrt(Math.max(degree, 0)) * 1.25);
}

export function shortLabel(label) {
  return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}

// ---------------------------------------------------------------------
// Render entry point
// ---------------------------------------------------------------------

export function drawGraph(graph) {
  setupGraphInteractions();
  if (!graph || graph.nodes.length === 0) {
    stopGraphSimulation();
    graphView.nodes = [];
    graphView.edges = [];
    graphView.selectedId = "";
    graphView.hoverId = "";
    graphView.transform = { x: 0, y: 0, k: 1 };
    updateGraphSelection();
    els.graphSvg.setAttribute("viewBox", `0 0 ${graphView.width} ${graphView.height}`);
    els.graphSvg.innerHTML = `
      <rect class="graph-backdrop" width="${graphView.width}" height="${graphView.height}" />
      <text class="graph-empty" x="${graphView.width / 2}" y="${graphView.height / 2}" text-anchor="middle">No accepted graph nodes yet.</text>
    `;
    return;
  }

  const previous = new Map(graphView.nodes.map((node) => [node.id, node]));
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  graph.edges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });

  graphView.nodes = graph.nodes.map((node, index) => {
    const prior = previous.get(node.id);
    const seeded = seededGraphPoint(node, index, graph.nodes.length);
    return {
      ...node,
      path: graphNodePath(node),
      degree: degree.get(node.id) || 0,
      x: prior?.x ?? seeded.x,
      y: prior?.y ?? seeded.y,
      vx: prior?.vx ?? 0,
      vy: prior?.vy ?? 0
    };
  });
  const byId = new Map(graphView.nodes.map((node) => [node.id, node]));
  graphView.edges = graph.edges
    .map((edge) => ({ ...edge, source: byId.get(edge.from), target: byId.get(edge.to) }))
    .filter((edge) => edge.source && edge.target);
  graphView.selectedId = "";
  graphView.hoverId = "";
  els.graphSvg.setAttribute("viewBox", `0 0 ${graphView.width} ${graphView.height}`);
  updateGraphSelection();
  renderGraphFrame();
  startGraphSimulation(0.86);
}

// ---------------------------------------------------------------------
// Pointer / pan / zoom event wiring
// ---------------------------------------------------------------------

export function setupGraphInteractions() {
  if (graphView.bound) return;
  graphView.bound = true;

  els.graphSvg.addEventListener("pointerdown", (event) => {
    const point = graphPointer(event);
    const node = graphNodeFromEvent(event) || graphNodeAtPoint(point);
    if (node) {
      graphView.pointer = {
        type: "node",
        id: node.id,
        startX: point.x,
        startY: point.y,
        offsetX: node.x - point.x,
        offsetY: node.y - point.y,
        lastX: node.x,
        lastY: node.y,
        moved: false
      };
      graphView.hoverId = node.id;
      updateGraphSelection();
      renderGraphFrame();
      startGraphSimulation(0.42);
    } else {
      graphView.pointer = {
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        x: graphView.transform.x,
        y: graphView.transform.y,
        moved: false
      };
    }
    try {
      els.graphSvg.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic test events and some browsers may not expose an active pointer id.
    }
  });

  els.graphSvg.addEventListener("pointermove", (event) => {
    const active = graphView.pointer;
    if (active?.type === "node") {
      const node = graphView.nodes.find((item) => item.id === active.id);
      if (!node) return;
      const point = graphPointer(event);
      const nextX = clamp(point.x + active.offsetX, 44, graphView.width - 44);
      const nextY = clamp(point.y + active.offsetY, 44, graphView.height - 44);
      node.vx = (nextX - active.lastX) * 0.28;
      node.vy = (nextY - active.lastY) * 0.28;
      node.x = nextX;
      node.y = nextY;
      active.lastX = nextX;
      active.lastY = nextY;
      active.moved = active.moved || Math.hypot(point.x - active.startX, point.y - active.startY) > 4;
      graphView.hoverId = node.id;
      pullConnectedGraphNodes(node);
      startGraphSimulation(0.5);
      renderGraphFrame();
      return;
    }

    if (active?.type === "pan") {
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      graphView.transform.x = active.x + dx * (graphView.width / Math.max(els.graphSvg.clientWidth, 1));
      graphView.transform.y = active.y + dy * (graphView.height / Math.max(els.graphSvg.clientHeight, 1));
      active.moved = active.moved || Math.hypot(dx, dy) > 4;
      renderGraphFrame();
      return;
    }

    const hoverPoint = graphPointer(event);
    const hoverNode = graphNodeFromEvent(event) || graphNodeAtPoint(hoverPoint);
    const nextHoverId = hoverNode?.id || "";
    if (nextHoverId !== graphView.hoverId) {
      graphView.hoverId = nextHoverId;
      renderGraphFrame();
    }
  });

  els.graphSvg.addEventListener("pointerup", (event) => {
    const active = graphView.pointer;
    if (active?.type === "node") {
      const node = graphView.nodes.find((item) => item.id === active.id);
      if (node && !active.moved) {
        openGraphNode(node);
      } else if (node) {
        graphView.hoverId = node.id;
        startGraphSimulation(0.36);
      }
    }
    graphView.pointer = null;
    try {
      els.graphSvg.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore missing pointer capture; the graph state has already been released.
    }
  });

  els.graphSvg.addEventListener("pointerleave", () => {
    if (graphView.pointer) return;
    graphView.hoverId = "";
    renderGraphFrame();
  });

  document.addEventListener("pointermove", (event) => {
    if (!graphView.hoverId || graphView.pointer) return;
    if (els.graphSvg.contains(event.target)) return;
    graphView.hoverId = "";
    renderGraphFrame();
  });

  els.graphSvg.addEventListener("dblclick", (event) => {
    const node = graphNodeFromEvent(event) || graphNodeAtPoint(graphPointer(event));
    if (node) {
      openGraphNode(node);
      return;
    }
    resetGraphCamera();
  });

  els.graphSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGraphFromWheel(event);
  }, { passive: false });
}

// ---------------------------------------------------------------------
// Force simulation
// ---------------------------------------------------------------------

export function startGraphSimulation(alpha = 0.7) {
  graphView.alpha = Math.max(graphView.alpha, alpha);
  if (graphView.raf) return;
  graphView.raf = requestAnimationFrame(runGraphSimulation);
}

export function stopGraphSimulation() {
  if (graphView.raf) cancelAnimationFrame(graphView.raf);
  graphView.raf = 0;
  graphView.alpha = 0;
}

function runGraphSimulation() {
  graphView.raf = 0;
  const ambientAlpha = graphAmbientAlpha();
  if (graphView.nodes.length === 0 || graphView.alpha < 0.01 && ambientAlpha === 0) {
    graphView.alpha = 0;
    renderGraphFrame();
    return;
  }

  graphView.alpha = Math.max(graphView.alpha, ambientAlpha);
  tickGraphForces();
  renderGraphFrame();
  graphView.alpha *= graphView.alpha > 0.18 ? 0.972 : 0.988;
  graphView.raf = requestAnimationFrame(runGraphSimulation);
}

function graphAmbientAlpha() {
  const graphActive = document.getElementById("graph-view")?.classList.contains("active");
  if (!graphActive || graphView.nodes.length > 180) return 0;
  return graphView.pointer ? 0.05 : 0.024;
}

function tickGraphForces() {
  const nodes = graphView.nodes;
  const alpha = graphView.alpha;
  const centerX = graphView.width / 2;
  const centerY = graphView.height / 2;
  const draggingId = graphView.pointer?.type === "node" ? graphView.pointer.id : "";
  graphView.tick += 1;

  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 0.01) {
        dx = ((hashString(left.id) % 17) - 8) / 10;
        dy = ((hashString(right.id) % 19) - 9) / 10;
        distanceSq = dx * dx + dy * dy;
      }
      const distance = Math.sqrt(distanceSq);
      const minDistance = nodeRadius(left.type, left.degree) + nodeRadius(right.type, right.degree) + 24;
      const charge = (430 * alpha) / Math.max(distanceSq, 140);
      const nx = dx / distance;
      const ny = dy / distance;
      left.vx -= nx * charge;
      left.vy -= ny * charge;
      right.vx += nx * charge;
      right.vy += ny * charge;

      if (distance < minDistance) {
        const collision = (minDistance - distance) * 0.038 * alpha;
        left.vx -= nx * collision;
        left.vy -= ny * collision;
        right.vx += nx * collision;
        right.vy += ny * collision;
      }
    }
  }

  for (const edge of graphView.edges) {
    const source = edge.source;
    const target = edge.target;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const desired = graphLinkDistance(source, target);
    const stretch = distance - desired;
    const force = stretch * (stretch > 0 ? 0.022 : 0.009) * alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  for (const node of nodes) {
    if (node.id === draggingId) {
      node.vx *= 0.62;
      node.vy *= 0.62;
      continue;
    }
    const home = graphNodeHome(node);
    const drift = graphAmbientDrift(node);
    node.vx += (home.x - node.x) * 0.0014 * alpha;
    node.vy += (home.y - node.y) * 0.0014 * alpha;
    node.vx += (centerX - node.x) * 0.00016 * alpha;
    node.vy += (centerY - node.y) * 0.00016 * alpha;
    node.vx += drift.x * alpha;
    node.vy += drift.y * alpha;
    node.vx *= 0.9;
    node.vy *= 0.9;
    node.x = clamp(node.x + node.vx, 44, graphView.width - 44);
    node.y = clamp(node.y + node.vy, 44, graphView.height - 44);
  }
}

function graphAmbientDrift(node) {
  if (graphView.alpha > 0.09 || graphView.nodes.length > 180) return { x: 0, y: 0 };
  const phase = (hashString(node.id) % 628) / 100;
  const t = graphView.tick / 80;
  return {
    x: Math.sin(t + phase) * 0.018,
    y: Math.cos(t * 0.86 + phase) * 0.018
  };
}

function pullConnectedGraphNodes(node) {
  for (const edge of graphView.edges) {
    const neighbor = edge.source === node ? edge.target : edge.target === node ? edge.source : null;
    if (!neighbor) continue;
    const dx = node.x - neighbor.x;
    const dy = node.y - neighbor.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const desired = graphLinkDistance(node, neighbor);
    const stretch = Math.max(0, distance - desired * 0.62);
    const pull = Math.min(9, stretch * 0.045);
    neighbor.vx += (dx / distance) * pull;
    neighbor.vy += (dy / distance) * pull;
  }
}

// ---------------------------------------------------------------------
// SVG render
// ---------------------------------------------------------------------

function renderGraphFrame() {
  const activeId = graphView.hoverId;
  const relatedIds = activeId ? graphRelatedIds(activeId) : new Set();
  const transform = graphView.transform;
  const edgeSvg = graphView.edges.map((edge) => {
    const active = activeId && (edge.from === activeId || edge.to === activeId);
    const faded = activeId && !active;
    return `
      <line class="graph-edge${active ? " active" : ""}${faded ? " faded" : ""}"
        x1="${edge.source.x.toFixed(2)}" y1="${edge.source.y.toFixed(2)}"
        x2="${edge.target.x.toFixed(2)}" y2="${edge.target.y.toFixed(2)}" />
    `;
  }).join("");

  const nodeSvg = graphView.nodes.map((node) => {
    const selected = false;
    const hovered = node.id === graphView.hoverId;
    const related = relatedIds.has(node.id);
    const faded = activeId && !selected && !hovered && !related;
    const radius = nodeRadius(node.type, node.degree);
    const scale = hovered ? 1.16 : 1;
    return `
      <g class="graph-node type-${escapeHtml(node.type)}${selected ? " selected" : ""}${hovered ? " hovered" : ""}${related ? " related" : ""}${faded ? " faded" : ""}"
        data-id="${escapeHtml(node.id)}" transform="translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) scale(${scale.toFixed(3)})" tabindex="0" role="button">
        <circle class="node-glow" r="${(radius + 6).toFixed(2)}" />
        <circle class="node-core" r="${radius.toFixed(2)}" />
        <circle class="node-rim" r="${radius.toFixed(2)}" />
        <text class="node-label" x="${(radius + 10).toFixed(2)}" y="4">${escapeHtml(shortLabel(node.title))}</text>
        <title>${escapeHtml(node.title)}</title>
      </g>
    `;
  }).join("");

  els.graphSvg.innerHTML = `
    <rect class="graph-backdrop" width="${graphView.width}" height="${graphView.height}" />
    <g class="graph-camera" transform="translate(${transform.x.toFixed(2)} ${transform.y.toFixed(2)}) scale(${transform.k.toFixed(4)})">
      <g class="graph-edge-layer">${edgeSvg}</g>
      <g class="graph-node-layer">${nodeSvg}</g>
    </g>
  `;
}

// ---------------------------------------------------------------------
// Pointer math
// ---------------------------------------------------------------------

function graphPointer(event) {
  const svgPoint = graphSvgPoint(event);
  return {
    x: (svgPoint.x - graphView.transform.x) / graphView.transform.k,
    y: (svgPoint.y - graphView.transform.y) / graphView.transform.k
  };
}

function graphSvgPoint(event) {
  const rect = els.graphSvg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * graphView.width,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * graphView.height
  };
}

function graphNodeFromEvent(event) {
  const element = event.target.closest?.(".graph-node");
  if (!element) return null;
  const id = element.dataset.id;
  return graphView.nodes.find((node) => node.id === id) || null;
}

function graphNodeAtPoint(point) {
  let best = null;
  let bestDistance = Infinity;
  const hitPadding = 8 / Math.max(graphView.transform.k, 0.35);
  for (const node of graphView.nodes) {
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    const radius = nodeRadius(node.type, node.degree) + hitPadding;
    if (distance <= radius && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// Selection & navigation
// ---------------------------------------------------------------------

export function selectGraphNode(id, options = {}) {
  graphView.selectedId = id;
  graphView.hoverId = "";
  updateGraphSelection();
  renderGraphFrame();
  if (options.open) {
    const node = graphView.nodes.find((item) => item.id === id);
    if (node) openGraphNode(node);
  }
}

export function updateGraphSelection() {
  if (!els || !els.graphSelection) return;
  const node = graphView.nodes.find((item) => item.id === graphView.selectedId);
  els.graphSelection.hidden = !node;
  if (!node) return;
  els.graphSelectionMeta.textContent = graphNodeTypeLabel(node.type);
  els.graphSelectionTitle.textContent = node.title;
}

export function openSelectedGraphNode() {
  const node = graphView.nodes.find((item) => item.id === graphView.selectedId);
  if (node) openGraphNode(node);
}

function openGraphNode(node) {
  const path = graphNodePath(node);
  if (!path || !state.currentFileMap?.has(path)) return;
  onOpenNode(path);
}

export function resetGraphCamera() {
  graphView.transform = { x: 0, y: 0, k: 1 };
  startGraphSimulation(0.28);
  renderGraphFrame();
}

function zoomGraphFromWheel(event) {
  const deltaPixels = event.deltaMode === 1
    ? event.deltaY * 16
    : event.deltaMode === 2
      ? event.deltaY * 320
      : event.deltaY;
  const factor = clamp(Math.exp(-deltaPixels * 0.0011), 0.84, 1.19);
  zoomGraph(event, factor);
}

function zoomGraph(event, factor) {
  const point = graphSvgPoint(event);
  const old = graphView.transform;
  const nextK = clamp(old.k * factor, 0.35, 3.2);
  const graphX = (point.x - old.x) / old.k;
  const graphY = (point.y - old.y) / old.k;
  graphView.transform = {
    x: point.x - graphX * nextK,
    y: point.y - graphY * nextK,
    k: nextK
  };
  renderGraphFrame();
}

// ---------------------------------------------------------------------
// Graph topology helpers
// ---------------------------------------------------------------------

function graphRelatedIds(id) {
  const related = new Set([id]);
  graphView.edges.forEach((edge) => {
    if (edge.from === id) related.add(edge.to);
    if (edge.to === id) related.add(edge.from);
  });
  return related;
}

function seededGraphPoint(node, index, total) {
  const home = graphNodeHome(node);
  const seed = hashString(node.id || node.title || index);
  const angle = ((seed % 360) / 360) * Math.PI * 2;
  const spread = Math.min(240, 80 + total * 8);
  return {
    x: clamp(home.x + Math.cos(angle) * spread * (0.45 + ((seed % 13) / 30)), 60, graphView.width - 60),
    y: clamp(home.y + Math.sin(angle) * spread * (0.45 + ((seed % 17) / 34)), 60, graphView.height - 60)
  };
}

function graphNodeHome(node) {
  const width = graphView.width;
  const height = graphView.height;
  return {
    index: { x: width * 0.5, y: height * 0.48 },
    source: { x: width * 0.29, y: height * 0.58 },
    concept: { x: width * 0.52, y: height * 0.38 },
    project: { x: width * 0.39, y: height * 0.72 },
    entity: { x: width * 0.72, y: height * 0.55 },
    synthesis: { x: width * 0.56, y: height * 0.68 }
  }[node.type] || { x: width * 0.5, y: height * 0.5 };
}

function graphLinkDistance(source, target) {
  const sourceRadius = nodeRadius(source.type, source.degree);
  const targetRadius = nodeRadius(target.type, target.degree);
  const typeBonus = source.type === target.type ? 30 : 0;
  return sourceRadius + targetRadius + 92 + typeBonus;
}

function graphNodePath(node) {
  if (node.path) return node.path;
  if (node.id === "index" || node.type === "index") return "wiki/index.md";
  if (/^(sources|concepts|entities|projects|synthesis)\//.test(node.id)) return `wiki/${node.id}.md`;
  const bucket = {
    source: "sources",
    concept: "concepts",
    entity: "entities",
    project: "projects",
    synthesis: "synthesis"
  }[node.type];
  return bucket ? `wiki/${bucket}/${node.id}.md` : "";
}

function graphNodeTypeLabel(type) {
  return {
    index: "Index",
    source: "Source",
    concept: "Concept",
    entity: "Entity",
    project: "Project",
    synthesis: "Synthesis"
  }[type] || "Node";
}

// ---------------------------------------------------------------------
// File-map → graph projection
// ---------------------------------------------------------------------

export function graphFromFileMap(fileMap) {
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
  if (els && els.stats) {
    els.stats.textContent = `${fileMap.size} accepted file${fileMap.size === 1 ? "" : "s"} · ${nodes.length} reviewed nodes · ${edges.length} cited links`;
  }
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
      path,
      type: graphTypeFromPath(path, body),
      title: markdownTitle(body) || titleFromSlug(slug)
    }
  };
}

function isGraphNodePath(path) {
  return /^wiki\/(sources|concepts|entities|projects|synthesis)\/[^/]+\.md$/.test(path) || path === "wiki/index.md";
}

function resolveGraphLink(target, byPath, bySlug) {
  const trimmed = target.replace(/^\//, "").replace(/\.md$/, "");
  const pathCandidates = [
    target,
    `${trimmed}.md`,
    `wiki/sources/${trimmed}.md`,
    `wiki/concepts/${trimmed}.md`,
    `wiki/entities/${trimmed}.md`,
    `wiki/projects/${trimmed}.md`,
    `wiki/synthesis/${trimmed}.md`
  ];

  for (const candidate of pathCandidates) {
    const node = byPath.get(candidate);
    if (node) return node;
  }

  return bySlug.get(slugifyLoose(trimmed)) || bySlug.get(trimmed);
}
