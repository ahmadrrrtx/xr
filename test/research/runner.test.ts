/**
 * XR Phase 10 — runner orchestration tests (offline; mock providers).
 *
 * Covers: fallback on retryable errors, no-retry on security failures,
 * budget exhaustion with partial results, cancellation, domain policy,
 * citation building, and truthful lifecycle states.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { createProviderPool } from "../../src/research/providers/pool.ts";
import type { ResearchProvider, ResearchProviderContext, ResearchSearchOptions, ResearchScrapeOptions, ResearchCrawlOptions, ResearchMapOptions, ResearchExtractOptions } from "../../src/research/providers/types.ts";
import { ResearchProviderError, type ResearchCapabilityId, type ResearchCrawlHandle, type ResearchExtractResult, type ResearchMapResult, type ResearchProviderJobStatus, type ResearchScrapeResult, type ResearchSearchResult, type ResearchSource } from "../../src/research/provider-types.ts";
import { defaultResearchLimits, ResearchJobRegistry } from "../../src/research/jobs.ts";
import { runResearchOperation } from "../../src/research/runner.ts";

const publicResolver = async () => ["93.184.216.34"];

function hit(url: string, title = "Page"): ResearchSource {
  return { sourceId: "", url, domain: "example.com", title, retrievedAt: Date.now(), provider: "mock", verification: "unverified" };
}

class MockProvider implements ResearchProvider {
  id = "mock";
  label = "Mock";
  private searchImpl: () => Promise<ResearchSearchResult>;
  private scrapeImpl: (url: string) => Promise<ResearchScrapeResult>;
  private crawlImpl: () => Promise<ResearchCrawlHandle>;
  private getJobImpl: () => Promise<ResearchProviderJobStatus>;
  cancelCalls = 0;

  constructor(opts: {
    search?: () => Promise<ResearchSearchResult>;
    scrape?: (url: string) => Promise<ResearchScrapeResult>;
    crawl?: () => Promise<ResearchCrawlHandle>;
    getJob?: () => Promise<ResearchProviderJobStatus>;
  } = {}) {
    this.searchImpl = opts.search ?? (async () => ({ query: "q", provider: "mock", sources: [hit("https://example.com/a", "A"), hit("https://example.com/b", "B")] }));
    this.scrapeImpl = opts.scrape ?? (async (url) => ({ provider: "mock", source: { ...hit(url), verification: "retrieved", text: "page text", contentHash: "h" } }));
    this.crawlImpl = opts.crawl ?? (async () => ({ jobId: "pj1", state: "crawling" }));
    this.getJobImpl = opts.getJob ??
      (async () => ({
        jobId: "pj1",
        state: "completed",
        sources: [
          { ...hit("https://example.com/1", "One"), verification: "retrieved", text: "one", contentHash: "h1" },
          { ...hit("https://example.com/2", "Two"), verification: "retrieved", text: "two", contentHash: "h2" },
        ],
      }));
  }

  capabilities(): ResearchCapabilityId[] {
    return ["search", "scrape", "crawl", "map", "extract"];
  }
  async health() {
    return { ok: true };
  }
  async search(query: string, _opts: ResearchSearchOptions, _ctx: ResearchProviderContext): Promise<ResearchSearchResult> {
    return this.searchImpl();
  }
  async scrape(url: string, _opts: ResearchScrapeOptions, _ctx: ResearchProviderContext): Promise<ResearchScrapeResult> {
    return this.scrapeImpl(url);
  }
  async map(_url: string, _opts: ResearchMapOptions, _ctx: ResearchProviderContext): Promise<ResearchMapResult> {
    return { root: _url, provider: "mock", sources: [hit("https://example.com/x"), hit("https://evil.com/y")] };
  }
  async crawl(_url: string, _opts: ResearchCrawlOptions, _ctx: ResearchProviderContext): Promise<ResearchCrawlHandle> {
    return this.crawlImpl();
  }
  async getJob(_jobId: string, _ctx: ResearchProviderContext): Promise<ResearchProviderJobStatus> {
    return this.getJobImpl();
  }
  async cancelJob(_jobId: string, _ctx: ResearchProviderContext): Promise<void> {
    this.cancelCalls++;
  }
  async extract(_urls: string[], _opts: ResearchExtractOptions, _ctx: ResearchProviderContext): Promise<ResearchExtractResult> {
    return { provider: "mock", data: { name: "x" }, sources: [] };
  }
}

function deps(pool: ReturnType<typeof createProviderPool>, store: Store | null = null, extra: Record<string, unknown> = {}) {
  return {
    pool,
    registry: new ResearchJobRegistry(store, "ws1"),
    egressAllowlist: ["api.firecrawl.dev"],
    resolve: publicResolver,
    ...extra,
  };
}

test("search completes with normalized, deduplicated sources and no citations (unverified)", async () => {
  const pool = createProviderPool([new MockProvider()]);
  const job = await runResearchOperation(deps(pool), { intent: "search", query: "q", source: "cli" });
  expect(job.state).toBe("completed");
  expect(job.sources.length).toBe(2);
  expect(job.sources[0].sourceId).toBe("s1");
  expect(job.citations.length).toBe(0); // search hits are not retrieved → not citable
});

test("retryable provider failure falls back to the next provider", async () => {
  const failing = new MockProvider({
    search: async () => {
      throw new ResearchProviderError("rate_limit", "mock", "429");
    },
  });
  failing.id = "failing";
  const good = new MockProvider();
  good.id = "good";
  const pool = createProviderPool([failing, good]);
  const job = await runResearchOperation(deps(pool), { intent: "search", query: "q", source: "cli" });
  expect(job.state).toBe("completed");
  expect(job.provider).toBe("good");
});

test("non-retryable security failure is NOT retried and fails truthfully", async () => {
  const auth = new MockProvider({
    search: async () => {
      throw new ResearchProviderError("authentication_failure", "mock", "bad key");
    },
  });
  auth.id = "auth";
  const good = new MockProvider();
  good.id = "good";
  const pool = createProviderPool([auth, good]);
  const job = await runResearchOperation(deps(pool), { intent: "search", query: "q", source: "cli" });
  expect(job.state).toBe("failed");
  expect(job.provider).toBe("auth"); // never fell through to good
});

test("unsupported capability yields a truthful failed state", async () => {
  const p = new MockProvider();
  p.capabilities = () => ["scrape"];
  const pool = createProviderPool([p]);
  const job = await runResearchOperation(deps(pool), { intent: "search", query: "q", source: "cli" });
  expect(job.state).toBe("failed");
  expect(job.error).toContain("no configured provider supports search");
});

test("scrape validates the URL and builds a citation for the retrieved source", async () => {
  const pool = createProviderPool([new MockProvider()]);
  const job = await runResearchOperation(deps(pool), { intent: "scrape", urls: ["https://example.com/doc"], source: "cli" });
  expect(job.state).toBe("completed");
  expect(job.sources.length).toBe(1);
  expect(job.citations.length).toBe(1);
  expect(job.citations[0].url).toBe("https://example.com/doc");
});

test("scrape of a private target is blocked before any provider call", async () => {
  const pool = createProviderPool([new MockProvider()]);
  const job = await runResearchOperation(deps(pool), { intent: "scrape", urls: ["http://127.0.0.1/secret"], source: "cli" });
  expect(job.state).toBe("failed");
  expect(job.error).toContain("blocked");
});

test("crawl runs to completion, merges pages, and builds citations", async () => {
  const pool = createProviderPool([new MockProvider()]);
  const job = await runResearchOperation(deps(pool, null, { pollIntervalMs: 10 }), { intent: "crawl", urls: ["https://example.com"], source: "cli" });
  expect(job.state).toBe("completed");
  expect(job.sources.length).toBe(2);
  expect(job.citations.length).toBe(2);
});

test("crawl stops truthfully at budget exhaustion with partial results preserved", async () => {
  let poll = 0;
  const infinite = new MockProvider({
    getJob: async () => {
      poll++;
      return {
        jobId: "pj1",
        state: "scraping",
        sources: [
          { ...hit(`https://example.com/p${poll}a`, `P${poll}a`), verification: "retrieved", text: "t", contentHash: "h" },
          { ...hit(`https://example.com/p${poll}b`, `P${poll}b`), verification: "retrieved", text: "t", contentHash: "h" },
        ],
      };
    },
  });
  const pool = createProviderPool([infinite]);
  const limits = defaultResearchLimits({ maxPages: 2, maxDurationMs: 5000 });
  const job = await runResearchOperation(deps(pool, null, { pollIntervalMs: 5 }), { intent: "crawl", urls: ["https://example.com"], limits, source: "cli" });
  expect(job.state).toBe("budget_exhausted");
  expect(job.sources.length).toBeGreaterThan(0); // partial preserved
  expect(job.citations.length).toBe(job.sources.length);
  expect(infinite.cancelCalls).toBeGreaterThanOrEqual(1);
});

test("crawl cancellation aborts and cancels the provider job", async () => {
  const never = new MockProvider({
    getJob: async () => ({ jobId: "pj1", state: "scraping", sources: [] }),
  });
  const pool = createProviderPool([never]);
  const registry = new ResearchJobRegistry(null, "ws1");
  const run = runResearchOperation(
    { pool, registry, egressAllowlist: [], resolve: publicResolver, pollIntervalMs: 5 },
    { intent: "crawl", urls: ["https://example.com"], source: "cli" },
  );
  // The job is created synchronously; cancel it mid-run.
  const id = registry.list()[0].id;
  await new Promise((r) => setTimeout(r, 20));
  expect(registry.cancel(id).ok).toBe(true);
  const job = await run;
  expect(job.state).toBe("cancelled");
  expect(never.cancelCalls).toBeGreaterThanOrEqual(1);
});

test("map enforces domain policy on discovered links", async () => {
  const pool = createProviderPool([new MockProvider()]);
  const job = await runResearchOperation(deps(pool), {
    intent: "map",
    urls: ["https://example.com"],
    limits: defaultResearchLimits({ allowedDomains: ["example.com"] }),
    source: "cli",
  });
  // evil.com link is dropped by the domain policy.
  expect(job.sources.every((s) => s.domain === "example.com")).toBe(true);
});
