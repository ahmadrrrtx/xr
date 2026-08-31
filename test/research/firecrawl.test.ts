/**
 * XR Phase 10 — Firecrawl adapter translation tests (hermetic; REAL local stub).
 *
 * Proves the adapter normalizes Firecrawl wire shapes into XR's internal model,
 * drops SSRF-blocked URLs, validates extraction output against the schema, and
 * never surfaces the API key.
 *
 * HISTORY (Phase 0 test-isolation fix): this file previously mocked
 * `mock.module("../../src/security/egress-proxy.ts")` — which in Bun's
 * single-process `bun test` LEAKS into every other test file in the process
 * (module mocks are global and cannot be restored). That leak is what made
 * `test/security/egress-proxy.test.ts` fail 13/16 under a monolith `bun test`
 * (the diagnosed F-14 "environment-sensitive egress failures" — it was never
 * DNS or port contention: `checkEgressTarget` had been replaced by a
 * `async () => ({ ok: true })` stub from THIS file). The adapter now runs
 * against a real local HTTP stub: stronger tests (real status codes, real
 * headers), zero module pollution.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hostnameOf } from "../../src/research/url-guard.ts";
import { defaultResearchLimits } from "../../src/research/jobs.ts";
import { ResearchProviderError } from "../../src/research/provider-types.ts";
import type { ResearchProviderContext } from "../../src/research/providers/types.ts";
import { shallowValidate } from "../../src/research/providers/firecrawl.ts";

const EXPECTED_KEY = "fc-expected-key";
let server: Server;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";

      if (req.headers.authorization !== `Bearer ${EXPECTED_KEY}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized", success: false }));
        return;
      }

      if (url === "/v1/search" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: [
              { title: "Good", url: "https://example.com/a", description: "d", publishedDate: "2026-01-01T00:00:00.000Z" },
              { title: "Blocked", url: "http://169.254.169.254/x" },
            ],
          }),
        );
        return;
      }
      if (url === "/v1/scrape" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              markdown: "# Title\n\nBody text",
              metadata: { title: "T", description: "D", language: "en", sourceURL: "https://example.com/a", publishedDate: "2026-01-01T00:00:00.000Z", author: "Alice" },
              links: ["https://example.com/b"],
            },
          }),
        );
        return;
      }
      if (url === "/v1/crawl/cj1" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            status: "completed",
            total: 1,
            completed: 1,
            data: [{ markdown: "# P", metadata: { title: "P", sourceURL: "https://example.com/p" } }],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: `unhandled ${req.method} ${url}` }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function ctx(overrides: Partial<ResearchProviderContext> = {}): ResearchProviderContext {
  return {
    signal: undefined,
    audit: () => {},
    egressAllowlist: ["127.0.0.1"],
    allowedHosts: [`127.0.0.1:${port}`],
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

// ── adapter translation (real guardedFetch against the local stub) ──────────

test("adapter normalizes search/scrape/crawl responses into XR's model", async () => {
  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const provider = new FirecrawlProvider({ baseUrl, apiKey: EXPECTED_KEY, timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });

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
  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const provider = new FirecrawlProvider({ baseUrl, apiKey: "fc-secret-key", timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
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
  const { FirecrawlProvider } = await import("../../src/research/providers/firecrawl.ts");
  const noKey = new FirecrawlProvider({ baseUrl, timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
  expect(noKey.configured()).toBe(false);
  let e1: unknown;
  try {
    await noKey.search("q", {}, ctx());
  } catch (e) {
    e1 = e;
  }
  expect((e1 as ResearchProviderError).kind).toBe("authentication_failure");

  const notAllowed = new FirecrawlProvider({ baseUrl, apiKey: EXPECTED_KEY, timeoutMs: 5000, maxPages: 5, maxDepth: 2, maxConcurrency: 2 });
  let e2: unknown;
  try {
    await notAllowed.search("q", {}, ctx({ egressAllowlist: [] }));
  } catch (e) {
    e2 = e;
  }
  expect((e2 as ResearchProviderError).kind).toBe("policy_denied");
});
