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

import {
  arrayFromUnknown,
  clampSentence,
  cleanSummary,
  firstMatch,
  hasFinancialDetails,
  summaryTextValue
} from "./wiki.js";
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

// ---------------------------------------------------------------------
// Financial value cleaners + label extractors
// ---------------------------------------------------------------------

export function cleanFinancialValue(value) {
  const clean = cleanSummary(value);
  if (!clean) return "";
  const money = firstMatch(clean, MONEY_PATTERN);
  return money || clean;
}

export function cleanAccountLast4(value) {
  const raw = cleanSummary(value);
  if (/^\d{4}$/.test(raw)) return raw;
  const explicit = raw.match(/\b(?:account|acct)?[^.\n]{0,60}?\b(?:ending(?:\s+in)?|ends\s+in|last\s*(?:4|four))\b[^0-9]{0,20}(\d{4})(?!\d)/i);
  if (explicit?.[1]) return explicit[1];
  const numbered = raw.match(/\b(?:account|acct)[^.\n]{0,40}?\b(?:number|no\.?|#)\b[^0-9]{0,20}(?:x{2,}|\*{2,}|•{2,})?\s*(\d{4})(?!\d)/i);
  if (numbered?.[1]) return numbered[1];
  const masked = raw.match(/(?:x{2,}|\*{2,}|•{2,})\s*(\d{4})(?!\d)/i);
  if (masked?.[1]) return masked[1];
  return "";
}

export function titleCaseLabel(value) {
  return cleanSummary(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

export function labelBeforeValue(text, value) {
  const index = text.indexOf(value);
  if (index <= 0) return "";
  return cleanSummary(text.slice(Math.max(0, index - 70), index).replace(/[:\-–—|]+$/g, ""));
}

export function closestFinancialLabel(text) {
  const clean = cleanSummary(text);
  const candidates = [];
  const add = (pattern, labelForMatch) => {
    for (const match of clean.matchAll(pattern)) {
      const label = typeof labelForMatch === "function" ? labelForMatch(match) : labelForMatch;
      if (label) candidates.push({ index: match.index || 0, label });
    }
  };
  add(/\btotal account value\b/gi, "Total account value");
  add(/\baccount value\b/gi, (match) => (
    /\btotal\s+$/i.test(clean.slice(Math.max(0, match.index - 8), match.index)) ? "" : "Account value"
  ));
  add(/\bcash balance\b/gi, "Cash balance");
  add(/\bmarket value\b/gi, "Market value");
  add(/\bdividend\s+([A-Z]{2,5})\b/gi, (match) => `Dividend ${match[1].toUpperCase()}`);
  add(/\bdividend\b/gi, "Dividend");
  add(/\btransfer\s+from\s+([A-Za-z][A-Za-z ]{1,30}?)(?=\s+\d|\s*$)/gi, (match) => `Transfer from ${titleCaseLabel(match[1])}`);
  add(/\btransfer\b/gi, "Transfer");
  add(/\b([A-Z]{2,5})\s+\d+(?:\.\d+)?\s+(?:shares|units)\b/g, (match) => `${match[1].toUpperCase()} holding`);
  add(/\bfees?\b/gi, "Fee");
  add(/\bcontribution\b/gi, "Contribution");
  add(/\bdistribution\b/gi, "Distribution");
  add(/\btaxable amount\b/gi, "Taxable amount");
  candidates.sort((a, b) => b.index - a.index);
  return candidates[0]?.label || "";
}

export function financialLabelFromContext(text, value) {
  const clean = cleanSummary(text);
  return closestFinancialLabel(clean) || labelBeforeValue(clean, value) || "Visible amount";
}

export function transactionTypeFromText(text) {
  if (/\b(dividend|interest)\b/i.test(text)) return "dividend";
  if (/\b(fee|charge)\b/i.test(text)) return "fee";
  if (/\b(buy|bought|purchase)\b/i.test(text)) return "buy";
  if (/\b(sell|sold|redemption)\b/i.test(text)) return "sell";
  if (/\b(transfer|deposit|contribution|rollover)\b/i.test(text)) return "transfer";
  if (/\b(withdrawal|distribution)\b/i.test(text)) return "debit";
  return "unknown";
}

export function financialFigureFromString(text) {
  const clean = cleanSummary(text);
  if (!clean) return null;
  const value = firstMatch(clean, MONEY_PATTERN);
  return value ? {
    label: financialLabelFromContext(clean, value),
    value,
    date: firstMatch(clean, /\b(?:20\d{2}[-/]\d{2}(?:[-/]\d{2})?|Q[1-4]\s+20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})\b/i),
    context: clampSentence(clean, 160)
  } : null;
}

export function financialTransactionFromString(text) {
  const clean = cleanSummary(text);
  if (!clean) return null;
  const amount = firstMatch(clean, MONEY_PATTERN);
  if (!amount) return null;
  const amountIndex = clean.indexOf(amount);
  const descriptionSource = amountIndex >= 0 ? clean.slice(0, amountIndex).trim() : clean.replace(amount, "").trim();
  return {
    date: firstMatch(clean, /\b(?:20\d{2}[-/]\d{2}[-/]\d{2}|\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\b/i),
    description: clampSentence(descriptionSource, 120),
    amount,
    type: transactionTypeFromText(clean)
  };
}

// ---------------------------------------------------------------------
// Financial-section parsers (return arrays of typed records)
// ---------------------------------------------------------------------

export function parseFinancialAccounts(value) {
  return reviewItemsFromUnknown(value, isFinancialAccountObject)
    .map((item) => {
      if (typeof item === "string") return { accountName: clampSentence(item, 90) };
      if (!item || typeof item !== "object") return null;
      const account = {
        institution: cleanSummary(field(item, "institution", "provider", "custodian", "bank", "brokerage") || ""),
        owner: cleanSummary(field(item, "owner", "accountOwner", "account_owner", "holder", "name") || ""),
        accountType: cleanSummary(field(item, "accountType", "account_type", "type", "kind") || ""),
        accountName: cleanSummary(field(item, "accountName", "account_name", "name", "title", "label") || ""),
        accountNumberLast4: cleanAccountLast4(field(item, "accountNumberLast4", "account_number_last4", "last4", "last_four", "accountNumber", "account_number")),
        period: cleanSummary(field(item, "period", "statementPeriod", "statement_period", "date") || "")
      };
      return Object.values(account).some(Boolean) ? account : null;
    })
    .filter(Boolean)
    .slice(0, 4);
}

export function parseFinancialFigures(value) {
  return reviewItemsFromUnknown(value, isFinancialFigureObject)
    .map((item) => {
      if (typeof item === "string") return financialFigureFromString(item);
      if (!item || typeof item !== "object") return null;
      const figure = {
        label: cleanSummary(field(item, "label", "name", "type", "kind", "metric") || ""),
        value: cleanFinancialValue(field(item, "value", "amount", "balance", "figure")),
        date: cleanSummary(field(item, "date", "period", "asOf", "as_of") || ""),
        context: clampSentence(field(item, "context", "sourceContext", "source_context", "note", "description") || "", 160)
      };
      if (!figure.value && figure.context) {
        figure.value = firstMatch(figure.context, MONEY_PATTERN);
      }
      return figure.value || figure.label ? figure : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function parseFinancialHoldings(value) {
  return reviewItemsFromUnknown(value, isFinancialHoldingObject)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const holding = {
        symbol: cleanSummary(field(item, "symbol", "ticker") || ""),
        name: cleanSummary(field(item, "name", "security", "description") || ""),
        quantity: cleanSummary(field(item, "quantity", "shares", "units") || ""),
        value: cleanFinancialValue(field(item, "value", "marketValue", "market_value", "amount")),
        context: clampSentence(field(item, "context", "note") || "", 140)
      };
      return Object.values(holding).some(Boolean) ? holding : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function parseFinancialTransactions(value) {
  return reviewItemsFromUnknown(value, isFinancialTransactionObject)
    .map((item) => {
      if (typeof item === "string") return financialTransactionFromString(item);
      if (!item || typeof item !== "object") return null;
      const transaction = {
        date: cleanSummary(field(item, "date", "posted", "tradeDate", "trade_date", "settlementDate", "settlement_date") || ""),
        description: clampSentence(field(item, "description", "memo", "name", "label", "security") || "", 160),
        amount: cleanFinancialValue(field(item, "amount", "value", "netAmount", "net_amount")),
        type: cleanSummary(field(item, "type", "kind", "category") || "unknown")
      };
      return transaction.amount || transaction.description ? transaction : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function parseFinancialCaveats(value) {
  return arrayFromUnknown(value)
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map(summaryTextValue)
    .filter(Boolean)
    .slice(0, 4);
}

export function parseFinancialDetails(value) {
  const details = emptyFinancialDetails();
  if (!value) return details;
  const source = typeof value === "object" && !Array.isArray(value) ? value : { figures: value };
  details.accounts = parseFinancialAccounts(field(source, "accounts", "account", "accountDetails", "account_details"));
  details.figures = parseFinancialFigures(field(source, "figures", "importantFigures", "important_figures", "balances", "values", "amounts"));
  details.holdings = parseFinancialHoldings(field(source, "holdings", "positions", "securities"));
  details.transactions = parseFinancialTransactions(field(source, "transactions", "activity", "cashActivity", "cash_activity"));
  details.caveats = parseFinancialCaveats(field(source, "caveats", "warnings", "notes", "assumptions"));
  if (!hasFinancialDetails(details) && typeof value === "object" && !Array.isArray(value)) {
    details.figures = parseFinancialFigures(value);
  }
  return details;
}
