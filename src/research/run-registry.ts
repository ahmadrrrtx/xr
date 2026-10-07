/**
 * XR Phase 18 — in-memory registry of full research runs (`runResearch()`).
 *
 * One run per id: an AbortController (the cancel), a bounded event ring the
 * SSE route replays from, and the result once the engine returns. Sessions
 * themselves are persisted by the engine through the ONE workspace store
 * (`research_sessions`); this registry only holds what a live stream needs.
 * Finished runs are kept for an hour so a reconnecting client can still read
 * the completion frame, then dropped.
 */

import { randomUUID } from "node:crypto";
import type { EngineRunEvent, ResearchRunEvent, RunResult } from "./run-events.ts";

export type RunState = "queued" | "running" | "done" | "stopped" | "cancelled" | "error";

export interface ResearchRun {
  id: string;
  state: RunState;
  topic: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  result: RunResult | null;
  error: { code: string; message: string } | null;
  /** Cancel asked for; the engine confirms with `run_completed` (stopped · cancelled). */
  cancelRequested: boolean;
}

const RING = 2000;
const KEEP_FINISHED_MS = 60 * 60 * 1000;
const MAX_CONCURRENT = 2;

export class ResearchRunRegistry {
  private readonly runs = new Map<string, ResearchRun>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly events = new Map<string, ResearchRunEvent[]>();
  private readonly listeners = new Map<string, Set<(e: ResearchRunEvent) => void>>();

  /** Runs currently executing (for the concurrency cap). */
  active(): number {
    return [...this.runs.values()].filter((r) => r.state === "queued" || r.state === "running").length;
  }

  canStart(): boolean {
    return this.active() < MAX_CONCURRENT;
  }

  create(topic: string): { run: ResearchRun; signal: AbortSignal } {
    this.sweep();
    const id = `rr_${randomUUID().slice(0, 10)}`;
    const now = Date.now();
    const run: ResearchRun = { id, state: "queued", topic, sessionId: null, createdAt: now, updatedAt: now, result: null, error: null, cancelRequested: false };
    const controller = new AbortController();
    this.runs.set(id, run);
    this.controllers.set(id, controller);
    this.events.set(id, []);
    return { run, signal: controller.signal };
  }

  get(id: string): ResearchRun | undefined {
    return this.runs.get(id);
  }

  list(): ResearchRun[] {
    return [...this.runs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Stamp + buffer + fan out one event. */
  emit(id: string, event: EngineRunEvent): void {
    const run = this.runs.get(id);
    if (!run) return;
    const stamped = { ...event, runId: id, at: Date.now() } as ResearchRunEvent;
    if (stamped.type === "run_started") {
      run.sessionId = stamped.sessionId;
      run.state = "running";
    }
    if (stamped.type === "run_completed") {
      run.result = stamped.result;
      run.state = stamped.result.status === "done" ? "done" : stamped.result.stopReason === "cancelled" ? "cancelled" : "stopped";
    }
    if (stamped.type === "run_error") {
      run.error = { code: stamped.code, message: stamped.message };
      run.state = "error";
    }
    run.updatedAt = Date.now();
    const ring = this.events.get(id);
    if (ring) {
      ring.push(stamped);
      if (ring.length > RING) ring.splice(0, ring.length - RING);
    }
    for (const fn of this.listeners.get(id) ?? []) {
      try {
        fn(stamped);
      } catch {
        /* one broken subscriber never breaks the run */
      }
    }
    if (this.isTerminal(id)) this.controllers.delete(id);
  }

  /** Snapshot of buffered events (for SSE replay on connect). */
  replay(id: string): ResearchRunEvent[] {
    return [...(this.events.get(id) ?? [])];
  }

  subscribe(id: string, fn: (e: ResearchRunEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn);
    this.listeners.set(id, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  isTerminal(id: string): boolean {
    const run = this.runs.get(id);
    if (!run) return true;
    return run.state === "done" || run.state === "stopped" || run.state === "cancelled" || run.state === "error";
  }

  cancel(id: string): { ok: true } | { ok: false; reason: string } {
    const run = this.runs.get(id);
    if (!run) return { ok: false, reason: "run not found" };
    if (this.isTerminal(id)) return { ok: false, reason: `run already ${run.state}` };
    if (run.cancelRequested) return { ok: true };
    run.cancelRequested = true;
    run.updatedAt = Date.now();
    this.controllers.get(id)?.abort(); // reaches the model + fetch sockets; the engine answers with run_completed
    return { ok: true };
  }

  /** Drop finished runs older than KEEP_FINISHED_MS. */
  sweep(now = Date.now()): void {
    for (const [id, run] of this.runs) {
      if (this.isTerminal(id) && now - run.updatedAt > KEEP_FINISHED_MS) {
        this.runs.delete(id);
        this.events.delete(id);
        this.listeners.delete(id);
        this.controllers.delete(id);
      }
    }
  }
}
