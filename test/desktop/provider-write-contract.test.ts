import { storage, setTauri } from './helpers/dom-shim';
import { afterEach, expect, test } from 'bun:test';
import { addCustomProviderToEngine, saveProviderKeyToEngine } from '../../desktop/src/engine/providers';
import { useEngineStore } from '../../desktop/src/stores/engineStore';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; useEngineStore.setState({ status: 'disconnected' }); });
for (const status of ['starting', 'degraded', 'disconnected', 'failed'] as const) {
  test(`custom and preset credentials cannot be written to a ${status} engine`, async () => {
    storage.clear(); setTauri(false); useEngineStore.setState({ status });
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
    await expect(addCustomProviderToEngine({ baseUrl: 'https://example.com/v1', defaultModel: 'm', apiKey: 'fixture' })).rejects.toThrow('Engine not ready');
    expect(() => saveProviderKeyToEngine({ providerId: 'openai', apiKey: 'fixture' })).toThrow('Engine not ready');
    expect(calls).toBe(0);
  });
}
test('a custom endpoint URL cannot smuggle a credential into ordinary configuration', async () => {
  useEngineStore.setState({ status: 'ready' });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  for (const baseUrl of ['https://user:password@example.com/v1', 'https://example.com/v1?api_key=fixture', 'javascript:alert(1)'])
    await expect(addCustomProviderToEngine({ baseUrl, defaultModel: 'm' })).rejects.toThrow();
  expect(calls).toBe(0);
});

test('a credential acknowledgement from a replaced engine generation cannot publish as current', async () => {
  useEngineStore.setState({ status: 'ready', generation: 900 });
  let release!: (res: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(r => { release = r; })) as typeof fetch;
  const result = saveProviderKeyToEngine({ providerId: 'openai', apiKey: 'fixture' });
  // Let endpoint acquisition reach fetch, without replacing the fetch implementation.
  for (let i = 0; i < 20 && !release; i++) await new Promise(r => setTimeout(r, 1));
  useEngineStore.setState({ generation: 901 });
  release(Response.json({ ok: true, model: 'm', secretBackend: 'fixture' }));
  await expect(result).rejects.toThrow('Engine changed');
});
