/**
 * XR Phase 10 — normalized research provider model.
 *
 * These types are XR's INTERNAL research vocabulary. Provider adapters
 * (SearXNG, DirectFetch, Firecrawl, future providers) translate their own
 * wire shapes into these; Firecrawl response objects never leak into the
 * agent loop, memory, dashboard, TUI, or API contracts.
 *
 * Design rules:
 *  - Metadata is NEVER fabricated: unknown fields stay `undefined`.
 *  - `retrievedAt` is always XR's clock (epoch ms) — it is a fact XR knows.
 *  - `publishedAt` is only set when a source actually reports a date.
 *  - Citations always map back to a source XR actually saw.
 */

/** The five research operations XR exposes through its capability system. */
export type ResearchCapabilityId = "search" | "scrape" | "crawl" | "map" | "extract";

export const RESEARCH_CAPABILITIES: readonly ResearchCapabilityId[] = [
  "search",
  "scrape",
  "crawl",
  "map",
  "extract",
] as const;

/** Trust/verification state of a source. Never claims more than is known. */
export type VerificationState =
  | "unverified" // discovered (search/map), not yet retrieved
  | "retrieved" // fetched once, not yet cross-checked
  | "consistent" // corroborated by at least one independent source
  | "conflicting" // disagrees with another source
  | "stale" // retrieved earlier; a re-check showed it changed/aged out
  | "failed"; // retrieval/extraction failed

export const VERIFICATION_STATES: readonly VerificationState[] = [
  "unverified",
  "retrieved",
  "consistent",
  "conflicting",
  "stale",
  "failed",
] as const;

/**
 * A single external source with stable identity.
 * Only fields XR actually observed are set; everything else is `undefined`.
 */
export interface ResearchSource {
  /** Stable XR id for this source within a research run (e.g. `s1`). */
  sourceId: string;
  url: string;
  /** Canonical URL when the provider/page reports one; else undefined. */
  canonicalUrl?: string;
  domain: string;
  title?: string;
  description?: string;
  author?: string;
  /** ISO-8601 string when the source itself reports a publication date. */
  publishedAt?: string;
  /** XR's retrieval clock (epoch ms). Always set for retrieved sources. */
  retrievedAt: number;
  provider: string;
  contentType?: string;
  /** SHA-256 of the retrieved text/markdown (empty string => unset). */
  contentHash?: string;
  wordCount?: number;
  language?: string;
  verification: VerificationState;
  /** Normalized page content (markdown preferred; text fallback). */
  markdown?: string;
  text?: string;
  links?: string[];
  /** Crawl/map depth (0 = root). */
  depth?: number;
  /** Crawl/map parent URL. */
  parentUrl?: string;
  failed?: boolean;
  /** Safe, redacted reason when retrieval failed. */
  error?: string;
}

/** A formal citation. Every citation maps to an actually-retrieved source. */
export interface ResearchCitation {
  id: string;
  sourceId: string;
  url: string;
  title?: string;
  publishedAt?: string;
  retrievedAt: number;
  /** Optional locator within the source (e.g. "§2.1", "paragraph 4"). */
  locator?: string;
  /** Optional short excerpt quoted from the source. */
  excerpt?: string;
  contentHash?: string;
}

/** A verified evidence finding, tied to one source + citation. */
export interface ResearchFinding {
  id: string;
  sourceId: string;
  citationId?: string;
  text: string;
  quote?: string;
  confidence: "high" | "medium" | "low";
  verification: VerificationState;
  extractedAt: number;
}

/** Bounded limits for every research operation. Missing must NOT mean infinite. */
export interface ResearchLimits {
  maxPages: number;
  maxDepth: number;
  maxConcurrency: number;
  maxBytes: number;
  maxRequests: number;
  maxDurationMs: number;
  /** Optional spend ceiling; governed by the CostGovernor path when set. */
  maxCostUsd?: number;
  allowedDomains: string[];
  blockedDomains: string[];
  /** Restrict crawl/map to the starting domain. */
  sameDomainOnly: boolean;
  /** Whether an allowed domain also covers its subdomains. */
  includeSubdomains: boolean;
}

/** Counters a research run tracks so it can stop truthfully. */
export interface ResearchBudgetState {
  pages: number;
  requests: number;
  bytes: number;
  tokens: number;
  startedAt: number;
  lastAt: number;
  exhausted: boolean;
  reason?: string;
  /** Per-provider usage (e.g. Firecrawl pages billed). */
  providerUsage: Record<string, { pages: number; requests: number }>;
}

/** Truthful job states. A more specific state is used over a generic one. */
export type ResearchJobState =
  | "queued"
  | "planning"
  | "searching"
  | "scraping"
  | "crawling"
  | "extracting"
  | "verifying"
  | "synthesizing"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed"
  | "budget_exhausted"
  | "recovery_pending";

