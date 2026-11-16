/*
 * Engine link acquisition (S-4) — the `engine_link` handshake, extracted from
 * transport.ts so its timing is testable without a Tauri window.
 *
 * The defect this exists to prevent: `resolveEndpoint()` polled `engine_link`
 * 40 times, 500 ms apart, INSIDE the promise every engine call awaits. When the
 * sidecar had not paired, the first probe froze every surface for a full 20 s —
 * on the UI thread, in a packaged build, with no cancel. The deadline is
 * right; blocking a caller on it is not.
 *
 * Two rules follow from that:
 *
 *  1. A FRESH attempt may wait out the pairing window. That is what `boot()`
 *     is for, driven by the boot probe with a visible `starting` state.
 *  2. A CALLER never waits longer than `LINK_CALLER_WAIT_MS`. Past that it gets
 *     the last observed answer, ready or not, so the request fails fast with a
 *     real reason instead of hanging the frame.
 *
 * A negative result is cached for `LINK_NEGATIVE_TTL_MS`: the shell already
 * told us `spawned === false` (there is no sidecar in this build), so asking it
 * again 500 ms later, forty times, on every engine call, cannot change the
 * answer. A positive link is cached until something resets it.
 */
import type { EngineEndpoint } from './transport';

export const LINK_POLL_INTERVAL_MS = 500;
export const LINK_BOOT_DEADLINE_MS = 20_000;
export const LINK_CALLER_WAIT_MS = 1_500;
export const LINK_NEGATIVE_TTL_MS = 5_000;
/** The reason a capped caller reports when the first answer has not landed. */
export const LINK_PENDING_REASON = 'the engine link is still resolving';

/** What the Rust shell reports on the `engine_link` command. */
export interface EngineLink {
  reachable?: boolean;
  spawned?: boolean;
  port?: number | null;
  token?: string | null;
  reason?: string | null;
}

/** True when the link is a live sidecar (port + bearer token present). */
export function isLinked(link: EngineLink | null | undefined): boolean {
  return Boolean(link?.reachable && link.port && link.token);
}

/** The daemon base for a link — the ONE place the URL shape is built. */
export function endpointFor(link: EngineLink): EngineEndpoint {
  return {
    base: `http://127.0.0.1:${link.port}/api/v1`,
    token: link.token ?? null,
    via: 'sidecar',
    port: link.port ?? null,
    reason: null,
  };
}

/**
 * Poll `engine_link` until the sidecar pairs, the shell says it never will, or
 * the boot deadline passes. Always resolves — a failure is a reason string on
 * the returned endpoint, never a throw.
 *
 * `read` is the shell call; `now`/`sleep` are injected so the deadline is
 * testable in milliseconds rather than 20 seconds.
 */
export async function acquireLink(
  read: () => Promise<EngineLink | null>,
  opts: { deadlineMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<EngineEndpoint> {
  const deadlineMs = opts.deadlineMs ?? LINK_BOOT_DEADLINE_MS;
  const intervalMs = opts.intervalMs ?? LINK_POLL_INTERVAL_MS;
  const now = opts.now ?? ((): number => Date.now());
  const sleep = opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const startedAt = now();
  let reason: string | null = null;
  for (;;) {
    const link = await read().catch((e: unknown): null => {
      reason = `engine_link failed: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    });
    if (reason === null && link === null) {
      // `read` threw: `reason` says why, and polling cannot improve it.
      break;
    }
    if (link && isLinked(link)) return endpointFor(link);
    if (link?.spawned === false) {
      // The shell owns the spawn and says there is none: polling cannot fix it.
      reason = link.reason ?? 'no sidecar in this build';
      break;
    }
    if (now() - startedAt >= deadlineMs) break;
    await sleep(intervalMs);
  }
  if (!reason) reason = `the sidecar did not pair within ${Math.round(deadlineMs / 1000)} s`;
  return { base: '/api/v1', token: null, via: 'dev-proxy', port: null, reason };
}

/** Cache around a link resolution: one in-flight attempt, a negative TTL. */
export interface LinkCache {
  /** Resolve the link, joining the in-flight attempt if there is one. */
  get: () => Promise<EngineEndpoint>;
  /** Start (or reuse) a boot attempt and wait for it out in full. */
  boot: () => Promise<EngineEndpoint>;
  /** Drop everything: the shell restarted the sidecar. */
  reset: () => void;
}

export function createLinkCache(
  resolve: () => Promise<EngineEndpoint>,
  opts: { callerWaitMs?: number; negativeTtlMs?: number; now?: () => number } = {},
): LinkCache {
  const callerWaitMs = opts.callerWaitMs ?? LINK_CALLER_WAIT_MS;
  const negativeTtlMs = opts.negativeTtlMs ?? LINK_NEGATIVE_TTL_MS;
  const now = opts.now ?? ((): number => Date.now());
  let inflight: Promise<EngineEndpoint> | null = null;
  let last: EngineEndpoint | null = null;
  let failedAt: number | null = null;

  const start = (): Promise<EngineEndpoint> => {
    inflight ??= resolve()
      .then((ep) => {
        last = ep;
        failedAt = ep.token ? null : now();
        return ep;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    get: async () => {
      if (last?.token) return last;
      // A recent negative answer stands: re-running a 20 s handshake that just
      // failed (or the shell just refused) only freezes the next caller too.
      if (last && failedAt !== null && now() - failedAt < negativeTtlMs) return last;
      const attempt = start();
      // Never let a caller ride the pairing window to completion. AWAIT the
      // timeout too: the point is to return, not to keep waiting on `attempt`.
      const raced = await Promise.race([
        attempt,
        new Promise<null>((r) => setTimeout(() => r(null), callerWaitMs)),
      ]);
      if (raced) return raced;
      // `last` is set by the attempt's own `then`, so a just-landed endpoint is
      // the honest answer; otherwise say the link is still resolving and let the
      // caller fail fast (the boot probe keeps the attempt alive).
      return last ?? { base: '/api/v1', token: null, via: 'dev-proxy', port: null, reason: LINK_PENDING_REASON };
    },
    boot: () => start(),
    reset: () => {
      inflight = null;
      last = null;
      failedAt = null;
    },
  };
}
