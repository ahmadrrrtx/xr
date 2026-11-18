/** An explicit endpoint probe uses the registered adapter/credential, never desktop HTTP. */
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeHandler } from '../../src/daemon/server';
import { Store } from '../../src/state/workspace-store';

const seen: Array<{ auth: string | null; body: any }> = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  if (new URL(req.url).pathname.endsWith('/models')) return new Response('not implemented', { status: 404 });
  seen.push({ auth: req.headers.get('authorization'), body: await req.json() });
  return Response.json({ choices: [{ message: { content: 'ok' } }] });
} });
const store = new Store(join(mkdtempSync(join(tmpdir(), 'xr-observation-')), 'state.db'));
const handler = makeHandler(store, 'observation-fixture');
afterAll(() => { upstream.stop(true); store.close(); });
function call(path: string, body: unknown, authorized = true) {
  return handler(new Request('http://127.0.0.1/api/v1'+path, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer observation-fixture' } : {}) }, body: JSON.stringify(body) }));
}
test('a registered compatible endpoint probe receives the chosen model and only its broker credential', async () => {
  const added = await call('/providers/custom', { id: 'probe-fixture', baseUrl: `http://127.0.0.1:${upstream.port}/v1`, defaultModel: 'owner/probe-model', apiKey: 'fixture-provider-secret' });
  expect(added.status).toBe(200);
  const res = await call('/providers/probe', { providerId: 'probe-fixture', model: 'owner/selected-model' });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.ok).toBe(true);
  expect(body.inferenceVerified).toBe(false); // health is not a parsed turn/capability certification
  expect(body.model).toBe('owner/selected-model');
  expect(seen).toEqual([{ auth: 'Bearer fixture-provider-secret', body: { model: 'owner/selected-model', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 } }]);
  expect(JSON.stringify(body)).not.toContain('fixture-provider-secret');
});
test('endpoint probes are authenticated and reject unknown provider identities without a request', async () => {
  const before = seen.length;
  expect((await call('/providers/probe', { providerId: 'probe-fixture' }, false)).status).toBe(401);
  expect((await call('/providers/probe', { providerId: 'not-registered' })).status).toBe(404);
  expect(seen.length).toBe(before);
});

test('an explicit endpoint test always makes a fresh request after credential rotation', async () => {
  const input = { id: 'probe-fixture', baseUrl: `http://127.0.0.1:${upstream.port}/v1`, defaultModel: 'owner/probe-model' };
  expect((await call('/providers/probe', { providerId: input.id, model: 'owner/selected-model' })).status).toBe(200);
  const before = seen.length;
  expect((await call('/providers/custom', { ...input, apiKey: 'fixture-rotated-secret' })).status).toBe(200);
  expect((await call('/providers/probe', { providerId: input.id, model: 'owner/selected-model' })).status).toBe(200);
  expect(seen.length).toBe(before + 1);
  expect(seen.at(-1)?.auth).toBe('Bearer fixture-rotated-secret');
});
