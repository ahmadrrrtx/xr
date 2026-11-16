import { afterEach, beforeEach, expect, test } from 'bun:test';
import { storage, setTauri } from './helpers/dom-shim.ts';
import { engineFetch, engineJson, engineHandshake, resetEngineHandshake, resetEngineLink } from '../../desktop/src/engine/transport.ts';

const original = globalThis.fetch;
beforeEach(() => { storage.clear(); setTauri(false); resetEngineLink(); });
afterEach(() => { globalThis.fetch = original; resetEngineLink(); });

test('aborting a streaming caller AFTER headers still aborts the fetch signal', async () => {
  let upstream: AbortSignal | null = null;
  globalThis.fetch = (async (_url, init) => {
    upstream = init?.signal ?? null;
    return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  const caller = new AbortController();
  const res = await engineFetch('/events', { signal: caller.signal });
  caller.abort();
  expect(upstream?.aborted).toBe(true);
  await res.body?.cancel();
});

test('a JSON caller abort is bounded even when headers arrived and the body never does', async () => {
  const body = new ReadableStream({ start() {} });
  globalThis.fetch = (async () => new Response(body)) as typeof fetch;
  const caller = new AbortController();
  const task = engineJson('/health', { signal: caller.signal }).catch((e) => e);
  const timeout = setTimeout(() => caller.abort(), 10);
  const sentinel = new Error('body remained stuck');
  const result = await Promise.race([task, Bun.sleep(150).then(() => sentinel)]);
  clearTimeout(timeout);
  expect(result).not.toBe(sentinel);
  expect(result.name).toBe('AbortError');
});

test('an old failed contract probe cannot clear a newly successful handshake cache', async () => {
  let reject!: (e: Error) => void;
  let calls = 0;
  const started = Promise.withResolvers<void>();
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) { started.resolve(); return new Promise<Response>((_r, no) => { reject = no; }); }
    return Response.json({ contractVersion: 1, version: '1.2.0-preview.1', minDesktopVersion: '0.1.0' });
  }) as typeof fetch;
  const old = engineHandshake().catch(() => {});
  await started.promise;
  resetEngineHandshake();
  await engineHandshake();
  reject(new Error('old engine exited'));
  await old;
  await engineHandshake();
  expect(calls).toBe(2);
});
