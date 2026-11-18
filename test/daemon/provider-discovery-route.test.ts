import { afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeHandler } from '../../src/daemon/server';
import { Store } from '../../src/state/workspace-store';
import { loadConfig } from '../../src/config/config';
const requests: Array<{ path: string; auth: string | null; body?: any }> = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const url = new URL(req.url);
  const item = { path: url.pathname, auth: req.headers.get('authorization'), body: req.method === 'POST' ? await req.json() : undefined };
  requests.push(item);
  if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'owner/discovered' }] });
  return Response.json({ choices: [{ message: { content: 'XR_OK' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
} });
const store = new Store(join(mkdtempSync(join(tmpdir(), 'xr-discovery-')), 'state.db'));
const handler = makeHandler(store, 'discovery-fixture');
afterAll(() => { upstream.stop(true); store.close(); });
const call = (path: string, body?: unknown, auth = true) => handler(new Request('http://127.0.0.1/api/v1' + path, {
  method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer discovery-fixture' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
}));
test('discovery drafts need no guessed model; offline catalog inspection never triggers vendor traffic', async () => {
  const defaults = { ...loadConfig().config.defaults };
  const added = await call('/providers/custom', { id: 'discovery-fixture', baseUrl: `http://127.0.0.1:${upstream.port}/v1`, apiKey: 'fixture-discovery-secret', draft: true });
  expect(added.status).toBe(200); expect((await added.json() as any).provider.defaultModel).toBeNull();
  await call('/providers'); const catalog = await (await call('/providers/catalog')).json() as any;
  expect(requests).toHaveLength(0); expect(loadConfig().config.defaults).toEqual(defaults);
  expect(catalog.models.filter((m: any) => m.providerId === 'discovery-fixture')).toEqual([]);
  const observed = await call('/providers/discover', { providerId: 'discovery-fixture', optIn: true });
  expect(observed.status).toBe(200); const out = await observed.json() as any;
  expect(out.status).toBe('ok'); expect(out.models[0].modelId).toBe('owner/discovered');
  expect(out.models[0].validation.chat).toBe('not_tested'); expect(out.models[0].capabilities).toEqual({});
  expect(requests[0].auth).toBe('Bearer fixture-discovery-secret'); expect(JSON.stringify(out)).not.toContain('fixture-discovery-secret');
  expect(loadConfig().config.defaults).toEqual(defaults); // enumeration is not selection
});
test('capability validation uses the selected model/broker and does not certify other capabilities', async () => {
  const res = await call('/providers/validate', { providerId: 'discovery-fixture', model: 'owner/chosen', capability: 'chat', optIn: true, allowBillable: true });
  expect(res.status).toBe(200); const out = await res.json() as any;
  expect(out.status).toBe('passed'); expect(out.agentValidated).toBe(false); expect(out.billingVerified).toBe(false);
  expect(out.validation.toolUse).toBe('not_tested'); expect(requests.at(-1)?.body.model).toBe('owner/chosen');
  expect(requests.at(-1)?.auth).toBe('Bearer fixture-discovery-secret');
  const notStreaming = await (await call('/providers/validate', { providerId: 'discovery-fixture', model: 'owner/chosen', capability: 'streaming', optIn: true, allowBillable: true })).json() as any;
  expect(notStreaming.status).toBe('failed');
});
test('authentication, known identity and explicit consent are required before any upstream traffic', async () => {
  const before = requests.length;
  expect((await call('/providers/discover', { providerId: 'discovery-fixture', optIn: true }, false)).status).toBe(401);
  expect((await call('/providers/discover', { providerId: 'discovery-fixture' })).status).toBe(400);
  expect((await call('/providers/discover', { providerId: 'unknown-fixture', optIn: true })).status).toBe(404);
  expect((await call('/providers/validate', { providerId: 'discovery-fixture', model: 'owner/chosen', capability: 'chat', optIn: true })).status).toBe(400);
  expect((await call('/providers/discover', { providerId: 'discovery-fixture', optIn: true, apiKey: 'not-accepted' })).status).toBe(400);
  expect(requests.length).toBe(before);
});
