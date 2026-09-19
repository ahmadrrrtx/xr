/**
 * XR — ONE polling hub for the whole shell.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (Phase 1 · performance + a correctness bug)
 * ─────────────────────────────────────────────────────────────────────────────
 * Before this module, five independent components each owned their own
 * `setInterval` and fetched the engine on their own schedule:
 *
 *   main.tsx        health                          every 4 s
 *   AppShell        health, providers, pending      every 5 s
 *   AppShell        pending, agents                 every 10 s (notifications)
 *   ToastBus        approvals, sessions             every 3 s
 *   Home            sessions, approvals             every 4 s
 *
 * Two consequences, one of them not merely wasteful:
 *
 *  1. COST. `providers`, `pending` and `sessions` were each fetched TWICE per
 *     cycle at different cadences, and nothing paused while the window was
 *     minimised — a desktop app that keeps hammering its own daemon while it is
 *     not even visible.
 *
 *  2. INCONSISTENCY (the real defect). Independent snapshots taken seconds
 *     apart can disagree. The statusbar could show a healthy provider while
 *     Home showed the old one; a run could be announced as complete by the
 *     toast bus before any screen reflected it. Every consumer of the same fact
 *     was looking at a different observation of it.
 *
 * The hub restores a single observation point: one scheduler, one in-flight
 * request per key, one fan-out per result. Every subscriber of a key sees the
 * SAME value from the SAME fetch, so screens cannot disagree about the same
 * moment in time.
 *
 * Design notes
 *  · Cadence is per key (see CADENCES) — health is cheap and drives the link
 *    indicator, providers are slow-moving. One 1 s scheduler tick decides which
 *    keys are due, instead of five timers racing.
 *  · FAILURE BACKS OFF (bounded ×4) so a stopped engine is not polled at full
 *    rate forever; a success resets it. Recovery is still fast because the
 *    fastest key (health) only ever backs off 2×.
 *  · HIDDEN WINDOWS DO NOT POLL. Ticks are skipped while `document.hidden`, and
 *    returning to the window immediately refreshes anything stale — this is the
 *    desktop-native behaviour a browser-shaped app gets wrong.
 *  · Nothing is invented: on error, subscribers receive the error and decide
 *    what honest state to show (the statusbar shows WHY the link is down).
 *  · No backend change: the plan called for one `/overview` snapshot endpoint,
 *    which would be new engine surface. Phase 1 explicitly does not touch the
 *    backend, so the same guarantee (one consistent snapshot, far fewer
 *    requests) is delivered client-side. If `/overview` lands later, the
 *    LOADERS table is the single place to point keys at it.
 */
import {
  api,
  type Approval,
  type ProviderInfo,
  type SessionSummary,
  type WorkflowSummary,
} from "./api/client";

export type PollKey = "health" | "providers" | "pending" | "approvals" | "sessions" | "agents";

/**
 * What each key resolves to — the engine's own response types, so a subscriber
 * gets real types instead of `unknown` and cannot invent a field.
 */
export interface PollPayloads {
  health: Record<string, unknown>;
  providers: ProviderInfo[] | { providers: ProviderInfo[]; active?: string };
  pending: { pending?: Approval[] };
  approvals: Approval[] | { pending: Approval[]; approvals?: Approval[] };
  sessions: SessionSummary[] | { sessions: SessionSummary[] };
  agents: { roles?: Record<string, unknown>[]; workflows?: WorkflowSummary[]; health?: Record<string, unknown> };
}

/** Per-key cadence. Ordered by how fast the fact moves, not by convenience. */
export const CADENCES: Record<PollKey, number> = {
  health: 4_000, // drives the link dot — must be first to notice a dead engine
  pending: 5_000, // approvals waiting on a human
  approvals: 5_000,
  sessions: 5_000,
  agents: 10_000, // run transitions (toast bus)
  providers: 30_000, // provider/model health changes on the scale of minutes
};

const LOADERS: { [K in PollKey]: () => Promise<PollPayloads[K]> } = {
  health: () => api.health(),
  providers: () => api.providers(),
  pending: () => api.controlPending(),
  approvals: () => api.approvals(),
  sessions: () => api.sessions(),
  agents: () => api.agents(),
};

/** Failures are not retried at full rate; this bounds the multiplier. */
const MAX_BACKOFF = 4;
const TICK_MS = 1_000;

