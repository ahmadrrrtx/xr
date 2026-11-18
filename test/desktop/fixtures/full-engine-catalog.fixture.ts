/** Real loopback handler + real renderer adapters; no provider inference/network. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Store } from '../../../src/state/workspace-store';
import { makeHandler } from '../../../src/daemon/server';
import { loadConfig } from '../../../src/config/config';
import { createAgentExecutor } from '../../../src/daemon/agent-executor';
import { WorkspaceManager } from '../../../src/core/workspace';
import { XRShieldService } from '../../../src/security/shield';
import { providerGateway } from '../../../src/providers/gateway';
import { PRESETS } from '../../../src/providers/factory';
import { modelOptions, type EngineCatalog } from '../../../desktop/src/engine/catalog';
import { buildProviderCatalog } from '../../../desktop/src/engine/providerCatalog';
import type { EngineProvidersResponse } from '../../../desktop/src/engine/types';

const store = new Store(join(process.env.XR_HOME!, 'qualification.db'));
const token = 'hermetic-catalog-session-not-a-provider-key';
const executor = createAgentExecutor();
const state = { store, shield: new XRShieldService(store), workspaceManager: new WorkspaceManager(), agentExecutor: executor };
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: makeHandler(store, token, { sharedState: state }) });
const base = `http://127.0.0.1:${server.port}/api/v1`;
const request = (path: string, auth: string | null = token, body?: unknown) => fetch(base + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
  signal: AbortSignal.timeout(3000),
});
const get = async <T>(path: string): Promise<T> => {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  return response.json() as Promise<T>;
};
try {
  const health = await request('/health', null);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json() as object).sort(), ['ok', 'ts']);
  assert.equal((await request('/meta/version', null)).status, 401);
  assert.equal((await request('/meta/version', 'wrong-session')).status, 401);
  const meta = await get<{ contractVersion: number; capabilities: string[] }>('/meta/version');
  assert.equal(meta.contractVersion, 1);
  assert(meta.capabilities.includes('providers.catalog'));

  const providers = await get<EngineProvidersResponse>('/providers');
  const catalog = await get<EngineCatalog>('/providers/catalog');
  assert.deepEqual(providers.providers.map(p => p.id).sort(), Object.keys(PRESETS).sort());
  const source = providerGateway.catalog(loadConfig().config);
  const id = (m: { providerId: string; modelId: string }) => `${m.providerId}::${m.modelId}`;
  const expected = source.models.map(id).sort();
  assert(expected.length >= 27, 'full model catalog must not regress to a four-model subset');
  assert.deepEqual(catalog.models.map(id).sort(), expected);
  const options = modelOptions(providers, null, catalog);
  assert.deepEqual([...options.local, ...options.cloud].map(m => m.id).sort(), expected);
  assert(options.local.every(m => !m.available && !m.discovered), 'presence is not local installation/discovery');
  assert(options.cloud.every(m => !m.available), 'no credentials were supplied in this fresh home');
  const ui = buildProviderCatalog(providers.providers);
  assert.equal(ui.degraded, false);
  assert.deepEqual(ui.entries.filter(p => p.id !== 'custom').map(p => p.id).sort(), Object.keys(PRESETS).sort());

  const customId = 'qualification-full-catalog', customModel = 'owner/private/model';
  const added = await request('/providers/custom', token, {
    id: customId, baseUrl: 'https://93.184.216.34/v1', defaultModel: customModel,
  });
  assert.equal(added.status, 200, await added.text());
  const selected = await request('/providers/set', token, { provider: customId, model: customModel });
  assert.equal(selected.status, 200, await selected.text());
  const configured = await get<EngineProvidersResponse>('/providers');
  const refreshed = await get<EngineCatalog>('/providers/catalog');
  assert.equal(configured.primary, customId);
  assert.equal(configured.model, customModel);
  const dynamic = modelOptions(configured, null, refreshed);
  assert(dynamic.cloud.some(m => m.id === `${customId}::${customModel}` && m.isDefault));
  assert(buildProviderCatalog(configured.providers).entries.some(p => p.id === customId));
  console.log(JSON.stringify({ proof: 'full-engine-catalog-loopback-passed', providerCount: providers.providers.length,
    modelCount: expected.length, rendererOptions: options.local.length + options.cloud.length,
    anonymousHandshake: 401, wrongSessionHandshake: 401, authenticatedHandshake: 200,
    contract: meta.contractVersion, dynamicCustomChoice: true,
    scope: 'Real HTTP engine handlers and real renderer catalog adapters; no native UI, provider inference, physical audio or availability claim.' }));
} finally {
  server.stop(true);
  store.close();
}
// This disposable integration process owns imports with process-global service
// resources. Its contract is HTTP/auth/catalog, not daemon-exit qualification;
// exit only after every assertion and scoped kernel shutdown has completed.
process.exit(0);
