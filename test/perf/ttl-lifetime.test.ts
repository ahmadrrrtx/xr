import { expect, test } from 'bun:test';
import { TtlCache } from '../../src/util/ttl-cache';
const deferred = () => { let resolve!: (s: string) => void, reject!: (e: Error) => void; return { promise: new Promise<string>((a, b) => { resolve = a; reject = b; }), resolve: (s: string) => resolve(s), reject: (e: Error) => reject(e) }; };
for (const failure of [false, true]) test(`invalidated ${failure ? 'failed' : 'successful'} work cannot erase or overwrite a newer cache flight`, async () => {
  const cache = new TtlCache<string>({ ttlMs: 1000 }); const a = deferred(), b = deferred();
  const old = cache.getOrStart('key', () => a.promise); const caught = old.catch(() => null);
  expect(cache.keys()).toContain('key'); // targeted invalidation must see pending-only keys
  cache.delete('key'); const next = cache.getOrStart('key', () => b.promise);
  if (failure) a.reject(new Error('old')); else a.resolve('old'); await caught;
  let unexpected = 0; const joined = cache.getOrStart('key', async () => { unexpected++; return 'wrong'; });
  expect(unexpected).toBe(0); expect(cache.get('key')).toBeUndefined();
  b.resolve('new'); await Promise.all([next, joined]); expect(cache.get('key')?.value).toBe('new');
});
test('a background SWR refresh cannot resurrect a deleted entry', async () => {
  const cache = new TtlCache<string>({ ttlMs: 1, staleWhileRevalidateMs: 1000 }); const a = deferred();
  cache.set('key', 'stale'); await new Promise(r => setTimeout(r, 4));
  expect((await cache.getOrStart('key', () => a.promise)).stale).toBe(true);
  cache.clear(); a.resolve('old'); await new Promise(r => setTimeout(r, 0)); expect(cache.get('key')).toBeUndefined();
});
