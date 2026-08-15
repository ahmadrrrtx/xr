/**
 * XR — lightweight concurrency primitives for daemon workloads.
 *
 * Used to bound plugin tree hashing, embedding generation, and other CPU/IO
 * heavy tasks so the HTTP event loop stays responsive under multi-agent load.
 */

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  get running(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Yield to the event loop so long sync-ish walks never starve HTTP. */
export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/**
 * Bound a promise with a wall-clock deadline (Phase 01).
 *
 * Returns `fallback` when the deadline elapses first. The timer is unref'd so
 * it never keeps the process alive. NOTE: this is a RACE, not cancellation —
 * the underlying operation keeps running until it settles on its own. Callers
 * must pair it with dedup/caching so raced operations are not repeated (see
 * src/providers/health.ts; documented in docs/perf/PERF-BUDGETS.md §Phase 01).
 */
export function bounded<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Bound concurrent plugin tree hash / static scans. */
export const pluginIoLimit = new Semaphore(2);

/** Bound concurrent embedding API calls. */
export const embedLimit = new Semaphore(4);

/** Bound concurrent shield shell probes (ps, powershell, ls). */
export const shieldIoLimit = new Semaphore(3);

/** Bound concurrent OS control actions (mouse/keyboard/clipboard). */
export const controlIoLimit = new Semaphore(2);

/** Bound concurrent voice subprocesses (STT/TTS CLI). */
export const voiceIoLimit = new Semaphore(2);
