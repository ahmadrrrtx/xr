/**
 * Phase 18 · Research pure helpers (desktop/src/research/core.ts).
 *
 * Citation indexing/rewriting, depth mapping, status→phase, formatting and
 * the export document. Negative branches included per house rule.
 */
import { describe, expect, test } from "bun:test";

import * as core from "../../desktop/src/research/core.ts";

const {
  DEPTH_BUDGETS,
  citationIndex,
  rewriteCitations,
  markCited,
  engineDepthFor,
  engineModeFor,
  uiDepthForEngine,
  depthHint,
  phaseForStatus,
  planSteps,
  isRunningPhase,
  announcementFor,
  sourceFromLite,
  mergeSources,
  isLocalSource,
  fmtCost,
  fmtTokens,
  fmtDuration,
  statsLine,
  slugify,
  workspaceReportPath,
  followUps,
  exportMarkdown,
  parseRunEvent,
} = core;

const lite = (id: string, extra: Partial<core.LiteSource> = {}): core.LiteSource => ({
  id,
  url: `https://${id}.example.org/post`,
  domain: `${id}.example.org`,
  title: `Title ${id}`,
  snippet: `Snippet ${id}`,
  type: "blog",
  trust: 0.5,
  relevance: 0.5,
  freshness: "unknown",
  fetched: false,
  verified: false,
  contentChars: 0,
  foundVia: "q",
  ...extra,
});

describe("citations", () => {
  test("indexes [sN] markers in first-appearance order", () => {
    const idx = citationIndex("Claim [s3]. Another [s1] and again [s3]. Third [s2].");
    expect(idx.order).toEqual(["s3", "s1", "s2"]);
    expect(idx.numberFor).toEqual({ s3: 1, s1: 2, s2: 3 });
  });

  test("empty/null report → empty index", () => {
    expect(citationIndex(null).order).toEqual([]);
    expect(citationIndex("").order).toEqual([]);
    expect(citationIndex("no markers here [1] [x9]").order).toEqual([]);
  });

  test("rewrites markers into #cite links, leaves code untouched", () => {
    const report = "A [s2] b [s1].\n\n```ts\nconst x = '[s1]';\n```\nInline `[s2]` stays. Unknown [s9] stays.";
    const idx = citationIndex("A [s2] b [s1].");
    const out = rewriteCitations(report, idx);
    expect(out).toContain("A [1](#cite-s2) b [2](#cite-s1).");
    expect(out).toContain("const x = '[s1]';");
    expect(out).toContain("Inline `[s2]` stays.");
    expect(out).toContain("Unknown [s9] stays.");
  });

  test("markCited flags only indexed sources", () => {
    const idx = citationIndex("[s1]");
    const out = markCited([sourceFromLite(lite("s1"), 0), sourceFromLite(lite("s2"), 1)], idx);
    expect(out.map((s) => s.cited)).toEqual([true, false]);
  });
});

describe("depth mapping", () => {
  test("UI depths map onto the engine's three budgets (Academic = thorough/academic)", () => {
    expect(engineDepthFor("quick")).toBe("quick");
    expect(engineDepthFor("standard")).toBe("deep");
    expect(engineDepthFor("deep")).toBe("thorough");
    expect(engineDepthFor("academic")).toBe("thorough");
    expect(engineModeFor("academic")).toBe("academic");
    expect(engineModeFor("standard")).toBe("deep");
    expect(uiDepthForEngine("deep")).toBe("standard");
    expect(uiDepthForEngine("thorough", "academic")).toBe("academic");
    expect(uiDepthForEngine("thorough")).toBe("deep");
  });

  test("hints quote engine budgets — never minutes", () => {
    const hint = depthHint("standard");
    expect(hint).toContain(String(DEPTH_BUDGETS.deep.maxQueries));
    expect(hint).toContain(String(DEPTH_BUDGETS.deep.maxFetched));
    expect(hint).not.toMatch(/\bmin(ute)?s?\b/i);
    const custom = depthHint("quick", { ...DEPTH_BUDGETS, quick: { ...DEPTH_BUDGETS.quick, maxQueries: 99 } });
    expect(custom).toContain("99");
  });
});

