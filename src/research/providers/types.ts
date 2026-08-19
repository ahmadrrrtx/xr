/**
 * XR Phase 10 — research provider abstraction.
 *
 * One interface over every research backend (SearXNG, DirectFetch, Firecrawl,
 * future providers). Not every provider implements every capability —
 * `capabilities()` is the source of truth and selection NEVER assumes.
 *
 * Providers translate XR's normalized types ↔ their own wire format and must
 * NOT leak provider-specific response objects to callers.
 */

import type {
  ResearchCapabilityId,
  ResearchCrawlHandle,
  ResearchExtractResult,
  ResearchLimits,
  ResearchMapResult,
  ResearchProviderJobStatus,
  ResearchScrapeResult,
  ResearchSearchResult,
  ResearchSource,
} from "../provider-types.ts";

/** Everything a provider needs to run one operation, injected per call. */
export interface ResearchProviderContext {
  signal?: AbortSignal;
  audit(event: string, detail: Record<string, unknown>): void;
  egressAllowlist: readonly string[];
  allowedHosts?: readonly string[];
  limits: ResearchLimits;
  /** Budget consumption accounting (pages/requests/bytes). */
  consume(kind: "page" | "request" | "bytes", amount: number): void;
  /** Read current budget state so a provider can stop early. */
  budget(): { exhausted: boolean; reason?: string };
  /**
   * Validate a target URL through XR's centralized research URL guard before
   * this provider is asked to touch it. Providers MUST call this for every
   * user/page-supplied target (search results, page links, redirects).
   */
  assertUrl(url: string, opts?: { sameDomainRoot?: string }): Promise<{ ok: boolean; reason?: string; canonical?: string; host?: string }>;
}

export interface ResearchSearchOptions {
  maxResults?: number;
}

export interface ResearchScrapeOptions {
  /** Preferred output formats in priority order (provider may ignore). */
  formats?: string[];
  onlyMainContent?: boolean;
}

export interface ResearchCrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  /** URL globs excluded from the crawl (provider-specific support). */
  exclude?: string[];
}

export interface ResearchMapOptions {
  limit?: number;
}

export interface ResearchExtractOptions {
  schema: Record<string, unknown>;
}

export interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  /** The capabilities this provider actually supports. Selection never assumes. */
  capabilities(): ResearchCapabilityId[];
  health(): Promise<{ ok: boolean; detail?: string }>;
  search(query: string, opts: ResearchSearchOptions, ctx: ResearchProviderContext): Promise<ResearchSearchResult>;
  scrape(url: string, opts: ResearchScrapeOptions, ctx: ResearchProviderContext): Promise<ResearchScrapeResult>;
  map(url: string, opts: ResearchMapOptions, ctx: ResearchProviderContext): Promise<ResearchMapResult>;
  crawl(url: string, opts: ResearchCrawlOptions, ctx: ResearchProviderContext): Promise<ResearchCrawlHandle>;
  getJob(jobId: string, ctx: ResearchProviderContext): Promise<ResearchProviderJobStatus>;
  cancelJob(jobId: string, ctx: ResearchProviderContext): Promise<void>;
  extract(urls: string[], opts: ResearchExtractOptions, ctx: ResearchProviderContext): Promise<ResearchExtractResult>;
}

/**
 * A pool of providers with capability-aware selection + fallback.
 * Selection is deterministic (explicit preference → first available), never
 * an LLM hallucination. Failures are recorded so a fallback can be chosen.
 */
export interface ProviderPool {
  list(): ResearchProvider[];
  /** Providers supporting a capability, preferred provider first. */
  forCapability(capability: ResearchCapabilityId, preferred?: string): ResearchProvider[];
  /** Record a failure (selection considers it for fallback ordering). */
  recordFailure(providerId: string, kind: string): void;
  /** Record a success (resets the failure count). */
  recordSuccess(providerId: string): void;
}

/** Marker used by providers that do not implement a capability. */
export function unsupported(providerId: string, capability: ResearchCapabilityId): never {
  throw new Error(`provider "${providerId}" does not support ${capability}`);
}

/** Normalize a raw provider error message into something safe for callers. */
export function safeProviderError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Keep type exports for adapter files that want them in one place. */
export type { ResearchSource };
