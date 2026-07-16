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
