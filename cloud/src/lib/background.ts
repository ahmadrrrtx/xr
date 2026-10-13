/**
 * XR Cloud — background work queue.
 *
 * ## The bug this exists to prevent
 *
 * Fire-and-forget promises look harmless and are not. Two concrete failures they
 * caused during this phase's own development:
 *
 *   1. **Writes surviving their database.** A detached audit append was still
 *      in flight when `shutdown()` closed the connection. On Postgres that is a
 *      logged error; on PGlite it is a WASM-level abort that takes the process
 *      with it, and either way an audit row is lost with nobody told.
 *   2. **Two appends overlapping.** The audit chain serializes on the org row,
 *      which is correct across processes, but each append also opens a
 *      transaction. Two independent detached transactions racing is exactly the
 *      shape that produces an interleaved chain under a single-connection driver.
 *
 * So detached work is **queued and serialized** rather than merely detached, the
 * queue knows its depth, and shutdown drains it before the database closes.
 *
 * ## What this is not
 *
 * It is not durable. A hard crash still loses queued work. Nothing that must not
 * be lost belongs here — and nothing that must not be lost is: entitlement,
 * billing and policy writes all happen inside the request that causes them. The
 * only thing queued today is *read-access* audit rows, where a loss is a
 * log line and not an inconsistency (Constitution Art. XX — tests assert effects,
 * and the effect that matters is already committed by the time this runs).
 */

import type { Logger } from "./logger.ts";

export interface BackgroundQueue {
  /** Queue work. Never rejects; a failure is logged and counted. */
  enqueue(label: string, work: () => Promise<void>): void;
  readonly pending: number;
  readonly failures: number;
  /**
   * Wait for every queued item to settle. Bounded, because a shutdown that can
   * hang forever is worse than a shutdown that drops a read-access row.
   */
  drain(timeoutMs?: number): Promise<{ drained: number; remaining: number }>;
  /** Refuse new work. Called at the start of shutdown. */
  close(): void;
}

export function createBackgroundQueue(log: Logger): BackgroundQueue {
  let closed = false;
  let pending = 0;
  let failures = 0;

  // One chain per queue: serialization, not concurrency. Depth is reported so an
  // operator can see a queue that is not keeping up.
  let chain: Promise<void> = Promise.resolve();
  let drainedResolvers: Array<() => void> = [];

  function settle(): void {
    pending -= 1;
    if (pending === 0) {
      for (const resolve of drainedResolvers) resolve();
      drainedResolvers = [];
    }
  }

  return {
    enqueue(label, work) {
      if (closed) {
        // Refusing loudly is the point: silently accepting work during shutdown
        // would mean a write against a closed handle.
        log.warn({ label }, "background work refused — queue is closed");
        return;
      }
      pending += 1;
      chain = chain
        .then(async () => {
          try {
            await work();
          } catch (error) {
            failures += 1;
            log.error(
              { label, detail: error instanceof Error ? error.message : String(error), pending },
              "background work failed",
            );
          } finally {
            settle();
          }
        })
        .catch(() => {
          // The inner try/catch already handled it; this guard keeps one bad link
          // from breaking the chain for every later item.
          settle();
        });
    },

    get pending() {
      return pending;
    },

    get failures() {
      return failures;
    },

    async drain(timeoutMs = 5_000) {
      const before = pending;
      if (pending === 0) return { drained: 0, remaining: 0 };

      const waited = new Promise<void>((resolve) => {
        drainedResolvers.push(resolve);
      });
      const timer = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeoutMs);
      });

      const result = await Promise.race([waited.then(() => "drained" as const), timer]);
      if (result === "timeout") {
        log.warn({ pending, timeoutMs }, "background queue did not drain before the deadline");
      }
      return { drained: before - pending, remaining: pending };
    },

    close() {
      closed = true;
    },
  };
}

/** Test hook. A fresh queue per test keeps failure counts from leaking across. */
export function labelFor(action: string): string {
  return `audit:${action}`;
}
