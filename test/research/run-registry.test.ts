/**
 * Phase 18 — research run registry: ids, lifecycle, replay buffer, cancel
 * semantics (abort reaches the signal; terminal runs refuse a second cancel),
 * concurrency cap, sweep of stale finished runs.
 */
import { test, expect } from "bun:test";
import { ResearchRunRegistry } from "../../src/research/run-registry.ts";
import type { RunResult } from "../../src/research/run-events.ts";

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: "r_abcdefgh",
    topic: "t",
    depth: "quick",
    mode: "quick",
    status: "done",
    stopReason: undefined,
    report: "# t",
    shortAnswer: null,
    executiveSummary: [],
    openQuestions: [],
    overallConfidence: null,
    sources: [],
    contradictions: [],
    evidence: {},
    meter: null,
    usage: { inTokens: 1, outTokens: 1, usd: 0, local: true },
    provider: "ollama",
    model: "m",
    startedAt: 1,
    endedAt: 2,
    ...over,
  };
}

test("create → queued run with rr_ id, a live signal, and an empty replay buffer", () => {
  const reg = new ResearchRunRegistry();
  const { run, signal } = reg.create("tokio vs smol");
  expect(run.id.startsWith("rr_")).toBe(true);
  expect(run.state).toBe("queued");
  expect(run.sessionId).toBeNull();
  expect(signal.aborted).toBe(false);
  expect(reg.replay(run.id)).toEqual([]);
  expect(reg.get(run.id)?.topic).toBe("tokio vs smol");
});

test("run_started flips to running + records the session id; run_completed sets done/stopped/cancelled truthfully", () => {
  const reg = new ResearchRunRegistry();
  const a = reg.create("a").run;
  reg.emit(a.id, { type: "run_started", sessionId: "r_12345678", topic: "a", depth: "quick", mode: "quick", provider: "ollama", model: "m", publicWeb: false, searchAvailable: true });
  expect(reg.get(a.id)?.state).toBe("running");
  expect(reg.get(a.id)?.sessionId).toBe("r_12345678");
  reg.emit(a.id, { type: "run_completed", result: result() });
  expect(reg.get(a.id)?.state).toBe("done");

  const b = reg.create("b").run;
  reg.emit(b.id, { type: "run_completed", result: result({ status: "stopped", stopReason: "budget" }) });
  expect(reg.get(b.id)?.state).toBe("stopped");

  const c = reg.create("c").run;
  reg.emit(c.id, { type: "run_completed", result: result({ status: "stopped", stopReason: "cancelled" }) });
  expect(reg.get(c.id)?.state).toBe("cancelled");

  const d = reg.create("d").run;
  reg.emit(d.id, { type: "run_error", code: "provider_unreachable", message: "down" });
  expect(reg.get(d.id)?.state).toBe("error");
  expect(reg.get(d.id)?.error).toEqual({ code: "provider_unreachable", message: "down" });
});

test("events are stamped with runId + at, buffered for replay, and fanned out to subscribers", () => {
  const reg = new ResearchRunRegistry();
  const { run } = reg.create("x");
  const seen: string[] = [];
  const off = reg.subscribe(run.id, (e) => seen.push(e.type));
  reg.emit(run.id, { type: "status", status: "planning" });
  reg.emit(run.id, { type: "log", line: "▸ planning…" });
  off();
  reg.emit(run.id, { type: "status", status: "discovering" });
  expect(seen).toEqual(["status", "log"]);
  const replay = reg.replay(run.id);
  expect(replay.map((e) => e.type)).toEqual(["status", "log", "status"]);
  for (const e of replay) {
    expect(e.runId).toBe(run.id);
    expect(typeof (e as { at?: number }).at).toBe("number");
  }
});

test("cancel aborts the signal once; a finished run answers with a truthful refusal", () => {
  const reg = new ResearchRunRegistry();
  const { run, signal } = reg.create("x");
  expect(reg.cancel("rr_nope")).toEqual({ ok: false, reason: "run not found" });
  expect(reg.cancel(run.id)).toEqual({ ok: true });
  expect(signal.aborted).toBe(true);
  expect(reg.get(run.id)?.cancelRequested).toBe(true);
  expect(reg.cancel(run.id)).toEqual({ ok: true }); // idempotent while still running
  reg.emit(run.id, { type: "run_completed", result: result({ status: "stopped", stopReason: "cancelled" }) });
  expect(reg.cancel(run.id)).toEqual({ ok: false, reason: "run already cancelled" });
  expect(reg.isTerminal(run.id)).toBe(true);
});

test("at most two runs execute at once; finished runs free the slot", () => {
  const reg = new ResearchRunRegistry();
  const a = reg.create("a").run;
  reg.create("b");
  expect(reg.active()).toBe(2);
  expect(reg.canStart()).toBe(false);
  reg.emit(a.id, { type: "run_completed", result: result() });
  expect(reg.canStart()).toBe(true);
});

test("sweep drops finished runs older than an hour but keeps live and recent ones", () => {
  const reg = new ResearchRunRegistry();
  const old = reg.create("old").run;
  reg.emit(old.id, { type: "run_completed", result: result() });
  const live = reg.create("live").run;
  reg.sweep(Date.now() + 2 * 60 * 60 * 1000);
  expect(reg.get(old.id)).toBeUndefined();
  expect(reg.replay(old.id)).toEqual([]);
  expect(reg.get(live.id)?.state).toBe("queued");
  expect(reg.list().map((r) => r.id)).toEqual([live.id]);
});
