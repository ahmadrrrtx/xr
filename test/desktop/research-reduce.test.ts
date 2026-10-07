/**
 * Phase 18 · Research run reducer (desktop/src/research/reduce.ts).
 *
 * Replays REAL engine SSE frames captured from `GET /research/run/:id/stream`
 * (fixtures/research/*.jsonl — a finished quick run and a cancelled run) so
 * the UI model is tested against the shapes the engine actually emits, not
 * guessed ones. Negative branches (egress refusals, run_error, budget halt)
 * are synthesised on top of the real frames.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RunEvent, RunResult } from "../../desktop/src/research/core.ts";
import { applyRunEvent, emptyRun, finalizeResult, type RunSlice } from "../../desktop/src/research/reduce.ts";

function load(name: string): RunEvent[] {
  const raw = readFileSync(join(import.meta.dir, "fixtures", "research", `${name}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunEvent);
}

function replay(events: RunEvent[], upTo?: (e: RunEvent) => boolean): RunSlice {
  let s = emptyRun();
  for (const e of events) {
    s = applyRunEvent(s, e, 1_791_355_999_999);
    if (upTo?.(e)) break;
  }
  return s;
}

const QUICK = load("quick-run");
const CANCELLED = load("cancelled-run");
const completed = (events: RunEvent[]): RunResult => {
  const e = events.find((x) => x.type === "run_completed");
  if (!e || e.type !== "run_completed") throw new Error("fixture has no run_completed");
  return e.result;
};

describe("quick run (real frames)", () => {
  test("run_started seeds provider/model/posture and the fetch target", () => {
    const s = replay(QUICK, (e) => e.type === "run_started");
    expect(s.phase).toBe("planning");
    expect(s.provider).toBe("ollama");
    expect(s.model).toBe("qwen2.5:0.5b");
    expect(s.searchAvailable).toBe(true);
    expect(s.publicWeb).toBe(false);
    expect(s.progress.fetchTarget).toBe(5); // DEPTH_BUDGETS.quick.maxFetched
    expect(s.progress.percent).toBeNull(); // indeterminate until sources land
  });

  test("plan → searches → sources snapshot drive the live model", () => {
    const s = replay(QUICK, (e) => e.type === "sources");
    expect(s.plan?.objective).toContain("Rust async runtimes");
    expect(s.plan?.questions.length).toBeGreaterThan(0);
    expect(s.searches.length).toBeGreaterThan(0);
    expect(s.searches.every((x) => x.hits !== null)).toBe(true);
    expect(s.sources.length).toBe(7);
    expect(s.sources.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Local documents arrive already read (no network); web sources are "found".
    expect(s.sources.find((x) => x.id === "s1")).toMatchObject({ domain: "local-file", status: "fetched", type: "local" });
    expect(s.sources.filter((x) => x.id !== "s1").every((x) => x.status === "found")).toBe(true);
    expect(s.progress.sourcesDiscovered).toBe(7);
    expect(s.progress.sourcesFetched).toBe(1);
  });

  test("fetch start/ok/fail flips card status and counts progress", () => {
    const s = replay(QUICK, (e) => e.type === "status" && e.status === "extracting");
    const byId = new Map(s.sources.map((x) => [x.id, x]));
    expect(byId.get("s3")?.status).toBe("failed");
    expect(byId.get("s3")?.fetchError).toBe("fetch failed (status 503)");
    // quick budget reads 5: the local file + 4 web pages; s7 is never attempted.
    expect(s.sources.filter((x) => x.status === "fetched").length).toBe(5);
    expect(s.progress.sourcesFetched).toBe(5);
    expect(byId.get("s7")?.status).toBe("found");
    expect(s.progress.sourcesFailed).toBe(1);
    expect(s.phase).toBe("reading");
    expect(s.progress.percent).not.toBeNull();
    // A plain 503 is neither an egress refusal nor an SSRF block.
    expect(s.egressRefusals).toBe(0);
    expect(s.ssrfBlocks).toBe(0);
  });

  test("status frames map onto UI phases in order", () => {
    const seen: string[] = [];
    let s = emptyRun();
    for (const e of QUICK) {
      s = applyRunEvent(s, e);
      if (e.type === "status") seen.push(s.phase);
    }
    // `status: done` alone does not settle the run — run_completed (which
    // carries the result) does, so the last status frame still reads synthesizing.
    expect(seen).toEqual(["planning", "searching", "searching", "reading", "reading", "synthesizing", "synthesizing", "synthesizing"]);
    expect(s.phase).toBe("done");
  });

  test("run_completed settles report, citations, stats from the engine result", () => {
    const s = replay(QUICK);
    expect(s.phase).toBe("done");
    expect(s.error).toBeNull();
    expect(s.partialReason).toBeNull();
    expect(s.report?.startsWith("# Rust async runtimes")).toBe(true);
    expect(s.citations.order).toEqual(["s1", "s2", "s3", "s4"]);
    expect(s.sources.filter((x) => x.cited).map((x) => x.id).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(s.contradictions.length).toBe(1);
    expect(s.contradictions[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(s.openQuestions.length).toBe(4);
    expect(s.followUps).toEqual(s.openQuestions);
    // Stats are the engine's numbers — nothing invented.
    expect(s.stats).toMatchObject({ inTokens: 4585, outTokens: 2536, totalTokens: 7121, local: true, cost: 0, sourceCount: 7, citedCount: 4, fetchedCount: 5, provider: "ollama", model: "qwen2.5:0.5b" });
    expect(s.stats?.durationMs).toBeGreaterThan(0);
    expect(s.progress.percent).toBe(100);
    expect(s.log.length).toBeGreaterThan(10);
    // s3 failed before the final list — the final list is authoritative but
    // keeps the failure visible.
    expect(s.sources.find((x) => x.id === "s3")?.status).toBe("failed");
    expect(s.sources.find((x) => x.id === "s3")?.cited).toBe(true); // cited from its snippet
  });

  test("evidence from run_completed lands on the cards", () => {
    const s = replay(QUICK);
    const withEvidence = s.sources.filter((x) => x.evidence.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    expect(withEvidence.every((x) => x.evidence.length <= 5)).toBe(true);
  });

  test("stream_end and unknown frames are no-ops", () => {
    const s = replay(QUICK);
    expect(applyRunEvent(s, { type: "stream_end" } as RunEvent)).toBe(s);
    expect(applyRunEvent(s, { type: "whatever" } as unknown as RunEvent)).toBe(s);
  });
});

describe("cancelled run (real frames)", () => {
  test("status stopped + run_completed(stopReason cancelled) → cancelled, no error", () => {
    const s = replay(CANCELLED);
    expect(s.phase).toBe("cancelled");
    expect(s.stopReason).toBe("cancelled");
    expect(s.report).toBeNull();
    expect(s.error).toBeNull();
    expect(s.partialReason).toBeNull();
    expect(s.citations.order).toEqual([]);
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.stats?.local).toBe(true);
  });

  test("a terminal status frame alone does not settle the phase (run_completed does)", () => {
    const s = replay(CANCELLED, (e) => e.type === "status" && e.status === "stopped");
    expect(s.engineStatus).toBe("stopped");
    expect(["searching", "reading", "synthesizing", "planning"]).toContain(s.phase);
  });
});

describe("synthesised negatives on top of real frames", () => {
  const EGRESS = "blocked by egress allow-list (rerun with --allow-public-web to fetch public web pages)";

  test("egress refusals on every fetch → error card with the Shield path", () => {
    const base = replay(QUICK, (e) => e.type === "sources");
    let s: RunSlice = { ...base, publicWeb: false };
    for (const src of s.sources) {
      s = applyRunEvent(s, { type: "fetch", sourceId: src.id, phase: "start" } as RunEvent);
      s = applyRunEvent(s, { type: "fetch", sourceId: src.id, phase: "fail", error: EGRESS } as RunEvent);
    }
    expect(s.egressRefusals).toBe(7);
    expect(s.sources.every((x) => x.status === "failed")).toBe(true);
    const result: RunResult = {
      ...completed(QUICK),
      report: "# Topic\n\nSnippet-only fallback [s1].",
      sources: completed(QUICK).sources.map((x) => ({ ...x, fetched: false, fetchError: EGRESS })),
    };
    const done = finalizeResult(s, result);
    expect(done.phase).toBe("error");
    expect(done.error?.egressBlocked).toBe(true);
    expect(done.error?.code).toBe("egress_blocked");
    expect(done.error?.message).toContain("could not read any");
    // The snippet-only fallback is not presented as a report.
    expect(done.report).toBeNull();
    expect(done.citations.order).toEqual([]);
    expect(done.sources.some((x) => x.cited)).toBe(false);
    expect(done.followUps).toEqual([]);
    expect(done.stats?.citedCount).toBe(0);
  });

  test("search unavailable (host not allow-listed) + no sources → honest message", () => {
    let s = applyRunEvent(emptyRun(), { ...QUICK[0], searchAvailable: false } as RunEvent);
    s = applyRunEvent(s, { type: "search", query: "q", phase: "done", hits: 0, unavailableReason: "search host not allow-listed" } as RunEvent);
    expect(s.searches[0]?.unavailableReason).toBe("search host not allow-listed");
    const done = finalizeResult(s, { ...completed(QUICK), report: "", sources: [], evidence: {} });
    expect(done.phase).toBe("error");
    expect(done.error?.message).toContain("search host is not in the engine egress allow-list");
    expect(done.error?.egressBlocked).toBe(true);
  });

  test("SSRF-blocked fetch is logged, not surfaced as egress", () => {
    const base = replay(QUICK, (e) => e.type === "sources");
    const id = base.sources[0]!.id;
    const s = applyRunEvent(base, { type: "fetch", sourceId: id, phase: "fail", error: "blocked: private address (SSRF guard)" } as RunEvent);
    expect(s.ssrfBlocks).toBe(1);
    expect(s.egressRefusals).toBe(0);
    expect(s.log.at(-1)).toContain("SSRF");
  });

  test("budget halt → partial with the budget banner", () => {
    const base = replay(QUICK, (e) => e.type === "status" && e.status === "synthesizing");
    const halted = applyRunEvent(base, { type: "budget", meter: { tokens: 9000 }, reason: "token budget reached" } as RunEvent);
    expect(halted.log.at(-1)).toContain("token budget reached");
    const done = finalizeResult(halted, { ...completed(QUICK), status: "stopped", stopReason: "budget: token cap" });
    expect(done.phase).toBe("partial");
    expect(done.partialReason).toBe("Budget reached — showing partial results");
    expect(done.report).not.toBeNull();
  });

  test("other early stops name the engine's reason", () => {
    const done = finalizeResult(replay(QUICK, (e) => e.type === "sources"), { ...completed(QUICK), status: "stopped", stopReason: "provider timeout" });
    expect(done.phase).toBe("partial");
    expect(done.partialReason).toBe("Stopped early — provider timeout");
  });

  test("run_error → error phase with the engine's message", () => {
    const s = applyRunEvent(replay(QUICK, (e) => e.type === "plan"), { type: "run_error", code: "provider_down", message: "ollama: connection refused" } as RunEvent);
    expect(s.phase).toBe("error");
    expect(s.error).toEqual({ message: "ollama: connection refused", code: "provider_down", egressBlocked: false });
    expect(s.endedAt).not.toBeNull();
  });

  test("unknown model price → cost null, never 0", () => {
    const r = completed(QUICK);
    const done = finalizeResult(replay(QUICK, (e) => e.type === "sources"), { ...r, usage: { inTokens: 10, outTokens: 5, usd: null, local: false } });
    expect(done.stats?.cost).toBeNull();
    expect(done.stats?.local).toBe(false);
  });

  test("log is capped", () => {
    let s = emptyRun();
    for (let i = 0; i < 1000; i++) s = applyRunEvent(s, { type: "log", line: `line ${i}` } as RunEvent);
    expect(s.log.length).toBeLessThanOrEqual(400);
    expect(s.log.at(-1)).toBe("line 999");
  });
});
