/** Drive registration -> desktop preparation -> engine default through real handlers. */
import { afterAll, expect, spyOn, test } from 'bun:test';
import { ProviderService } from '../../src/services/provider-service.ts';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeHandler } from '../../src/daemon/server.ts';
import { Store } from '../../src/state/workspace-store.ts';
import { prepareModelSetup } from '../../desktop/src/engine/setup.ts';

const store = new Store(join(mkdtempSync(join(tmpdir(), 'xr-audit-custom-')), 'state.db'));
const handler = makeHandler(store, 'audit-fixture');
afterAll(() => store.close());
async function call(path: string, body?: unknown) {
  const res = await handler(new Request(`http://127.0.0.1:3141/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer audit-fixture', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

for (const keyed of [true, false]) {
  test(`a ${keyed ? 'keyed' : 'keyless'} registered endpoint completes onboarding without saving its key twice`, async () => {
    const secret = 'audit-fixture-secret';
    const added = await call('/providers/custom', {
      id: keyed ? 'audit-keyed' : 'audit-keyless',
      baseUrl: 'http://93.184.216.34/v1', defaultModel: 'owner/model-one',
      ...(keyed ? { apiKey: secret } : {}),
    });
    let secretSaves = 0;
    const prepared = await prepareModelSetup({
      source: 'cloud', providerId: added.provider.id, model: added.provider.defaultModel,
    }, {
      async saveSecret(input) { secretSaves++; return call('/onboarding/provider', input); },
      async setDefault(provider, model) { await call('/providers/set', { provider, model }); },
    });
    expect(secretSaves).toBe(0);
    expect(prepared.selection).toBe(`${added.provider.id}/owner/model-one`);
    expect(JSON.stringify(prepared)).not.toContain(secret);
    const snapshot = await call('/providers');
    expect(snapshot.primary).toBe(added.provider.id);
    expect(snapshot.model).toBe('owner/model-one');
    const row = snapshot.providers.find((p: any) => p.id === added.provider.id);
    expect(row.hasKey).toBe(true); // credential available OR deliberately keyless
    expect(row.keyless).toBe(!keyed);
    if (!keyed) expect(added.provider.apiKeyEnv).toBeNull();
  });
}

test('editing a registered custom id preserves identity and its credential reference', async () => {
  const input = { id: 'audit-edit', baseUrl: 'http://93.184.216.35/v1', defaultModel: 'm1' };
  await call('/providers/custom', { ...input, apiKey: 'fixture-private' });
  await call('/providers'); // sync runtime registry, as the desktop catalog refresh does
  const edited = await call('/providers/custom', { ...input, defaultModel: 'm2' });
  expect(edited.provider.id).toBe('audit-edit');
  expect(edited.provider.apiKeyEnv).toBe('AUDIT_EDIT_API_KEY');
  const list = await call('/providers/custom');
  expect(list.providers.filter((p: any) => p.id === 'audit-edit')).toHaveLength(1);
  expect(list.providers.some((p: any) => p.id === 'audit-edit-compatible')).toBe(false);
});

test('a refused secret write cannot publish a half-configured endpoint', async () => {
  const secret = spyOn(ProviderService.prototype, 'storeKey').mockRejectedValueOnce(new Error('secret backend refused'));
  try {
    await expect(call('/providers/custom', {
      id: 'audit-refused', baseUrl: 'http://93.184.216.36/v1', defaultModel: 'm', apiKey: 'fixture',
    })).rejects.toThrow('secret backend refused');
    const list = await call('/providers/custom');
    expect(list.providers.some((p: any) => p.id === 'audit-refused')).toBe(false);
  } finally { secret.mockRestore(); }
});
