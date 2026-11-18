/** Arbitrarily named header credentials must never become config or response data. */
import { afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeHandler } from '../../src/daemon/server';
import { Store } from '../../src/state/workspace-store';
import { configPath, loadConfig, saveConfig } from '../../src/config/config';
import { ConfigService } from '../../src/services/config-service';
import { providerGateway } from '../../src/providers/gateway';
import { resolveCustomHeaders } from '../../src/providers/header-secrets';
const seen: Headers[] = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) { seen.push(req.headers); return Response.json({ data: [{ id: 'fixture/model' }] }); } });
const baseUrl = `http://127.0.0.1:${upstream.port}/v1`;
const store = new Store(join(mkdtempSync(join(tmpdir(), 'xr-header-')), 'state.db'));
const handler = makeHandler(store, 'header-fixture');
afterAll(() => { upstream.stop(true); store.close(); });
const call = (body?: unknown) => handler(new Request('http://127.0.0.1/api/v1/providers/custom', { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer header-fixture', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const find = (id: string) => loadConfig().config.providerEngine.customProviders.find(p => p.id === id)!;
test('header-only auth is sealed, endpoint scoped, lazily resolved and never echoed', async () => {
  const res = await call({ id: 'header-fixture', baseUrl, defaultModel: 'fixture/model', headers: { Authorization: 'Custom fixture-header-value', 'X-Obscure-Setting': 'fixture-hidden-value' } });
  expect(res.status).toBe(200); expect((await res.json() as any).provider.keyed).toBe(true);
  const config = loadConfig().config; const custom = find('header-fixture');
  expect(Object.values(custom.headers!)).toHaveLength(2);
  expect(Object.values(custom.headers!).every(v => v.startsWith('secret://XR_CUSTOM_'))).toBe(true);
  expect(readFileSync(configPath(), 'utf8')).not.toContain('fixture-header-value');
  expect(readFileSync(configPath(), 'utf8')).not.toContain('fixture-hidden-value');
  expect(await (await call()).text()).not.toContain('fixture-header-value');
  providerGateway.list(config);
  await providerGateway.createProvider(custom.id, config, 'fixture/model').listModels!();
  expect(seen.at(-1)?.get('authorization')).toBe('Custom fixture-header-value');
  expect(seen.at(-1)?.get('x-obscure-setting')).toBe('fixture-hidden-value');
  expect(() => resolveCustomHeaders('different-owner', baseUrl, custom.headers)).toThrow('scoped');
  expect(() => resolveCustomHeaders(custom.id, baseUrl + '/other', custom.headers)).toThrow('scoped');
  expect((await call({ id: custom.id, baseUrl, defaultModel: 'fixture/changed' })).status).toBe(200);
  expect(find(custom.id).headers).toEqual(custom.headers); // blank edit is not secret deletion
});
test('invalid/hop headers and credential-bearing URLs cannot publish secrets; built-in keys cannot be borrowed', async () => {
  for (const headers of [{ Host: 'metadata.invalid' }, { 'X-Key': 'line\r\nbreak' }, { 'X-Dup': 'one', 'x-dup': 'two' }]) {
    expect((await call({ id: 'bad-headers', baseUrl, defaultModel: 'm', headers })).status).toBe(400);
  }
  const refused = await call({ baseUrl: 'https://user:fixture-url-password@api.openai.com/v1', defaultModel: 'm' });
  expect(refused.status).toBe(400); expect(await refused.text()).not.toContain('fixture-url-password');
  expect((await call({ id: 'borrow', baseUrl, defaultModel: 'm', apiKeyEnv: 'OPENAI_API_KEY' })).status).toBe(400);
  expect(loadConfig().config.providerEngine.customProviders.some(p => p.id === 'bad-headers')).toBe(false);
});
test('legacy plaintext headers migrate only after broker acknowledgement; runtime blocks unsealed config', async () => {
  const config = loadConfig().config;
  config.providerEngine.customProviders.push({ id: 'legacy-headers', label: 'Legacy', baseUrl, defaultModel: 'm', headers: { 'x-legacy-auth': 'fixture-legacy-value' }, capabilities: { chat: true } as any });
  saveConfig(config);
  providerGateway.list(config);
  expect(() => providerGateway.createProvider('legacy-headers', config, 'm')).toThrow();
  const service = new ConfigService(); await service.onInit();
  const migrated = find('legacy-headers');
  expect(resolveCustomHeaders(migrated.id, baseUrl, migrated.headers)['x-legacy-auth']).toBe('fixture-legacy-value');
  expect(readFileSync(configPath(), 'utf8')).not.toContain('fixture-legacy-value');
  expect(service.getWarnings().join(' ')).toContain('Rotate');
});
