/**
 * XR 4.5 — Phase 6 §11.4 compression tests.
 *
 * The defining property: compression FAILS SAFE. If a required evidence
 * invariant cannot be preserved, no summary is produced and the originals are
 * kept. A lossy summary that silently drops a decision is a bug, not a
 * trade-off.
 */
import { describe, test, expect } from "bun:test";
import {
  DEFAULT_REQUIRED_INVARIANTS,
  compressItems,
  compressMessages,
} from "../../src/context/compression.ts";
import {
  CONTEXT_BOUNDS,
  computeFreshness,
  emptyUncertainty,
  type ContextItem,
} from "../../src/context/types.ts";

function mkItem(content: string, over: Partial<ContextItem> = {}): ContextItem {
  const now = Date.now();
  return {
    id: `ctx_${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    type: "task_context",
    content,
    title: content.slice(0, 40),
    scope: { workspaceId: "default", projectScope: "proj", userId: "local" },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "file",
    actorKind: "user",
    freshness: computeFreshness({ createdAt: now, updatedAt: now }, now),
    uncertainty: emptyUncertainty(),
    sensitivity: "unknown",
    retention: "durable",
    links: {},
    indexState: "none",
    tags: [],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    ...over,
  };
}

describe("XR 4.5 compression preserves required evidence", () => {
  test("decisions survive compression verbatim enough to be recognisable", () => {
    const res = compressItems({
      items: [
        mkItem("We decided to use PostgreSQL instead of MySQL for the ledger."),
        mkItem("Routine status ping, nothing notable."),
      ],
      taskIdentity: "database selection",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("PostgreSQL");
    expect(res.preserved).toContain("decisions");
  });

  test("sources are preserved with their references", () => {
    const res = compressItems({
      items: [
        mkItem("Latency figures came from https://example.com/benchmark-2026", {
          provenanceRef: "https://example.com/benchmark-2026",
        }),
      ],
      taskIdentity: "benchmark review",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("example.com/benchmark-2026");
    expect(res.preserved).toContain("sources");
  });

  test("uncertainty hedges are NOT cleaned up into facts", () => {
    const res = compressItems({
      items: [mkItem("The outage was probably caused by the cache layer, but this is unverified.")],
      taskIdentity: "incident review",
    });
    expect(res.ok).toBe(true);
    // The hedge must survive — this is the anti-overconfidence guarantee.
    expect(res.summary!.toLowerCase()).toContain("probably");
    expect(res.preserved).toContain("uncertainty");
  });

  test("unresolved questions survive", () => {
    const res = compressItems({
      items: [
        mkItem("Open question: should we shard by tenant or by region?", {
          uncertainty: {
            ...emptyUncertainty(),
            openQuestions: ["Shard by tenant or region?"],
          },
        }),
      ],
      taskIdentity: "sharding design",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("Shard by tenant or region?");
    expect(res.preserved).toContain("unresolved_questions");
  });

  test("user corrections survive and are labelled", () => {
    const res = compressItems({
      items: [
        mkItem("Correction: the deploy window is Thursday, not Friday.", { supersededBy: null }),
      ],
      taskIdentity: "release planning",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("Thursday");
    expect(res.preserved).toContain("user_corrections");
  });

  test("dates, actors, scope, and task identity are preserved", () => {
    const res = compressItems({
      items: [mkItem("Reviewed by the team on 2026-03-14.", { actorName: "alice" })],
      taskIdentity: "quarterly review",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("quarterly review");
    expect(res.preserved).toContain("dates");
    expect(res.preserved).toContain("actors");
    expect(res.preserved).toContain("permissions_scope");
    expect(res.preserved).toContain("task_identity");
  });

  test("artifact and run references survive", () => {
    const res = compressItems({
      items: [mkItem("Report generated.", { links: { artifactId: "art_42", runId: "run_7" } })],
      taskIdentity: "reporting",
    });
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("art_42");
    expect(res.summary).toContain("run_7");
    expect(res.preserved).toContain("artifact_references");
  });

  test("contradictions are carried into the summary, not resolved away", () => {
    const res = compressItems({
      items: [
        mkItem("Throughput is 900 rps.", {
          id: "a",
          uncertainty: { ...emptyUncertainty(), contradictedBy: ["b"] },
        }),
      ],
      taskIdentity: "capacity planning",
    });
    expect(res.ok).toBe(true);
    expect(res.summary!.toLowerCase()).toContain("contradicted");
  });
});

describe("XR 4.5 compression fails safe", () => {
  test("a budget too small to hold the decisions REFUSES to compress", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      mkItem(`We decided item ${i}: adopt approach ${i} for subsystem ${i} after review.`),
    );
    const res = compressItems({ items, taskIdentity: "architecture decisions", maxChars: 200 });
    expect(res.ok).toBe(false);
    expect(res.summary).toBeUndefined();
    expect(res.lost.length).toBeGreaterThan(0);
    expect(res.reason).toContain("cannot preserve required evidence");
  });

  test("refusing to compress means the caller keeps the originals", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mkItem(`Decision ${i}: we chose option ${i}. Source: https://example.com/doc-${i}`),
    );
    const res = compressItems({ items, taskIdentity: "t", maxChars: 150 });
    expect(res.ok).toBe(false);
    // Source ids are still reported so nothing is orphaned.
    expect(res.sourceItemIds).toHaveLength(20);
  });

  test("re-summarizing past the lineage depth is refused", () => {
    const res = compressItems({
      items: [mkItem("We decided X.")],
      taskIdentity: "t",
      parentGeneration: CONTEXT_BOUNDS.maxSummaryGeneration,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("generation");
  });

  test("compressing nothing is refused, not silently 'successful'", () => {
    const res = compressItems({ items: [], taskIdentity: "t" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("nothing to compress");
  });

  test("lineage metadata is always populated", () => {
    const res = compressItems({
      items: [mkItem("We decided to ship on Tuesday.")],
      taskIdentity: "t",
      parentGeneration: 1,
      lineageParent: "sum_parent",
    });
    expect(res.generation).toBe(2);
    expect(res.lineageParent).toBe("sum_parent");
    expect(res.originalChars).toBeGreaterThan(0);
    expect(res.compressedChars).toBeGreaterThan(0);
  });

  test("the full §9.6 invariant set is required by default", () => {
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("decisions");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("sources");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("uncertainty");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("user_corrections");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("unresolved_questions");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("permissions_scope");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("task_identity");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("artifact_references");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("dates");
    expect(DEFAULT_REQUIRED_INVARIANTS).toContain("actors");
  });
});

describe("XR 4.5 message compaction preserves meaning", () => {
  const long = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Routine exchange number ${i} with some filler text to add length. ${"padding ".repeat(20)}`,
    }));

  test("under budget, messages pass through untouched", () => {
    const msgs = [{ role: "user", content: "hi" }];
    const res = compressMessages(msgs, { maxChars: 10_000 });
    expect(res.compressed).toBe(false);
    expect(res.messages).toEqual(msgs);
  });

  test("a negation is never truncated mid-sentence (the 4.4 bug)", () => {
    const msgs = [
      ...long(30),
      { role: "user", content: "We decided we must NOT deploy to production on Fridays under any circumstances whatsoever." },
      ...long(10),
    ];
    const res = compressMessages(msgs, { maxChars: 4_000, keepRecent: 4 });
    expect(res.compressed).toBe(true);
    const summary = res.messages.find((m) => m.content.includes("evidence-preserving summary"));
    expect(summary).toBeDefined();
    // The whole decision, including the negation, survives.
    expect(summary!.content).toContain("must NOT deploy to production on Fridays");
  });

  test("sources in the conversation survive compaction", () => {
    const msgs = [
      ...long(30),
      { role: "assistant", content: "According to https://example.com/spec the limit is 512." },
      ...long(6),
    ];
    const res = compressMessages(msgs, { maxChars: 4_000, keepRecent: 4 });
    const summary = res.messages.find((m) => m.content.includes("evidence-preserving summary"))!;
    expect(summary.content).toContain("example.com/spec");
    expect(res.preserved).toContain("sources");
  });

  test("recent messages are kept verbatim", () => {
    const msgs = [...long(40), { role: "user", content: "FINAL_VERBATIM_MARKER" }];
    const res = compressMessages(msgs, { maxChars: 3_000, keepRecent: 3 });
    expect(res.messages.some((m) => m.content === "FINAL_VERBATIM_MARKER")).toBe(true);
  });

  test("routine filler is condensed and counted", () => {
    const res = compressMessages(long(60), { maxChars: 3_000, keepRecent: 4 });
    const summary = res.messages.find((m) => m.content.includes("evidence-preserving summary"))!;
    expect(summary.content).toContain("routine statements omitted");
  });

  test("a leading system message is always preserved", () => {
    const msgs = [{ role: "system", content: "SYSTEM_RULES" }, ...long(40)];
    const res = compressMessages(msgs, { maxChars: 3_000, keepRecent: 3 });
    expect(res.messages[0]!.content).toBe("SYSTEM_RULES");
  });

  test("truncated evidence is reported as lost, not hidden", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      role: "user",
      content: `We decided decision number ${i} which is important and must be recorded in full detail here.`,
    }));
    const res = compressMessages(many, { maxChars: 2_000, keepRecent: 2 });
    const summary = res.messages.find((m) => m.content.includes("evidence-preserving summary"))!;
    expect(summary.content).toContain("further significant statements omitted");
    expect(res.lost).toContain("decisions");
  });
});