export type PollOutcome<K extends PollKey = PollKey> =
  | { ok: true; key: K; value: PollPayloads[K]; at: number }
  | { ok: false; key: K; error: unknown; at: number };

/**
 * Distribute over a union of keys, so `subscribe(["a","b"], cb)` hands back a
 * plain discriminated union that TypeScript narrows on `o.key` — the callback
 * cannot read `sessions` off a `providers` result.
 */
export type PollOutcomes<K extends PollKey> = K extends unknown ? PollOutcome<K> : never;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

type Subscriber = (outcome: PollOutcome) => void;

export class Poller {
  private readonly subs = new Map<PollKey, Set<Subscriber>>();
  private readonly lastRun = new Map<PollKey, number>();
  private readonly failures = new Map<PollKey, number>();
  private readonly inflight = new Set<PollKey>();
  private handle: unknown = null;
  /** Test/telemetry counters — how many fetches the hub has actually issued. */
  public fetches = 0;

  constructor(
    private readonly loaders: { [K in PollKey]: () => Promise<PollPayloads[K]> } = LOADERS,
    private readonly cadences: Record<PollKey, number> = CADENCES,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  /** Subscribe to keys. The callback fires only for results the hub fetched. */
  subscribe<K extends PollKey>(keys: K[], cb: (outcome: PollOutcomes<K>) => void): () => void {
    for (const k of keys) {
      if (!this.subs.has(k)) this.subs.set(k, new Set());
      this.subs.get(k)!.add(cb as Subscriber);
      if (!this.lastRun.has(k)) this.lastRun.set(k, -Infinity); // due immediately
    }
    this.ensureRunning();
    return () => {
      for (const k of keys) {
        this.subs.get(k)?.delete(cb as Subscriber);
        if (this.subs.get(k)?.size === 0) this.subs.delete(k);
      }
      if (this.subs.size === 0) this.stop();
    };
  }

  /** Force an immediate fetch (palette "Refresh engine data", window re-focus). */
  refresh(keys?: PollKey[]): void {
    const targets = keys ?? (Array.from(this.subs.keys()) as PollKey[]);
    for (const k of targets) this.run(k);
  }

  /** Fetch every key whose value is older than its cadence. */
  refreshStale(): void {
    const now = this.timers.now();
    for (const k of this.subs.keys()) {
      if (now - (this.lastRun.get(k) ?? -Infinity) >= this.effectiveCadence(k)) this.run(k);
    }
  }

  /** Bounded backoff — a dead engine is not polled at full rate. */
  private effectiveCadence(key: PollKey): number {
    const fails = this.failures.get(key) ?? 0;
    return this.cadences[key] * Math.min(1 + fails, MAX_BACKOFF); // ×1 … ×4
  }

  private run(key: PollKey): void {
    if (this.inflight.has(key)) return; // one request per key, ever
    this.inflight.add(key);
    this.fetches += 1;
    const at = this.timers.now();
    this.lastRun.set(key, at);
    this.loaders[key]()
      .then((value) => this.fanOut({ ok: true, key, value, at: this.timers.now() }))
      .catch((error) => {
        this.failures.set(key, Math.min((this.failures.get(key) ?? 0) + 1, MAX_BACKOFF - 1));
        this.fanOut({ ok: false, key, error, at: this.timers.now() });
      })
      .finally(() => this.inflight.delete(key));
  }

  private fanOut(outcome: PollOutcome): void {
    if (outcome.ok) this.failures.set(outcome.key, 0);
    for (const cb of this.subs.get(outcome.key) ?? []) cb(outcome);
  }

  private ensureRunning(): void {
    if (this.handle !== null) return;
    const tick = () => {
      this.handle = null;
      // A hidden window has nothing to render; skip the work entirely and
      // re-check when it comes back (see wake()).
      if (!isHidden()) this.refreshStale();
      if (this.subs.size > 0) this.handle = this.timers.setTimeout(tick, TICK_MS);
    };
    this.handle = this.timers.setTimeout(tick, TICK_MS);
  }

  private stop(): void {
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /** A window that just became visible may have missed many ticks. */
  wake(): void {
    this.refreshStale();
  }

  /** Introspection for tests and the status-bar debug surface. */
  stats(): { keys: PollKey[]; inflight: number; fetches: number } {
    return { keys: Array.from(this.subs.keys()), inflight: this.inflight.size, fetches: this.fetches };
  }
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** The app-wide hub. One instance, one scheduler, every screen. */
export const poll = new Poller();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!isHidden()) poll.wake();
  });
}