describe("phases", () => {
  test("engine statuses collapse onto UI phases", () => {
    expect(phaseForStatus("planning")).toBe("planning");
    expect(phaseForStatus("discovering")).toBe("searching");
    expect(phaseForStatus("ranking")).toBe("searching");
    expect(phaseForStatus("fetching")).toBe("reading");
    expect(phaseForStatus("extracting")).toBe("reading");
    expect(phaseForStatus("checking")).toBe("synthesizing");
    expect(phaseForStatus("synthesizing")).toBe("synthesizing");
    expect(phaseForStatus("done")).toBe("done");
  });

  test("plan steps mark done/active/pending", () => {
    const steps = planSteps("reading");
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "active", "pending"]);
    expect(planSteps("idle").every((s) => s.state === "pending")).toBe(true);
    expect(planSteps("done").every((s) => s.state === "done")).toBe(true);
  });

  test("running phases", () => {
    expect(isRunningPhase("searching")).toBe(true);
    expect(isRunningPhase("idle")).toBe(false);
    expect(isRunningPhase("partial")).toBe(false);
  });

  test("announcements only on change", () => {
    expect(announcementFor("searching", "searching", 3)).toBeNull();
    expect(announcementFor("searching", "reading", 14)).toBe("Found 14 sources");
    expect(announcementFor("searching", "reading", 0)).toBe("Reading sources");
    expect(announcementFor("reading", "synthesizing", 5)).toBe("Writing report");
    expect(announcementFor("synthesizing", "done", 5)).toBe("Done");
  });
});

describe("sources", () => {
  test("sourceFromLite derives status/trust/freshness and keeps evidence", () => {
    const fetched = sourceFromLite(lite("s1", { fetched: true, contentChars: 1200, freshness: "recent" }), 0, ["q1"]);
    expect(fetched.status).toBe("fetched");
    expect(fetched.evidence).toEqual(["q1"]);
    expect(fetched.freshness).toBe("recent");
    expect(sourceFromLite(lite("s9", { trust: 7, relevance: -1, title: "" }), 3).trust).toBe(1);
    expect(sourceFromLite(lite("s9", { trust: 7, relevance: -1, title: "" }), 3).relevance).toBe(0);
    expect(sourceFromLite(lite("s9", { title: "" }), 3).title).toBe("s9.example.org");
    const failed = sourceFromLite(lite("s2", { fetched: false, fetchError: "fetch failed (status 503)" }), 1);
    expect(failed.status).toBe("failed");
    const found = sourceFromLite(lite("s3"), 2);
    expect(found.status).toBe("found");
  });

  test("mergeSources follows the engine's snapshot, keeps seq and read sources", () => {
    const first = mergeSources([], [lite("s1"), lite("s2")]);
    expect(first.map((s) => s.seq)).toEqual([0, 1]);
    // s1 dropped by ranking (never read) → gone; s2 updated in place; s3 appended.
    const second = mergeSources(first, [lite("s2", { title: "Renamed" }), lite("s3")]);
    expect(second.map((s) => s.id)).toEqual(["s2", "s3"]);
    expect(second[0]?.title).toBe("Renamed");
    expect(second[0]?.seq).toBe(1);
    expect(second[1]?.seq).toBe(2);
    // A source that was already read survives a snapshot that omits it.
    const read = first.map((s) => (s.id === "s1" ? { ...s, status: "fetched" as const } : s));
    const third = mergeSources(read, [lite("s2")]);
    expect(third.map((s) => s.id)).toEqual(["s2", "s1"]);
    // A card mid-fetch keeps "reading" even if the snapshot says unfetched.
    const reading = first.map((s) => (s.id === "s2" ? { ...s, status: "reading" as const } : s));
    expect(mergeSources(reading, [lite("s2")])[0]?.status).toBe("reading");
  });

  test("local sources are recognised by type or url scheme", () => {
    expect(isLocalSource({ type: "local", url: "local://notes.md" })).toBe(true);
    expect(isLocalSource({ type: "blog", url: "local://x.pdf" })).toBe(true);
    expect(isLocalSource({ type: "blog", url: "https://a.b" })).toBe(false);
  });
});

