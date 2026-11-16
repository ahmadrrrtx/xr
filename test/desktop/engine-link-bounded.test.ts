/*
 * S-4 — the engine link must never freeze a caller for the pairing window.
 *
 * `resolveEndpoint()` used to poll `engine_link` 40×500 ms INSIDE the promise
 * that every engine call awaits. In a packaged build whose sidecar did not pair
 * (spawn failure, missing binary, slow disk), the first probe blocked every
 * surface for 20 s with no cancel — an event loop that is not running.
 *
 * The rules pinned here:
 *   · a FRESH boot attempt may use the whole window (that wait is `starting`);
 *   · an ordinary caller waits at most LINK_CALLER_WAIT_MS;
 *   · a negative answer is cached briefly, because the shell already said no;
 *   · a burst of callers shares ONE shell poll, not one per caller;
 *   · `spawned === false` is final — polling cannot fix a missing sidecar.
 */
import { describe, expect, test } from 'bun:test';
import {
  LINK_BOOT_DEADLINE_MS,
  LINK_CALLER_WAIT_MS,
  LINK_PENDING_REASON,
  acquireLink,
  createLinkCache,
  endpointFor,
  isLinked,
  type EngineLink,
} from '../../desktop/src/engine/link';
import type { EngineEndpoint } from '../../desktop/src/engine/transport';

const linked: EngineLink = { reachable: true, spawned: true, port: 41234, token: 'tok-abc' };
const notYet: EngineLink = { reachable: false, spawned: true };
const noSidecar: EngineLink = { reachable: false, spawned: false, reason: 'no sidecar in this build' };

/** A fake clock: sleep() advances time instantly, so nothing actually waits. */
function clock(): { now: () => number; sleep: (ms: number) => Promise<void>; elapsed: () => number } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t,
  };
}

describe('S-4 · acquireLink bounds the boot wait', () => {
  test('a paired link resolves immediately, with the sidecar endpoint shape', async () => {
    const c = clock();
    let calls = 0;
    const ep = await acquireLink(
      async () => (calls++, linked),
      { now: c.now, sleep: c.sleep },
    );
    expect(calls).toBe(1);
    expect(ep.base).toBe('http://127.0.0.1:41234/api/v1');
    expect(ep.token).toBe('tok-abc');
    expect(ep.via).toBe('sidecar');
    expect(ep.reason).toBeNull();
  });

  test('it waits out the window when the sidecar is still pairing, then reports a deadline', async () => {
    const c = clock();
    const ep = await acquireLink(async () => notYet, { now: c.now, sleep: c.sleep });
    expect(ep.via).toBe('dev-proxy');
    expect(ep.token).toBeNull();
    expect(ep.reason).toBe('the sidecar did not pair within 20 s');
    // Bounded by the deadline, not unbounded: the poll cannot spin forever.
    expect(c.elapsed()).toBeLessThanOrEqual(LINK_BOOT_DEADLINE_MS + 500);
    expect(LINK_BOOT_DEADLINE_MS).toBe(20_000);
  });

  test('spawned:false stops at once — the shell already said there is no sidecar', async () => {
    const c = clock();
    let calls = 0;
    const ep = await acquireLink(
      async () => (calls++, noSidecar),
      { now: c.now, sleep: c.sleep },
    );
    expect(calls).toBe(1);
    expect(c.elapsed()).toBe(0);
    expect(ep.reason).toBe('no sidecar in this build');
  });

  test('a shell that throws becomes a reason, never a rejection', async () => {
    const c = clock();
    const ep = await acquireLink(
      async () => {
        throw new Error('ipc closed');
      },
      { now: c.now, sleep: c.sleep },
    );
    expect(ep.reason).toBe('engine_link failed: ipc closed');
  });

  test('link detection requires all three of reachable, port and token', () => {
    expect(isLinked(linked)).toBe(true);
    expect(isLinked({ ...linked, token: null })).toBe(false);
    expect(isLinked({ ...linked, port: null })).toBe(false);
    expect(isLinked({ ...linked, reachable: false })).toBe(false);
    expect(isLinked(null)).toBe(false);
    expect(endpointFor(linked).base).toContain('/api/v1');
  });
});