export const RESEARCH_JOB_STATES: readonly ResearchJobState[] = [
  "queued",
  "planning",
  "searching",
  "scraping",
  "crawling",
  "extracting",
  "verifying",
  "synthesizing",
  "completed",
  "partial",
  "cancelled",
  "failed",
  "budget_exhausted",
  "recovery_pending",
] as const;

export interface ResearchProgress {
  state: ResearchJobState;
  query?: string;
  provider?: string;
  discovered: number;
  completed: number;
  failed: number;
  elapsedMs: number;
  message?: string;
  updatedAt: number;
}

/** What the model/user asked for, normalized (provenance preserved). */
export interface ResearchRequest {
  intent: ResearchCapabilityId;
  query?: string;
  urls?: string[];
  /** Structured-extraction schema (extract intent only). */
  schema?: Record<string, unknown>;
  depth?: "quick" | "deep";
  limits?: Partial<ResearchLimits>;
  /** Who asked — CLI, daemon API, a model tool call, or the agent loop. */
  source: "cli" | "api" | "tool" | "agent";
  runId?: string;
}

/** A durable research job (search/scrape/crawl/map/extract or a full run). */
export interface ResearchJob {
  id: string;
  workspaceId: string;
  kind: ResearchCapabilityId;
  state: ResearchJobState;
  request: ResearchRequest;
  provider?: string;
  progress: ResearchProgress;
  limits: ResearchLimits;
  budget: ResearchBudgetState;
  sources: ResearchSource[];
  citations: ResearchCitation[];
  /** search → sources; scrape → source; map → sources; extract → data. */
  result?: unknown;
  report?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Operation results ────────────────────────────────────────────────────────

export interface ResearchSearchResult {
  query: string;
  sources: ResearchSource[];
  provider: string;
}

export interface ResearchScrapeResult {
  source: ResearchSource;
  provider: string;
}

export interface ResearchMapResult {
  root: string;
  sources: ResearchSource[];
  provider: string;
}

export interface ResearchExtractResult {
  data: unknown;
  sources: ResearchSource[];
  provider: string;
}

/** Async crawl handle returned when a provider crawl is started. */
export interface ResearchCrawlHandle {
  jobId: string;
  state: ResearchJobState;
  discovered?: number;
}

/** Status of a provider-side async job. */
export interface ResearchProviderJobStatus {
  jobId: string;
  state: "queued" | "scraping" | "completed" | "failed" | "cancelled" | "unknown";
  discovered?: number;
  completed?: number;
  failed?: number;
  sources?: ResearchSource[];
  error?: string;
}

// ── Streaming progress events ────────────────────────────────────────────────

/** Canonical research progress events (SSE / CLI / TUI all consume these). */
export type ResearchStreamEvent =
  | { type: "research_started"; jobId: string; kind: ResearchCapabilityId }
  | { type: "provider_selected"; jobId: string; provider: string; capability: ResearchCapabilityId }
  | { type: "search_started"; jobId: string; query: string; provider: string }
  | { type: "source_found"; jobId: string; sourceId: string; url: string; title?: string }
  | { type: "page_scraped"; jobId: string; sourceId: string; url: string }
  | { type: "crawl_status"; jobId: string; status: string; discovered?: number; completed?: number; failed?: number }
  | { type: "verification"; jobId: string; status: string }
  | { type: "budget_exhausted"; jobId: string; reason: string }
  | { type: "ssrf_blocked"; jobId: string; url: string; reason: string }
  | { type: "research_error"; jobId: string; code: string; message: string }
  | { type: "research_completed"; jobId: string; state: ResearchJobState; sources: number; citations: number };

// ── Provider error (retry classification) ───────────────────────────────────

export type ResearchProviderErrorKind =
  | "authentication_failure"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "unsupported_capability"
  | "network_failure"
  | "ssrf_blocked"
  | "policy_denied"
  | "budget_exhausted"
  | "invalid_schema"
  | "cancelled"
  | "malformed_response"
  | "unknown";

/** Retryable: transient network/provider states. Never retried: security, auth, schema. */
const RETRYABLE_KINDS: ReadonlySet<ResearchProviderErrorKind> = new Set([
  "rate_limit",
  "timeout",
  "unavailable",
  "network_failure",
]);

export function isRetryableResearchError(kind: ResearchProviderErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

export class ResearchProviderError extends Error {
  readonly kind: ResearchProviderErrorKind;
  readonly providerId: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(kind: ResearchProviderErrorKind, providerId: string, message: string, opts: { statusCode?: number } = {}) {
    super(message);
    this.name = "ResearchProviderError";
    this.kind = kind;
    this.providerId = providerId;
    this.retryable = isRetryableResearchError(kind);
    this.statusCode = opts.statusCode;
  }

  /** Safe for logs/audit: carries no secrets. */
  toSafeJson(): Record<string, unknown> {
    return { kind: this.kind, providerId: this.providerId, retryable: this.retryable, statusCode: this.statusCode, message: this.message };
  }
}
