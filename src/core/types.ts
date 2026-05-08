// Canonical type shapes for Margins.
//
// These are the contracts that flow through ingest → review → filing →
// vault. Hand-written from the runtime shapes used in app.js as of the
// module-split refactor (Phase 2). Update here first when changing a
// shape; downstream JS files can reference via JSDoc:
//   /** @type {import("./core/types.ts").Source} */
//
// Optional fields use `?:` rather than `| undefined` to match the
// JS-with-JSDoc consumer style.

// ---------------------------------------------------------------------
// Sources & vault files
// ---------------------------------------------------------------------

export type SourceKind = "pdf" | "docx" | "markdown" | "text" | "html" | "audio" | "image" | "other";

export interface Frontmatter {
  title?: string;
  bucket?: string;
  tags?: string[];
  type?: string;
  region?: string;
  summary?: string;
  date?: string;
  [key: string]: unknown;
}

export interface RawSourceFile {
  name: string;
  path?: string;
  size?: number;
  type?: string;
  text?: string;
  body?: string;
  kind?: SourceKind;
  lastModified?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface SourceNoteEntry {
  path: string;
  body: string;
  frontmatter?: Frontmatter;
}

export type FileMap = Map<string, string>;

// ---------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------

export interface VaultHandleRecord {
  handle: FileSystemDirectoryHandle;
  name: string;
  storedAt?: number;
}

// ---------------------------------------------------------------------
// API + guard
// ---------------------------------------------------------------------

export type ApiProvider = "gemini" | "anthropic" | "openai" | "openrouter" | "local" | string;

export interface ApiSettings {
  provider: ApiProvider;
  model: string;
  endpoint?: string;
  secretMasked?: string;
}

export interface ApiGuardSettings {
  enabled: boolean;
  maxRequests: number;
  maxOutputTokens: number;
  maxSessionTokens: number;
  maxSessionUsd: number;
  minRequestDelaySeconds: number;
  maxRequestsPerWindow: number;
  requestWindowSeconds: number;
}

export interface ApiUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
}

// ---------------------------------------------------------------------
// Ingest review
// ---------------------------------------------------------------------

export type ReviewMode = "suggested" | "minimal" | "full";

export interface ReviewQuestion {
  id?: string;
  question: string;
  recommendation?: string;
  options?: string[];
  required?: boolean;
}

export interface FilingPlacement {
  bucket?: string;
  path?: string;
  title?: string;
}

export interface FilingPlan {
  placement?: FilingPlacement;
  tags?: string[];
  regionTag?: string;
  typeTag?: string;
  rationale?: string;
}

export interface IngestReview {
  summary?: string;
  filingPlan?: FilingPlan;
  questions?: ReviewQuestion[];
  fallbackQuestions?: ReviewQuestion[];
  connections?: string[];
  financialDetails?: Record<string, unknown>;
  modelReturnedNoQuestions?: boolean;
  source?: "local" | "api" | "merged";
  provider?: ApiProvider;
  raw?: unknown;
}

// ---------------------------------------------------------------------
// Dream mode
// ---------------------------------------------------------------------

export type DreamMode = "watch" | "walk" | "hybrid";

export interface DreamStage {
  id: string;
  name: string;
  duration?: number;
}

export interface DreamPreparedRun {
  mode: DreamMode;
  itemCount: number;
  fileCount: number;
  estimatedUsd: number;
  startedAt?: number;
}

export interface DreamRunResult {
  mode: DreamMode;
  startedAt: number;
  finishedAt: number;
  proposalCount: number;
  appliedCount: number;
}

// ---------------------------------------------------------------------
// Timing logs
// ---------------------------------------------------------------------

export interface ModelTimingEntry {
  fileName: string;
  startedAt: number;
  finishedAt: number;
  ms: number;
  provider?: ApiProvider;
  model?: string;
}

export interface ProcessTimingEntry {
  fileName: string;
  startedAt: number;
  finishedAt: number;
  ms: number;
}

// ---------------------------------------------------------------------
// Aggregate state shape (for reference; runtime object is in core/state.js)
// ---------------------------------------------------------------------

export interface AppState {
  files: RawSourceFile[];
  editedRawFiles: Map<string, RawSourceFile>;
  vaultFiles: RawSourceFile[];
  vault: VaultHandleRecord | null;
  selectedPath: string | null;
  selectedKind: string;
  currentFileMap: FileMap | null;
  loadedFileMap: FileMap;
  theme: "light" | "dark" | string;
  reviewMode: ReviewMode;
  llmFiles: Map<string, string>;
  llmSelectedPath: string | null;
  currentMaterialQuestions: ReviewQuestion[];
  llmPromptCopied: boolean;
  hasSavedCurrent: boolean;
  hasUnsavedEdits: boolean;
  pendingSave: boolean;
  processingInbox: boolean;
  processingFileName: string;
  vaultHandle: FileSystemDirectoryHandle | null;
  rememberedVaultHandle: FileSystemDirectoryHandle | null;
  vaultName: string;
  apiSettings: ApiSettings;
  apiSecret: string;
  apiGuardSettings: ApiGuardSettings;
  apiUsage: ApiUsage;
  apiQuestionSource: string;
  ingestReviews: Map<string, IngestReview>;
  ingestAnswers: Map<string, string>;
  ingestErrors: Map<string, string>;
  ingestProgress: Map<string, number>;
  modelTimings: ModelTimingEntry[];
  processTimings: ProcessTimingEntry[];
  activeProcessTimings: Map<string, number>;
  expandedReceiptLinks: Set<string>;
  expandedSummaries: Set<string>;
  entityQuery: string;
  entityFilterKind: string;
  entityFilterValue: string;
  entityFileMap: FileMap | null;
  entityTypePickerPath: string;
  entityTypeOptions: string[];
  entityRecentVisibleCount: number;
  entityRecentSourceKey: string;
  activityRecentVisibleCount: number;
  activityRecentSourceKey: string;
  pendingSourceVisibleCount: number;
  pendingSourceKey: string;
  dreamMode: DreamMode;
  dreamReviewActive: boolean;
  dreamSkippedItems: Set<string>;
  dreamDismissedBrokenLinks: Set<string>;
  dreamPreparedRun: DreamPreparedRun | null;
  dreamLastRun: DreamRunResult | null;
  dreamActiveStage: string;
}
