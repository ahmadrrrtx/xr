/**
 * B1 — a stray rejected promise must not take the whole engine down.
 *
 * Bun (like Node) exits on an unhandled rejection. The daemon is a long-lived
 * local server: one detached background chain that rejects (a voice download
 * completion, a bot autostart) used to kill every open session with it. While
 * a daemon is serving, an unhandled rejection is logged and audited instead.
 * The guard's lifetime is the daemon's: `serve()` installs it and `stop()`
 * releases it, so an in-process test daemon never masks rejections for the
 * rest of a test run. The fix for any recorded rejection is still to handle
 * it at its source; this is the last line, not the strategy.
 */
import { structuredLog } from "../observability/logs.ts";
import { describeThrown } from "../util/thrown.ts";

export interface ProcessGuardSink {
  audit(action: string, details: Record<string, unknown>): unknown;
}

/** Record one unhandled rejection. Total: never throws, whatever was rejected. */
export function recordUnhandledRejection(reason: unknown, sink?: ProcessGuardSink): void {
  const detail = describeThrown(reason, 300);
  try { structuredLog("error", "daemon.unhandled_rejection", { reason: detail }); } catch { /* logging is best-effort */ }
  try { sink?.audit("daemon.unhandled_rejection", { reason: detail }); } catch { /* the store may already be closed */ }
}

let active: ((reason: unknown) => void) | null = null;

/** Install the guard for this daemon's lifetime; the returned function releases it. */
export function installProcessGuards(sink?: ProcessGuardSink): () => void {
  if (active) return () => {};
  const listener = (reason: unknown): void => recordUnhandledRejection(reason, sink);
  active = listener;
  process.on("unhandledRejection", listener);
  return () => {
    if (active !== listener) return;
    process.off("unhandledRejection", listener);
    active = null;
  };
}
