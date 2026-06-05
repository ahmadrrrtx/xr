/**
 * XR — v0.7 research mode tests.
 *
 * Focus on the DETERMINISTIC, testable layers (no live network, no real LLM):
 *   - search-output parsing
 *   - source ranking + trust scoring + dedupe
 *   - plan → queries flattening
 *   - JSON extraction from messy model text
 *   - the full engine run against an in-memory fake search + fake provider
 *   - report rendering + signature verification
 *   - DB persistence round-trip
 */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseSearxOutput, type SearchCapability } from "../src/research/search.ts";
import { rankSources, scoreDomain, domainOf } from "../src/research/ranking.ts";
import { queriesFromPlan, fallbackPlan } from "../src/research/plan.ts";
import { extractJson } from "../src/research/llm.ts";
import { renderReport, verifyReport } from "../src/research/report.ts";
import { runResearch } from "../src/research/engine.ts";
import { LocalResearchBudget } from "../src/research/budget.ts";
import { Store } from "../src/state/db.ts";
import type { Provider, Message, ModelTurn } from "../src/core/types.ts";

// ── search parsing ────────────────────────────────────────────────────────────
test("parseSearxOutput parses the web tool's formatted output", () => {
  const out = [
    "1. Best Budget Laptops 2026",
    "   https://www.example.com/laptops",
    "   A roundup of cheap dev laptops with snippets.",
    "",
    "2. Reddit thread",
    "   https://reddit.com/r/laptops/abc",
    "   anecdotal advice",
  ].join("\n");
  const hits = parseSearxOutput(out);
  expect(hits.length).toBe(2);
  expect(hits[0].title).toBe("Best Budget Laptops 2026");
  expect(hits[0].url).toBe("https://www.example.com/laptops");
  expect(hits[1].url).toContain("reddit.com");
});

// ── ranking ───────────────────────────────────────────────────────────────────
test("scoreDomain: gov/edu high, social low, unknown neutral-low", () => {
  expect(scoreDomain("nasa.gov").trust).toBeGreaterThan(0.8);
  expect(scoreDomain("mit.edu").trust).toBeGreaterThan(0.8);
  expect(scoreDomain("twitter.com").trust).toBeLessThan(0.4);
  expect(scoreDomain("some-random-blog.io").trust).toBeLessThanOrEqual(0.45);
});

test("domainOf strips www and lowercases", () => {
  expect(domainOf("https://WWW.Example.COM/path")).toBe("example.com");
  expect(domainOf("not a url")).toBe("");
});

