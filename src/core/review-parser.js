// LLM review-payload parser primitives.
//
// This module is the bottom-up cluster for parsing the JSON shape that
// model-generated ingest reviews come back in. The parsers themselves
// (parseMissionFrame, parseTakeaways, parseFilingPlan, etc.) and the
// orchestrator (parseApiIngestReview) currently live in app.js — they
// will move on top of this foundation in subsequent phases.
//
// Phase 7i scope (this file):
//   - Object-shape predicates: 12 is*Object recognizers used to walk
//     loose nested JSON structures
//   - Recursion utilities: reviewItemsFromUnknown, takeawayItemsFromUnknown
//   - Factories: emptyFilingPlan, emptyFinancialDetails
//   - Small leaf helpers: questionBudgetForMode, optionListFromUnknown,
//     cleanFilingStep
//   - Constants: MONEY_PATTERN
//
// All functions here are pure: no DOM, no state, no localStorage.

import { cleanSummary, clampSentence } from "./wiki.js";
import { field } from "./utils.js";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

export const MONEY_PATTERN = /(?:[$€£]\s?-?\d[\d,]*(?:\.\d{2})?|-?\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP))/i;

// ---------------------------------------------------------------------
// Mode + budget
// ---------------------------------------------------------------------

export function questionBudgetForMode(mode) {
  return {
    auto: 0,
    suggested: 2,
    strict: 3
  }[mode] ?? 2;
}

// ---------------------------------------------------------------------
// Factories — empty review-payload shapes
// ---------------------------------------------------------------------

export function emptyFilingPlan(file = null) {
  return {
    whySaved: [],
    candidateFiles: [],
    placement: {
      bucket: "",
      path: "",
      title: "",
      reason: "",
      alternatives: []
    },
    tags: [],
    regionTag: "",
    typeTag: "",
    typeTagNote: "",
    promotion: { candidate: "", recommendation: "", reason: "" }
  };
}

export function emptyFinancialDetails() {
  return {
    accounts: [],
    figures: [],
    holdings: [],
    transactions: [],
    caveats: []
  };
}

// ---------------------------------------------------------------------
// Object-shape predicates (recognize fuzzy-named JSON nodes)
// ---------------------------------------------------------------------

export function isTakeawayObject(value) {
  return Boolean(field(value, "point", "takeaway", "text", "summary", "insight", "detail", "value"));
}

export function isLightTouchObject(value) {
  return Boolean(field(value, "note", "point", "text", "summary", "mention"));
}

export function isPropagationObject(value) {
  return Boolean(field(value, "targetPath", "target_path", "path", "wikiPath", "wiki_path", "action", "rationale", "reason"));
}

export function isConnectionObject(value) {
  return Boolean(field(value, "path", "targetPath", "target_path", "wikiPath", "wiki_path", "href", "title", "label", "name", "reason"));
}

export function isFilingStepObject(value) {
  return Boolean(field(value, "text", "step", "line", "summary", "detail", "description", "action", "target", "title", "name"));
}

export function isDiscoveryObject(value) {
  return Boolean(field(value, "detail", "text", "summary", "description", "reason", "title", "label", "kind", "type"));
}

export function isCandidateFileObject(value) {
  return Boolean(field(value, "path", "file", "wikiPath", "wiki_path", "reason", "rationale", "priority"));
}

export function isQuestionObject(value) {
  return Boolean(field(value, "question", "ask", "prompt", "text"));
}

export function isFinancialAccountObject(value) {
  return Boolean(field(value, "institution", "provider", "custodian", "owner", "accountType", "account_type", "accountName", "account_name", "accountNumber", "account_number", "last4"));
}

export function isFinancialFigureObject(value) {
  return Boolean(field(value, "value", "amount", "balance", "figure", "metric", "label", "name"));
}

export function isFinancialHoldingObject(value) {
  return Boolean(field(value, "symbol", "ticker", "security", "quantity", "shares", "units", "marketValue", "market_value", "value"));
}

export function isFinancialTransactionObject(value) {
  return Boolean(field(value, "date", "description", "memo", "amount", "netAmount", "net_amount", "type", "category"));
}

// ---------------------------------------------------------------------
// Recursion utilities (walk loose JSON structures into flat item lists)
// ---------------------------------------------------------------------

export function takeawayItemsFromUnknown(value, group = "") {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => takeawayItemsFromUnknown(item, group));
  }
  if (typeof value === "string") return group ? [{ point: value, group }] : [value];
  if (typeof value !== "object") return [];
  if (isTakeawayObject(value)) {
    return [{ ...value, group: field(value, "relevance", "group") || group }];
  }
  return Object.entries(value).flatMap(([key, nested]) => (
    takeawayItemsFromUnknown(nested, key)
  ));
}

export function reviewItemsFromUnknown(value, isSingleItem, group = "") {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => reviewItemsFromUnknown(item, isSingleItem, group));
  }
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];
  if (isSingleItem(value)) {
    return group && !field(value, "group", "kind", "relevance")
      ? [{ ...value, group }]
      : [value];
  }
  const nestedList = field(value, "items", "values", "entries", "list");
  if (nestedList !== undefined) return reviewItemsFromUnknown(nestedList, isSingleItem, group);
  return Object.entries(value).flatMap(([key, nested]) => (
    reviewItemsFromUnknown(nested, isSingleItem, key)
  ));
}

// ---------------------------------------------------------------------
// Small leaf helpers
// ---------------------------------------------------------------------

export function optionListFromUnknown(value) {
  const options = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s*(?:\||,|;)\s+/)
      : [];
  return options
    .map((option) => cleanSummary(option))
    .filter(Boolean)
    .slice(0, 4);
}

export function cleanFilingStep(value) {
  return clampSentence(String(value || "").replace(/^[✓✔\-\s]+/u, ""), 190);
}