describe("formatting", () => {
  test("cost: local → 'local', unknown price → 'unknown', else dollars", () => {
    expect(fmtCost(0, true)).toBe("local");
    expect(fmtCost(null, false)).toBe("unknown");
    expect(fmtCost(0.0123, false)).toBe("$0.01");
    expect(fmtCost(0.0042, false)).toBe("$0.0042");
    expect(fmtCost(0, false)).toBe("$0.00");
    expect(fmtCost(1.5, false)).toBe("$1.50");
  });

  test("tokens/duration", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(7121)).toBe("7.1k");
    expect(fmtTokens(48_200)).toBe("48k");
    expect(fmtTokens(1_260_000)).toBe("1.3M");
    expect(fmtDuration(42_000)).toBe("42s");
    expect(fmtDuration(125_000)).toBe("2m 5s");
    expect(fmtDuration(180_000)).toBe("3m");
  });

  test("stats line is engine numbers only", () => {
    const line = statsLine({
      durationMs: 61_000,
      totalTokens: 7121,
      inTokens: 4585,
      outTokens: 2536,
      cost: null,
      local: false,
      sourceCount: 7,
      citedCount: 4,
      fetchedCount: 5,
      provider: "openai",
      model: "gpt-x",
    });
    expect(line).toBe("7 sources • 1m 1s • 7.1k tokens • unknown");
    expect(statsLine({ durationMs: 5000, totalTokens: 10, inTokens: 5, outTokens: 5, cost: 0, local: true, sourceCount: 1, citedCount: 1, fetchedCount: 1, provider: "ollama", model: "m" })).toBe("1 source • 5s • 10 tokens • local");
  });

  test("slug + workspace path are sandbox-safe", () => {
    expect(slugify("  Rust async: tokio vs thread-per-core?! ")).toBe("rust-async-tokio-vs-thread-per-core");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    const p = workspaceReportPath("Hello world", Date.UTC(2026, 9, 7));
    expect(p).toBe("research/hello-world-2026-10-07.md");
    expect(p).not.toContain("..");
  });

  test("follow-ups prefer engine open questions, fall back to defaults", () => {
    const qs = ["How does tokio schedule tasks?", "What does glommio trade away?", "Where does io_uring fit?", "Which runtime do large APIs pick?", "Is monoio production-ready?"];
    expect(followUps(qs, "topic")).toEqual(qs.slice(0, 4));
    // Too-short/duplicate questions are dropped and topped up with defaults.
    const mixed = followUps(["short?", "How does tokio schedule tasks?", "How does tokio schedule tasks?"], "tokio");
    expect(mixed[0]).toBe("How does tokio schedule tasks?");
    expect(mixed).toHaveLength(4);
    expect(new Set(mixed).size).toBe(4);
    const defaults = followUps([], "Rust async");
    expect(defaults).toHaveLength(4);
    expect(defaults.every((q) => q.includes("Rust async"))).toBe(true);
  });
});

describe("export", () => {
  test("markdown export carries title, numbered sources and honest cost", () => {
    const md = exportMarkdown({
      topic: "Topic",
      report: "Body [s1] text [s2].",
      sources: [sourceFromLite(lite("s1"), 0), sourceFromLite(lite("s2"), 1)],
      index: citationIndex("Body [s1] text [s2]."),
      contradictions: [],
      stats: null,
      depth: "standard",
      generatedAt: Date.UTC(2026, 9, 7, 12, 0, 0),
    });
    expect(md.startsWith('---\ntitle: "Topic"\n')).toBe(true);
    expect(md).toContain("generated: 2026-10-07T12:00:00.000Z");
    expect(md).toContain("Body [1] text [2].");
    expect(md).toContain("depth: standard");
    expect(md).toContain("1. Title s1 — https://s1.example.org/post");
    expect(md).toContain("2. Title s2 — https://s2.example.org/post");
    expect(md).not.toMatch(/\$\d/);
  });

  test("contradictions and local files export with reader numbers", () => {
    const local = sourceFromLite(lite("s3", { url: "local://notes.md", domain: "local-file", type: "local", title: "notes.md", fetched: true }), 2);
    const index = citationIndex("A [s1] B [s3].");
    const md = exportMarkdown({
      topic: "T",
      report: "A [s1] B [s3].",
      sources: [sourceFromLite(lite("s1"), 0), local],
      index,
      contradictions: [{ id: "c1", topic: "x", sourceIds: ["s1", "s3"], evidenceIds: [], description: "s3 reports faster; s1 measures no difference.", severity: "medium" }],
      stats: { durationMs: 1000, totalTokens: 10, inTokens: 5, outTokens: 5, cost: 0, local: true, sourceCount: 2, citedCount: 2, fetchedCount: 2, provider: "ollama", model: "m" },
      depth: "quick",
      generatedAt: 0,
    });
    expect(md).toContain("- source [2] reports faster; source [1] measures no difference.");
    expect(md).toContain("2. notes.md (local file)");
    expect(md).toContain("cost: local");
  });
});

describe("parseRunEvent", () => {
  test("parses engine JSON frames and ignores junk", () => {
    expect(parseRunEvent('{"type":"status","status":"planning"}')).toEqual({ type: "status", status: "planning" });
    expect(parseRunEvent("[DONE]")).toBeNull();
    expect(parseRunEvent("not json")).toBeNull();
    expect(parseRunEvent('{"noType":true}')).toBeNull();
  });
});
