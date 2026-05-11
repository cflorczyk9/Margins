// Vault templates — describe the folder shape and seed files for a new
// Margins vault. Setup wizard step 1 picks one of these, step 4
// hands the resulting plan to scaffoldVault().
//
// Each template:
//   - id: stable string written to wiki/.margins/manifest.json
//   - label: shown in the picker
//   - description: one sentence
//   - folders: extra wiki/ subfolders to create (in addition to the base
//     set scaffoldVault always makes: sources, concepts, entities,
//     synthesis, _templates, .margins)
//   - seedFiles: { relativePath: bodyString } — written via
//     writeTextFileIfMissing so an existing vault is never clobbered

const BASE_OPERATOR_MANUAL = `# Operator Manual

This vault is a Margins-shaped Markdown wiki. Source files live in raw/.
Generated wiki pages live in wiki/. Operating instructions and queries
live alongside this file.

## Closed-set operations
ingest | query | compile | lint | update

## Authorship
- Treat raw/ files as evidence.
- Do not write inferences without confirming first.
- Use [[wiki links]] for entity mentions in source pages.
- Cite source pages when claiming a fact in a synthesis or concept page.
`;

const BASE_QUERY_COOKBOOK = `# Query Cookbook

Common patterns for operating this vault.

## What's been ingested?
Search wiki/ingest-tracker.md for the source filename.

## What changed recently?
Read the latest dated section in wiki/log.md.

## Where is this claim grounded?
Follow source links from the relevant concept or entity page.
`;

