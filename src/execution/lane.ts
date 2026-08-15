/**
 * XR Phase 03 — Execution Lane Queue (single-writer / deterministic ordering)
 *
 * Problem (OpenClaw-derived principle, Phase 03 · T3.11):
 *   CLI, dashboard, TUI and the HTTP chat API may each submit work against the
 *   SAME workspace/session. Without coordination, Run A and Run B can interleave
 *   their transcript/checkpoint/state writes, corrupting both.
 *
 * This module is the execution-side lane/lease abstraction. It serializes work
 * that shares a key (a workspace id, session id, or any caller-chosen scope) so
 * only ONE task runs at a time for that key, while tasks for DIFFERENT keys run
 * concurrently. It is deliberately generic and L1-pure: it imports nothing from
 * a surface, so `src/execution` never depends on `src/daemon`/`src/cli`
 * (boundary law).
 *
 * Semantics (Phase 03 · T3.11):
 *   · same workspace/session  → serialized (FIFO)
 *   · different sessions      → concurrent (NOT globally serialized)
 *   · queued task wait bounded → after `timeoutMs` it rejects with
 *     `LaneBusyError` (the HTTP edge maps this to a retryable 429).
 *   · queued task cancelled   → rejects with an `AbortError` and is removed
 *     from the queue (no phantom execution).
 *
 * Two access shapes:
 *   · `acquire(key, opts)` → Promise<Release>. Lets a caller reserve the lane
 *     BEFORE returning a response (so a busy lane can be answered with 429
 *     instead of a doomed 200 SSE stream), run its work, then release.
 *   · `runExclusive(key, fn, opts)` → convenience built on `acquire`.
 *
 * This is a process-local single-writer guard. Cross-process lease ownership
 * (crash/restart safety) is the separate concern of `src/execution/lease.ts`
 * (LeaseManager), which this queue composes with at the caller boundary.
 */

/** Default bound for how long a queued task is willing to wait for its lane. */
export const LANE_DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown when a task waits longer than its bound for a busy lane. */
export class LaneBusyError extends Error {
  readonly key: string;
  readonly timeoutMs: number;
  readonly retryable = true;
  constructor(key: string, timeoutMs: number) {
    super(`lane "${key}" is busy; timed out after ${timeoutMs} ms waiting for the execution lane`);
    this.name = "LaneBusyError";
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

export interface LaneOptions {
  /** Max time a queued task waits for its lane before rejecting with LaneBusyError. */
  timeoutMs?: number;
  /** Abort the wait while queued (before execution starts). */
  signal?: AbortSignal;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal | null;
  abortHandler: (() => void) | null;
  started: boolean;
  released: boolean;
}

interface Lane {
  current: Waiter | null;
  queue: Waiter[];
}

/** Release handle returned by `acquire`. Calling it frees the lane. */
export type LaneRelease = () => void;

/**
 * A process-local, key-scoped FIFO serialization queue.
 */
export class ExecutionLaneQueue {
  private readonly lanes = new Map<string, Lane>();

  /** Number of distinct scopes currently tracked (0 when idle). */
  size(): number {
    return this.lanes.size;
  }

  /** True when a task is actively holding the lane for `key`. */
  isActive(key: string): boolean {
    return this.lanes.get(key)?.current != null;
  }

  /** Number of tasks waiting for the lane for `key`. */
  queueDepth(key: string): number {
    return this.lanes.get(key)?.queue.length ?? 0;
  }

  /**
   * Reserve exclusive access to `key`, resolving once the lane is held.
   * Rejects with `LaneBusyError` after `timeoutMs`, or an `AbortError` if
   * `opts.signal` aborts while still queued. The returned release function
   * MUST be called (in a `finally`) when the work is done.
   */
  acquire(key: string, opts: LaneOptions = {}): Promise<LaneRelease> {
    const timeoutMs = opts.timeoutMs ?? LANE_DEFAULT_TIMEOUT_MS;
    const signal = opts.signal ?? null;

    const lane = this.lanes.get(key) ?? { current: null, queue: [] };
    this.lanes.set(key, lane);

    return new Promise<LaneRelease>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: null,
        signal,
        abortHandler: null,
        started: false,
        released: false,
      };

      const abortWhileQueued = (): void => {
        if (waiter.started) return;
        const err = new Error(`lane "${key}" wait aborted before execution started`);
        err.name = "AbortError";
        reject(err);
        this.removeWaiter(lane, waiter);
      };
      if (signal) {
        if (signal.aborted) {
          abortWhileQueued();
          return;
        }
        waiter.abortHandler = abortWhileQueued;
        signal.addEventListener("abort", abortWhileQueued, { once: true });
      }

      const onTimeout = (): void => {
        if (waiter.started) return;
        reject(new LaneBusyError(key, timeoutMs));
        this.removeWaiter(lane, waiter);
      };
      waiter.timer = setTimeout(onTimeout, timeoutMs);

      lane.queue.push(waiter);
      if (!lane.current) this.startNext(lane, key);
    });
  }

  /**
   * Acquire the lane, run `fn` while holding it, then release. Equivalent to
   * `acquire`/`release` with a guaranteed release in `finally`.
   */
  runExclusive<T>(key: string, fn: () => Promise<T>, opts: LaneOptions = {}): Promise<T> {
    return this.acquire(key, opts).then((release) => {
      return Promise.resolve()
        .then(() => fn())
        .then(
          (v) => {
            release();
            return v;
          },
          (e) => {
            release();
            throw e;
          },
        );
    });
  }

  private startNext(lane: Lane, key: string): void {
    const waiter = lane.queue.shift();
    if (!waiter) {
      lane.current = null;
      // Bounded memory: drop idle lanes once empty.
      if (this.lanes.get(key) === lane) this.lanes.delete(key);
      return;
    }
    lane.current = waiter;
    waiter.started = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.abortHandler && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.abortHandler);
      waiter.abortHandler = null;
    }
    waiter.resolve(() => this.release(lane, key));
  }

  private release(lane: Lane, key: string): void {
    if (lane.current) {
      lane.current.released = true;
      lane.current = null;
    }
    this.startNext(lane, key);
  }

  private removeWaiter(lane: Lane, waiter: Waiter): void {
    const i = lane.queue.indexOf(waiter);
    if (i >= 0) lane.queue.splice(i, 1);
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.abortHandler && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.abortHandler);
      waiter.abortHandler = null;
    }
  }
}
