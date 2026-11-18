import { expect, test } from 'bun:test';
import { hasUsableProvider, localRuntimeUsable, providerIsUsable } from '../../desktop/src/engine/providerReadiness.ts';
import type { EngineModelsResponse, EngineProvider } from '../../desktop/src/engine/types.ts';

const local: EngineProvider = { id: 'ollama', label: 'Ollama', kind: 'local', hasKey: true,
  healthy: false, healthState: 'unknown', keyless: true };

test('a fresh keyless preset is not evidence of a running local model', () => {
  // /providers reports hasKey:true for auth:none even on a machine without Ollama.
  expect(providerIsUsable(local)).toBe(false);
  expect(hasUsableProvider([local])).toBe(false);
});

test('a local HTTP runtime with an empty model list is not an inference-ready model', () => {
  const current = { id: 'ollama', installed: true, running: true, models: [] } as unknown as EngineModelsResponse['current'];
  expect(localRuntimeUsable(current)).toBe(false);
  expect(localRuntimeUsable({ ...current!, models: [{ name: 'qwen2.5:3b' }] })).toBe(true);
});
