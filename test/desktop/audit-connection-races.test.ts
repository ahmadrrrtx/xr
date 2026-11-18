/** Executed regressions from the 2026-11-16 connection audit. */
import { expect, test } from 'bun:test';
import { acquireLink, createLinkCache, endpointFor, type EngineLink } from '../../desktop/src/engine/link';
import type { EngineEndpoint } from '../../desktop/src/engine/transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const live = (token: string) => endpointFor({ reachable: true, port: 43210, token });

test('a rejected IPC read stops immediately, instead of retrying for the entire boot window', async () => {
  let reads = 0;
  let now = 0;
  const ep = await acquireLink(async () => { reads++; throw new Error('closed'); }, {
    deadlineMs: 100, intervalMs: 10, now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  expect(ep.reason).toBe('engine_link failed: closed');
  expect(reads).toBe(1);
});

test('a null IPC snapshot is pending, not proof that the engine cannot start', async () => {
  let reads = 0;
  const ep = await acquireLink(async () => ++reads === 1 ? null : {
    reachable: true, port: 43210, token: 'new',
  }, { deadlineMs: 100, intervalMs: 1 });
  expect(ep.token).toBe('new');
  expect(reads).toBe(2);
});

test('the boot deadline also bounds an IPC promise that never settles', async () => {
  const start = Date.now();
  let timedOut = false;
  const sentinel = setTimeout(() => { timedOut = true; }, 150);
  const result = await Promise.race([
    acquireLink(() => new Promise<EngineLink | null>(() => {}), { deadlineMs: 20 }),
    new Promise<null>((r) => setTimeout(() => r(null), 180)),
  ]);
  clearTimeout(sentinel);
  expect(result).not.toBeNull();
  expect(result?.reason).toContain('did not pair');
  expect(timedOut).toBe(false);
  expect(Date.now() - start).toBeLessThan(150);
});

test('a pre-restart resolution cannot overwrite the new cached bearer', async () => {
  const old = deferred<EngineEndpoint>();
  const next = deferred<EngineEndpoint>();
  let calls = 0;
  const cache = createLinkCache(() => ++calls === 1 ? old.promise : next.promise);
  const a = cache.boot();
  cache.reset();
  const b = cache.boot();
  next.resolve(live('new'));
  await b;
  old.resolve(live('old'));
  await a;
  expect((await cache.get()).token).toBe('new');
  expect(calls).toBe(2);
});

test('a stale finally cannot clear a newer in-flight acquisition', async () => {
  const old = deferred<EngineEndpoint>();
  const next = deferred<EngineEndpoint>();
  let calls = 0;
  const cache = createLinkCache(() => ++calls === 1 ? old.promise : next.promise);
  const a = cache.boot();
  cache.reset();
  const b = cache.boot();
  old.resolve(live('old'));
  await a;
  const joined = cache.boot();
  expect(calls).toBe(2);
  next.resolve(live('new'));
  expect((await b).token).toBe('new');
  expect((await joined).token).toBe('new');
});