export const TEMPLATES = Object.freeze({
  general: {
    id: "general",
    label: "General",
    description: "A flexible vault for mixed sources — meetings, reading, and notes across topics.",
    folders: [
      "wiki/daily",
      "wiki/ideas"
    ],
    seedFiles: {
      "operator-manual.md": BASE_OPERATOR_MANUAL,
      "query-cookbook.md": BASE_QUERY_COOKBOOK,
      "wiki/index.md": indexSeed("General Vault", [
        "wiki/sources/ — every ingested source as its own page",
        "wiki/entities/ — people, organizations, tools",
        "wiki/concepts/ — durable ideas worth remembering",
        "wiki/synthesis/ — connection-point notes across sources",
        "wiki/daily/ — date-stamped notes",
        "wiki/ideas/ — drafts and open threads"
      ])
    }
  },

  student: {
    id: "student",
    label: "Student",
    description: "Lectures, readings, problem sets, and exam prep — built for a single course or term.",
    folders: [
      "wiki/courses",
      "wiki/lectures",
      "wiki/readings",
      "wiki/problem-sets",
      "wiki/exam-prep"
    ],
    seedFiles: {
      "operator-manual.md": `${BASE_OPERATOR_MANUAL}\n## Student-specific\n\n- Group lectures by course in wiki/courses/.\n- Tag readings with the course they belong to.\n- Promote recurring concepts (definitions, theorems, frameworks) into wiki/concepts/.\n- Cite slide numbers or page numbers when summarizing readings.\n`,
      "query-cookbook.md": `${BASE_QUERY_COOKBOOK}\n## Student patterns\n\n### What did this lecture cover?\nOpen the matching wiki/lectures/ page; follow concept backlinks.\n\n### What's on the exam?\nRead wiki/exam-prep/ pages; backlinks point to source lectures and readings.\n`,
      "wiki/index.md": indexSeed("Student Vault", [
        "wiki/courses/ — one page per course",
        "wiki/lectures/ — one page per lecture",
        "wiki/readings/ — one page per reading or chapter",
        "wiki/problem-sets/ — one page per pset",
        "wiki/exam-prep/ — synthesis pages across lectures + readings",
        "wiki/concepts/ — definitions, theorems, frameworks",
        "wiki/entities/ — instructors, authors, organizations"
      ])
    }
  },

  practitioner: {
    id: "practitioner",
    label: "Practitioner",
    description: "Client work, meeting notes, project files, and operating playbooks for a working professional.",
    folders: [
      "wiki/clients",
      "wiki/meetings",
      "wiki/projects",
      "wiki/playbooks"
    ],
    seedFiles: {
      "operator-manual.md": `${BASE_OPERATOR_MANUAL}\n## Practitioner-specific\n\n- One page per client in wiki/clients/, with status, contacts, and recent activity.\n- One page per meeting in wiki/meetings/, dated and tied to a client.\n- One page per project in wiki/projects/, with goal, status, owner.\n- Recurring how-tos belong in wiki/playbooks/.\n`,
      "query-cookbook.md": `${BASE_QUERY_COOKBOOK}\n## Practitioner patterns\n\n### What's the latest with this client?\nOpen wiki/clients/<name>.md; follow recent meeting backlinks.\n\n### What did we agree to last meeting?\nOpen wiki/meetings/YYYY-MM-DD-<topic>.md.\n`,
      "wiki/index.md": indexSeed("Practitioner Vault", [
        "wiki/clients/ — one page per client",
        "wiki/meetings/ — dated meeting notes",
        "wiki/projects/ — active and shipped projects",
        "wiki/playbooks/ — how-to references",
        "wiki/entities/ — people and organizations",
        "wiki/synthesis/ — cross-cutting reads"
      ])
    }
  },

  investor: {
    id: "investor",
    label: "Investor",
    description: "Companies, theses, calls, and a watchlist for someone tracking deals and markets.",
    folders: [
      "wiki/companies",
      "wiki/theses",
      "wiki/calls",
      "wiki/watchlist"
    ],
    seedFiles: {
      "operator-manual.md": `${BASE_OPERATOR_MANUAL}\n## Investor-specific\n\n- One page per company in wiki/companies/.\n- Investment theses live in wiki/theses/, linking to supporting companies.\n- Calls and meetings go in wiki/calls/, dated and tied to a company.\n- wiki/watchlist/ is for things on your radar that aren't yet tracked.\n`,
      "query-cookbook.md": `${BASE_QUERY_COOKBOOK}\n## Investor patterns\n\n### What's the thesis here?\nOpen wiki/theses/<name>.md; follow company backlinks.\n\n### What did the last call cover?\nOpen wiki/calls/YYYY-MM-DD-<company>.md.\n`,
      "wiki/index.md": indexSeed("Investor Vault", [
        "wiki/companies/ — one page per company",
        "wiki/theses/ — investment theses",
        "wiki/calls/ — dated call notes",
        "wiki/watchlist/ — tracked-but-not-active",
        "wiki/entities/ — people and firms",
        "wiki/synthesis/ — sector and thematic reads"
      ])
    }
  },

  custom: {
    id: "custom",
    label: "Custom",
    description: "Start with the base structure and shape it as you ingest. Pick this if no preset fits.",
    folders: [],
    seedFiles: {
      "operator-manual.md": BASE_OPERATOR_MANUAL,
      "query-cookbook.md": BASE_QUERY_COOKBOOK,
      "wiki/index.md": indexSeed("Custom Vault", [
        "wiki/sources/ — every ingested source as its own page",
        "wiki/entities/ — people, organizations, tools",
        "wiki/concepts/ — durable ideas worth remembering",
        "wiki/synthesis/ — connection-point notes across sources"
      ])
    }
  }
});

export const TEMPLATE_ORDER = ["general", "student", "practitioner", "investor", "custom"];

export const DEFAULT_TEMPLATE_ID = "general";

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES[DEFAULT_TEMPLATE_ID];
}

export function listTemplates() {
  return TEMPLATE_ORDER.map((id) => TEMPLATES[id]);
}

function indexSeed(title, bullets) {
  const list = bullets.map((line) => `- ${line}`).join("\n");
  return `# ${title}\n\nThis vault was created by Margins.\n\n## Folders\n\n${list}\n\n## How to use\n\nDrop original sources into raw/. Open Margins, click Process, and review the generated wiki pages before saving.\n`;
}
