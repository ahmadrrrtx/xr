/**
 * XR Phase 10 — Firecrawl adapter translation tests (offline; guardedFetch mocked).
 *
 * Proves the adapter normalizes Firecrawl wire shapes into XR's internal model,
 * drops SSRF-blocked URLs, validates extraction output against the schema, and
 * never surfaces the API key.
 */

import { test, expect, mock } from "bun:test";
import { hostnameOf } from "../../src/research/url-guard.ts";
import { defaultResearchLimits } from "../../src/research/jobs.ts";
import { ResearchProviderError } from "../../src/research/provider-types.ts";
import type { ResearchProviderContext } from "../../src/research/providers/types.ts";
import { shallowValidate } from "../../src/research/providers/firecrawl.ts";

function ctx(overrides: Partial<ResearchProviderContext> = {}): ResearchProviderContext {
  return {
    signal: undefined,
    audit: () => {},
    egressAllowlist: ["api.firecrawl.dev"],
    allowedHosts: [],
    limits: defaultResearchLimits(),
    consume: () => {},
    budget: () => ({ exhausted: false }),
    assertUrl: async (url: string) => ({ ok: true, canonical: url, host: hostnameOf(url) }),
    ...overrides,
  };
}

// ── shallow schema validation ────────────────────────────────────────────────

test("shallowValidate accepts conforming objects and rejects violations", () => {
  const schema = { type: "object", required: ["name", "price"], properties: { name: { type: "string" }, price: { type: "number" } } };
  expect(shallowValidate({ name: "x", price: 3 }, schema).ok).toBe(true);
  const missing = shallowValidate({ name: "x" }, schema);
  expect(missing.ok).toBe(false);
  expect(missing.errors.join(" ")).toContain("price");
  const wrongType = shallowValidate({ name: 5, price: 3 }, schema);
  expect(wrongType.ok).toBe(false);
  expect(wrongType.errors.join(" ")).toContain("name");
  expect(shallowValidate("not an object", schema).ok).toBe(false);
});

// ── adapter translation (guardedFetch mocked) ────────────────────────────────

test("adapter normalizes search/scrape/crawl responses into XR's model", async () => {
  let callNo = 0;
  mock.module("../../src/security/egress-proxy.ts", () => ({
    guardedFetch: async () => {
      callNo++;
      if (callNo === 1) {
        // /v1/search
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            success: true,
            data: [
              { title: "Good", url: "https://example.com/a", description: "d", publishedDate: "2026-01-01T00:00:00.000Z" },
              { title: "Blocked", url: "http://169.254.169.254/x" },
            ],
          }),
        };
      }
      if (callNo === 2) {
        // /v1/scrape
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              markdown: "# Title\n\nBody text",
              metadata: { title: "T", description: "D", language: "en", sourceURL: "https://example.com/a", publishedDate: "2026-01-01T00:00:00.000Z", author: "Alice" },
              links: ["https://example.com/b"],
            },
          }),
        };
      }
      // /v1/crawl/{id}
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          success: true,
          status: "completed",
          total: 1,
          completed: 1,
          data: [{ markdown: "# P", metadata: { title: "P", sourceURL: "https://example.com/p" } }],
        }),
      };
    },
    defaultResolve: async () => ["93.184.216.34"],
    checkEgressTarget: async () => ({ ok: true }),
  }));

  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const provider = new FirecrawlProvider({ baseUrl: "https://api.firecrawl.dev", apiKey: "fc-secret-key", timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });

  const search = await provider.search("q", {}, ctx());
  expect(search.sources.length).toBe(1); // blocked 169.254.169.254 dropped
  expect(search.sources[0].url).toBe("https://example.com/a");
  expect(search.sources[0].publishedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(search.sources[0].verification).toBe("unverified");

  const scrape = await provider.scrape("https://example.com/a", {}, ctx());
  expect(scrape.source.verification).toBe("retrieved");
  expect(scrape.source.markdown).toContain("Body text");
  expect(scrape.source.title).toBe("T");
  expect(scrape.source.author).toBe("Alice");
  expect(scrape.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(scrape.source.links).toEqual(["https://example.com/b"]);

  const job = await provider.getJob("cj1", ctx());
  expect(job.state).toBe("completed");
  const pages = job.sources ?? [];
  expect(pages.length).toBe(1);
  expect(pages[0].url).toBe("https://example.com/p");
});

test("adapter maps HTTP errors to classified, key-free errors", async () => {
  mock.module("../../src/security/egress-proxy.ts", () => ({
    guardedFetch: async () => ({ ok: false, status: 401, body: "unauthorized" }),
    defaultResolve: async () => ["93.184.216.34"],
    checkEgressTarget: async () => ({ ok: true }),
  }));
  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const provider = new FirecrawlProvider({ baseUrl: "https://api.firecrawl.dev", apiKey: "fc-secret-key", timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
  let caught: unknown;
  try {
    await provider.search("q", {}, ctx());
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ResearchProviderError);
  const err = caught as ResearchProviderError;
  expect(err.kind).toBe("authentication_failure");
  expect(err.retryable).toBe(false);
  expect(err.message).not.toContain("fc-secret-key");
});

test("adapter refuses unconfigured API key and non-allowlisted host", async () => {
  mock.module("../../src/security/egress-proxy.ts", () => ({
    guardedFetch: async () => ({ ok: true, status: 200, body: "{}" }),
    defaultResolve: async () => ["93.184.216.34"],
    checkEgressTarget: async () => ({ ok: true }),
  }));
  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const noKey = new FirecrawlProvider({ baseUrl: "https://api.firecrawl.dev", timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
  expect(noKey.configured()).toBe(false);
  let e1: unknown;
  try {
    await noKey.search("q", {}, ctx());
  } catch (e) {
    e1 = e;
  }
  expect((e1 as ResearchProviderError).kind).toBe("authentication_failure");

  const notAllowed = new FirecrawlProvider({ baseUrl: "https://api.firecrawl.dev", apiKey: "k", timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
  let e2: unknown;
  try {
    await notAllowed.search("q", {}, ctx({ egressAllowlist: [] }));
  } catch (e) {
    e2 = e;
  }
  expect((e2 as ResearchProviderError).kind).toBe("policy_denied");
});
