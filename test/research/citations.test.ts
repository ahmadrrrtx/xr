/**
 * XR Phase 10 — citation + provenance tests (offline, deterministic).
 *
 * Never fabricate: a citation only exists for an actually-retrieved source,
 * metadata is only what was observed, and every citation maps to a source.
 */

import { test, expect } from "bun:test";
import { buildCitation, buildCitations, contentHash, isCitable, markConflicting, markStale, verificationLabel, wordCount } from "../../src/research/citations.ts";
import type { ResearchSource } from "../../src/research/provider-types.ts";

function source(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    sourceId: "s1",
    url: "https://example.com/doc",
    domain: "example.com",
    retrievedAt: 1700000000000,
    provider: "firecrawl",
    verification: "retrieved",
    title: "Example Doc",
    description: "A description snippet.",
    publishedAt: "2026-01-02T00:00:00.000Z",
    contentHash: contentHash("body"),
    ...overrides,
  };
}

test("content hash is a stable sha256 and empty for empty input", () => {
  expect(contentHash("hello")).toBe(contentHash("hello"));
  expect(contentHash("hello")).toMatch(/^[a-f0-9]{64}$/);
  expect(contentHash("")).toBe("");
  expect(wordCount("one two  three")).toBe(3);
});

test("a retrieved source is citable; unverified/failed sources are not", () => {
  expect(isCitable(source({ verification: "retrieved" }))).toBe(true);
  expect(isCitable(source({ verification: "unverified" }))).toBe(false);
  expect(isCitable(source({ verification: "failed" }))).toBe(false);
});

test("buildCitation never fabricates: null for non-citable sources", () => {
  expect(buildCitation(source({ verification: "unverified" }))).toBeNull();
  const c = buildCitation(source({}), { index: 3, locator: "§2.1" });
  expect(c).not.toBeNull();
  expect(c!.id).toBe("c3");
  expect(c!.url).toBe("https://example.com/doc");
  expect(c!.sourceId).toBe("s1");
  expect(c!.retrievedAt).toBe(1700000000000);
  expect(c!.publishedAt).toBe("2026-01-02T00:00:00.000Z");
  expect(c!.locator).toBe("§2.1");
  expect(c!.contentHash).toMatch(/^[a-f0-9]{64}$/);
});

test("buildCitations only cites retrieved sources and indexes sequentially", () => {
  const citations = buildCitations([
    source({ sourceId: "s1", verification: "retrieved" }),
    source({ sourceId: "s2", verification: "unverified" }),
    source({ sourceId: "s3", verification: "retrieved" }),
  ]);
  expect(citations.length).toBe(2);
  expect(citations[0].id).toBe("c1");
  expect(citations[1].id).toBe("c2");
  expect(citations[1].sourceId).toBe("s3");
});

test("markConflicting only flags retrieved sources", () => {
  const sources = [source({ sourceId: "s1" }), source({ sourceId: "s2" }), source({ sourceId: "s3", verification: "unverified" })];
  markConflicting(sources, [["s1", "s2"]]);
  expect(sources[0].verification).toBe("conflicting");
  expect(sources[1].verification).toBe("conflicting");
  expect(sources[2].verification).toBe("unverified");
});

test("markStale only when the content hash changed", () => {
  const s = source({ verification: "retrieved", contentHash: "abc" });
  markStale(s, "def");
  expect(s.verification).toBe("stale");
  markStale(source({ verification: "retrieved", contentHash: "abc" }), "abc"); // unchanged → stays retrieved
});

test("verificationLabel is total and human", () => {
  expect(verificationLabel("conflicting")).toBe("conflicting");
  expect(verificationLabel(undefined)).toBe("unverified");
});
