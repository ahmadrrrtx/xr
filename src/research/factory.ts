/**
 * XR Phase 10 — research provider pool factory.
 *
 * Builds the provider pool from configuration. SearXNG + DirectFetch are
 * always present (they degrade gracefully when egress disallows them);
 * Firecrawl is added only when configured AND an API key resolves. The key is
 * read from the OS keychain / env via the existing secret system and is never
 * returned, logged, or surfaced.
 */

import type { XRConfig } from "../config/config.ts";
import { getSecretSyncCached } from "../security/secrets.ts";
import type { ResearchLimits } from "./provider-types.ts";
import { DirectFetchProvider } from "./providers/direct-fetch.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import { SearxngProvider } from "./providers/searxng.ts";
import { createProviderPool } from "./providers/pool.ts";
import type { ProviderPool, ResearchProvider } from "./providers/types.ts";

export function researchLimitsFromConfig(config: XRConfig): ResearchLimits {
  const r = config.research;
  return {
    maxPages: r.maxPages,
    maxDepth: r.maxDepth,
    maxConcurrency: r.maxConcurrency,
    maxBytes: r.maxBytes,
    maxRequests: r.maxRequests,
    maxDurationMs: r.maxDurationMs,
    allowedDomains: [...r.allowedDomains],
    blockedDomains: [...r.blockedDomains],
    sameDomainOnly: r.sameDomainOnly,
    includeSubdomains: r.includeSubdomains,
  };
}

/** Resolve the Firecrawl API key from the configured env name (never logs it). */
export function resolveFirecrawlKey(config: XRConfig): string | undefined {
  const envName = config.research.firecrawl.apiKeyEnv;
  return process.env[envName] || getSecretSyncCached(envName) || undefined;
}

/** Build the research provider pool for a config. */
export function buildResearchPool(config: XRConfig): { pool: ProviderPool; providers: ResearchProvider[] } {
  const providers: ResearchProvider[] = [new SearxngProvider(), new DirectFetchProvider()];
  const fc = config.research.firecrawl;
  if (fc.enabled) {
    const apiKey = resolveFirecrawlKey(config);
    if (apiKey) {
      providers.push(
        new FirecrawlProvider({
          baseUrl: fc.baseUrl,
          apiKey,
          timeoutMs: fc.timeoutMs,
          maxPages: fc.maxPages,
          maxDepth: fc.maxDepth,
          maxConcurrency: fc.maxConcurrency,
        }),
      );
    }
  }
  return { pool: createProviderPool(providers), providers };
}
