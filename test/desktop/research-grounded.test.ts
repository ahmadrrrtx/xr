/**
 * UI-redesign 2026-10-29 — the Research dock chat's grounding contract.
 *
 * groundedDigestFrom must build its digest ONLY from real run state, cited
 * sources first in citation order; groundedContextText must produce a
 * bounded, quotable context block that instructs the model to answer from
 * the run and admit gaps instead of padding with outside knowledge. If these
 * invariants break, the dock silently becomes an ungrounded chat — the one
 * thing it must never be.
 */
import { describe, expect, test } from "bun:test";

import { groundedContextText, groundedDigestFrom, researchSessionId } from "../../desktop/src/research/grounded.ts";
import { emptyRun } from "../../desktop/src/research/reduce.ts";
import type { ResearchState } from "../../desktop/src/stores/researchStore.ts";
import type { Contradiction, UiSource } from "../../desktop/src/research/core.ts";

function src(id: string, domain: string, over: Partial<UiSource> = {}): UiSource {
  return {
    id,
    seq: 1,
    url: `https://${domain}/x`,
    domain,
    title: `${domain} page`,
    snippet: null,
    type: "docs",
    status: "fetched",
    trust: 0.7,
    relevance: 0.8,
    freshness: "unknown",
    cited: false,
    contentChars: 4000,
    evidence: [],
    fetchError: null,
    ...over,
  } as UiSource;
}

function state(over: Partial<ResearchState> = {}): ResearchState {
  return {
    ...emptyRun(),
    query: "",
    depth: "standard",
    filters: { web: true, arxiv: true, local: true, connected: true },
    pdfs: [],
    jobId: null,
    announce: null,
    runTopic: "quantum error correction",
    runDepth: "standard",
    sourcesCollapsed: false,
    activeSourceId: null,
    focusNonce: 0,
    voiceFollow: null,
    recent: [],
    recentLoading: false,
    searchAvailable: null,
    publicWeb: null,
    ...over,
  } as unknown as ResearchState;
}

describe("researchSessionId", () => {
  test("stable per run, 'adhoc' without one", () => {
    expect(researchSessionId("r_abc")).toBe("research:r_abc");
    expect(researchSessionId(null)).toBe("research:adhoc");
  });
});

describe("groundedDigestFrom", () => {
  test("cited sources come first, in citation order, with their numbers", () => {
    const s = state({
      report: "A [s2] and b [s1].",
      citations: { order: ["s2", "s1"], numberFor: { s2: 1, s1: 2 } },
      sources: [src("s1", "a.example"), src("s2", "b.example"), src("s3", "c.example")],
    });
    const d = groundedDigestFrom(s);
    expect(d.sources.map((x) => x.id)).toEqual(["s2", "s1", "s3"]);
    expect(d.sources[0]!.n).toBe(1);
    expect(d.sources[1]!.n).toBe(2);
  });

  test("uncited read sources are included without a display number; failed ones dropped", () => {
    const s = state({
      citations: { order: [], numberFor: {} },
      sources: [src("s1", "ok.example"), src("s2", "bad.example", { status: "failed" })],
    });
    const d = groundedDigestFrom(s);
    expect(d.sources.map((x) => x.id)).toEqual(["s1"]);
    expect(d.sources[0]!.n).toBe(0);
  });

  test("evidence, contradictions and open questions carry through, bounded", () => {
    const contradictions: Contradiction[] = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      topic: `t${i}`,
      sourceIds: [],
      evidenceIds: [],
      description: `d${i}`,
      severity: "low",
    }));
    const s = state({
      openQuestions: Array.from({ length: 20 }, (_, i) => `q${i}`),
      contradictions,
      sources: [src("s1", "e.example", { evidence: ["line one", "line two", "line three"] })],
      shortAnswer: "yes",
    });
    const d = groundedDigestFrom(s);
    expect(d.sources[0]!.evidence).toEqual(["line one", "line two"]);
    expect(d.contradictions).toHaveLength(4);
    expect(d.openQuestions).toHaveLength(6);
    expect(d.shortAnswer).toBe("yes");
  });

  test("report excerpt is capped", () => {
    const s = state({ report: "x".repeat(10_000) });
    const d = groundedDigestFrom(s);
    expect(d.reportExcerpt.length).toBe(4000);
  });
});

describe("groundedContextText", () => {
  test("instructs the model to answer only from the run and to admit gaps", () => {
    const ctx = groundedContextText(
      groundedDigestFrom(state({ report: "R [s1].", sources: [src("s1", "a.example", { evidence: ["quote"] })], citations: { order: ["s1"], numberFor: { s1: 1 } } })),
    );
    expect(ctx).toContain("ONLY from the run material");
    expect(ctx).toContain("do not substitute outside knowledge");
    expect(ctx).toContain("quantum error correction");
    expect(ctx).toContain("a.example");
    expect(ctx).toContain("quote");
    expect(ctx).toContain("[s1]");
  });

  test("empty run: still well-formed, no fabricated sections", () => {
    const ctx = groundedContextText(groundedDigestFrom(state()));
    expect(ctx).toContain("Research topic: quantum error correction");
    expect(ctx).not.toContain("Sources (");
    expect(ctx).not.toContain("Contradictions");
    expect(ctx).not.toContain("Open questions");
  });

  test("hard cap on total context size", () => {
    const s = state({
      report: "y".repeat(50_000),
      sources: Array.from({ length: 30 }, (_, i) => src(`s${i}`, `d${i}.example`, { evidence: ["e".repeat(300)] })),
      citations: { order: Array.from({ length: 30 }, (_, i) => `s${i}`), numberFor: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, i + 1])) },
    });
    expect(groundedContextText(groundedDigestFrom(s)).length).toBeLessThanOrEqual(12_000);
  });
});