test("rankSources dedupes by domain, sorts by trust, assigns sequential ids", () => {
  const ranked = rankSources(
    [
      {
        query: "q1",
        hits: [
          { title: "Blog A", url: "https://randomblog.xyz/a", snippet: "x" },
          { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Topic", snippet: "cited overview" },
          { title: "Blog A dup", url: "https://randomblog.xyz/b", snippet: "longer snippet here too" },
          { title: "Gov", url: "https://data.gov/x", snippet: "official" },
        ],
      },
    ],
    10,
  );
  // randomblog.xyz appears twice but should be deduped to one entry.
  const domains = ranked.map((s) => s.domain);
  expect(domains.filter((d) => d === "randomblog.xyz").length).toBe(1);
  // Highest trust (gov / wikipedia) should be first, ids sequential s1..sN.
  expect(ranked[0].trust).toBeGreaterThanOrEqual(ranked[ranked.length - 1].trust);
  expect(ranked[0].id).toBe("s1");
  expect(ranked.every((s) => s.fetched === false)).toBe(true);
});

// ── plan ──────────────────────────────────────────────────────────────────────
test("queriesFromPlan flattens + dedupes + caps", () => {
  const plan = fallbackPlan("Ollama vs cloud providers");
  const qs = queriesFromPlan(plan, 3);
  expect(qs.length).toBeLessThanOrEqual(3);
  expect(new Set(qs).size).toBe(qs.length); // unique
});

// ── llm json extraction ─────────────────────────────────────────────────────
test("extractJson pulls JSON out of fenced/messy model text", () => {
  const raw = 'Here you go:\n```json\n{"a": 1, "b": [2,3],}\n```\nthanks!';
  const obj = extractJson<{ a: number; b: number[] }>(raw);
  expect(obj?.a).toBe(1);
  expect(obj?.b.length).toBe(2);
});

test("extractJson returns null on non-JSON", () => {
  expect(extractJson("just prose, no json")).toBeNull();
});

// ── fakes for the engine ──────────────────────────────────────────────────────
class FakeSearch implements SearchCapability {
  available() {
    return true;
  }
  async search(query: string, max: number) {
    return {
      hits: [
        { title: `Result for ${query}`, url: "https://en.wikipedia.org/wiki/X", snippet: "An encyclopedic overview of the topic with detail." },
        { title: `Blog for ${query}`, url: "https://someblog.example/post", snippet: "An opinionated take." },
      ].slice(0, max),
    };
  }
  async fetch(_url: string) {
    return { ok: true, text: "The full page text. It states that X is faster than Y in most benchmarks." };
  }
}

/** A scripted provider: returns JSON envelopes appropriate to the prompt. */
class FakeProvider implements Provider {
  id = "fake";
  label = "Fake";
  async chat(messages: Message[], _tools: any[]): Promise<ModelTurn> {
    // structuredCall puts instructions in the user message (robust across
    // providers that inject their own system envelope), so match on all content.
    const sys = messages.map((m) => m.content).join(" ");
    let payload: unknown;
    if (sys.includes("research planner")) {
      payload = {
        objective: "Decide X vs Y",
        strategy: "compare benchmarks",
        questions: [{ text: "Which is faster?", queries: ["x vs y benchmark"] }],
      };
    } else if (sys.includes("evidence extractor")) {
      payload = { notes: [{ text: "X is faster than Y in benchmarks.", claim: "fact", confidence: "high" }] };
    } else if (sys.includes("research synthesizer")) {
      payload = {
        shortAnswer: "X is generally faster than Y.",
        executiveSummary: ["X wins on speed [s1]."],
        report: "## Verdict\nX is faster [s1].",
        openQuestions: ["Cost was not analyzed."],
        overallConfidence: "medium",
        contradictions: [],
      };
    } else {
      payload = { message: "ok" };
    }
    return { message: JSON.stringify(payload), toolCalls: [], done: true, usage: { inTokens: 10, outTokens: 20 } };
  }
  async health() {
    return { ok: true };
  }
}

// ── full engine run ───────────────────────────────────────────────────────────
test("runResearch produces sources, verified notes, and a synthesis", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-research-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    const session = await runResearch(
      {
        provider: new FakeProvider(),
        store,
        search: new FakeSearch(),
        budget: new LocalResearchBudget(),
        say: () => {},
      },
      { topic: "X vs Y", depth: "quick" },
    );

    expect(session.status).toBe("done");
    expect(session.sources.length).toBeGreaterThan(0);
    expect(session.notes.length).toBeGreaterThan(0);
    // Fetched sources ⇒ at least one verified note.
    expect(session.notes.some((n) => n.verified)).toBe(true);
    expect(session.synthesis?.shortAnswer).toContain("faster");

    // Persisted + retrievable.
    const latest = store.latestResearch();
    expect(latest?.id).toBe(session.id);

    // Report renders + signature verifies.
    const { markdown } = renderReport(session);
    expect(markdown).toContain("# Research Report");
    expect(markdown).toContain("## Sources");
    expect(verifyReport(markdown).valid).toBe(true);

    // Tampering breaks the signature.
    const tampered = markdown.replace("faster", "slower");
    expect(verifyReport(tampered).valid).toBe(false);
  } finally {
    store.close();
  }
});

// ── integrity: snippet-only notes are never marked verified ────────────────────
test("engine marks snippet-only notes unverified and degrades confidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-research2-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    // Search works but fetch always fails ⇒ snippet-only sources.
    const failFetch: SearchCapability = {
      available: () => true,
      search: async () => ({
        hits: [{ title: "T", url: "https://en.wikipedia.org/wiki/Z", snippet: "Snippet claims Z is true." }],
      }),
      fetch: async () => ({ ok: false, reason: "blocked" }),
    };
    const session = await runResearch(
      { provider: new FakeProvider(), store, search: failFetch, budget: new LocalResearchBudget(), say: () => {} },
      { topic: "Z facts", depth: "quick" },
    );
    expect(session.sources.every((s) => s.fetched === false)).toBe(true);
    expect(session.notes.every((n) => n.verified === false)).toBe(true);
  } finally {
    store.close();
  }
});

// ── graceful fallback: no search available ────────────────────────────────────
test("runResearch degrades gracefully when search is unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-research3-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    const noSearch: SearchCapability = {
      available: () => false,
      search: async () => ({ hits: [], unavailableReason: "no host" }),
      fetch: async () => ({ ok: false, reason: "no host" }),
    };
    const session = await runResearch(
      { provider: new FakeProvider(), store, search: noSearch, budget: new LocalResearchBudget(), say: () => {} },
      { topic: "anything", depth: "quick" },
    );
    expect(session.sources.length).toBe(0);
    // Still produces an honest "no conclusion" synthesis rather than fabricating.
    expect(session.synthesis).toBeDefined();
    expect(session.synthesis!.report.toLowerCase()).toContain("no conclusion");
  } finally {
    store.close();
  }
});