describe('S-4 · the cache keeps callers off the pairing window', () => {
  const pending = (): EngineEndpoint => ({
    base: '/api/v1',
    token: null,
    via: 'dev-proxy',
    port: null,
    reason: 'not paired',
  });

  test('an ordinary caller gives up after LINK_CALLER_WAIT_MS instead of the boot window', async () => {
    const cache = createLinkCache(
      // Resolves after 10 s — far longer than a caller may wait.
      () =>
        new Promise<EngineEndpoint>((r) => {
          setTimeout(() => r(pending()), 10_000);
        }),
      { callerWaitMs: 20, negativeTtlMs: 0, now: () => Date.now() },
    );
    const started = Date.now();
    const ep = await cache.get();
    expect(Date.now() - started).toBeLessThan(1_000);
    // The honest answer is "still resolving", not a throw and not a 20 s hang.
    expect(ep.token).toBeNull();
    expect(ep.reason).toBe(LINK_PENDING_REASON);
    expect(LINK_CALLER_WAIT_MS).toBe(1_500);
  }, 20_000);

  test('a burst of callers shares ONE resolve, not one per call', async () => {
    let resolves = 0;
    const cache = createLinkCache(
      async () => {
        resolves += 1;
        await new Promise((r) => setTimeout(r, 10));
        return pending();
      },
      { callerWaitMs: 1_000, negativeTtlMs: 0, now: () => Date.now() },
    );
    await Promise.all([cache.get(), cache.get(), cache.get(), cache.get()]);
    expect(resolves).toBe(1);
  });

  test('a live link is cached and reused', async () => {
    let resolves = 0;
    const cache = createLinkCache(
      async () => {
        resolves += 1;
        return endpointFor(linked);
      },
      { callerWaitMs: 1_000, negativeTtlMs: 0, now: () => Date.now() },
    );
    const a = await cache.get();
    const b = await cache.get();
    expect(a.token).toBe('tok-abc');
    expect(b.token).toBe('tok-abc');
    expect(resolves).toBe(1);
  });

  test('a recent negative answer stands until the TTL passes', async () => {
    let resolves = 0;
    let t = 1_000;
    const cache = createLinkCache(
      async () => {
        resolves += 1;
        return pending();
      },
      { callerWaitMs: 5_000, negativeTtlMs: 5_000, now: () => t },
    );
    await cache.get();
    expect(resolves).toBe(1);
    await cache.get(); // still inside the TTL — a re-poll would only freeze this caller
    expect(resolves).toBe(1);
    t += 6_000;
    await cache.get(); // TTL expired: one fresh attempt is allowed
    expect(resolves).toBe(2);
  });

  test('reset() drops the cached answer — the shell restarted the sidecar', async () => {
    let resolves = 0;
    const cache = createLinkCache(
      async () => {
        resolves += 1;
        return resolves === 1 ? pending() : endpointFor(linked);
      },
      { callerWaitMs: 1_000, negativeTtlMs: 60_000, now: () => Date.now() },
    );
    expect((await cache.get()).token).toBeNull();
    cache.reset();
    expect((await cache.get()).token).toBe('tok-abc');
  });

  test('boot() rides the whole window — that is the one caller allowed to', async () => {
    let done = false;
    const cache = createLinkCache(
      () =>
        new Promise<EngineEndpoint>((r) => {
          setTimeout(() => {
            done = true;
            r(endpointFor(linked));
          }, 20);
        }),
      { callerWaitMs: 1, negativeTtlMs: 0, now: () => Date.now() },
    );
    const ep = await cache.boot();
    expect(done).toBe(true);
    expect(ep.token).toBe('tok-abc');
  });
});
