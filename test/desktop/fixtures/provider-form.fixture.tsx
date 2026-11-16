import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';

// One React dispatcher, including imports resolved from desktop/node_modules.
mock.module('react', () => ({ ...React, default: React }));
mock.module('../../../desktop/node_modules/react/index.js', () => ({ ...React, default: React }));
const box = ({ children, ...props }: any) => React.createElement('div', props, children);
mock.module('../../../desktop/src/components/ui/dialog', () => ({ Dialog: box, DialogContent: box, DialogDescription: box, DialogFooter: box, DialogTitle: box }));
// Keep the renderer out of native/portal/toast infrastructure, not out of the form logic.
mock.module('../../../desktop/src/components/ui/button', () => ({ Button: ({ children, ...p }: any) => React.createElement('button', p, children) }));
mock.module('../../../desktop/src/components/ui/input', () => ({ Input: (p: any) => React.createElement('input', p) }));
mock.module('sonner', () => ({ toast: Object.assign(() => {}, { warning() {}, success() {}, error() {} }) }));
const calls: { register: any[]; defaults: any[]; probe: any[]; legacy: any[]; saves: any[] } = { register: [], defaults: [], probe: [], legacy: [], saves: [] };
const scenario = process.argv[2];
const edit = scenario === 'edit' || scenario === 'rotate';
const { useEngineStore } = await import('../../../desktop/src/stores/engineStore');
const { requireEngineReady } = await import('../../../desktop/src/engine/providers');
mock.module('../../../desktop/src/engine/providers', () => ({
  requireEngineReady,
  engineKnowsProvider: () => true,
  sampleExchangeUsd: () => null,
  saveProviderKeyToEngine: async () => { throw new Error('custom endpoints must not use preset credential saving'); },
  pingEngineLocalModel: async () => { throw new Error('not a local runtime'); },
  addCustomProviderToEngine: async (input: any) => {
    calls.register.push(input);
    if (scenario === 'register-rejected') throw new Error('secret backend refused');
    return { ok: true, provider: { id: input.id ?? 'ack-provider', label: 'Saved endpoint', baseUrl: input.baseUrl, defaultModel: input.defaultModel, apiKeyEnv: input.apiKey || edit ? 'FIXTURE_KEY' : null, keyed: Boolean(input.apiKey || edit) } };
  },
  setEngineDefault: async (...args: any[]) => { calls.defaults.push(args); if (scenario === 'selection-failure') throw new Error('default selection refused'); },
  probeEngineProvider: async (...args: any[]) => { calls.probe.push(args); return { ok: true, providerId: 'ack-provider', model: 'owner/model', inferenceVerified: false, latencyMs: 2, detail: 'models endpoint OK' }; },
}));
mock.module('../../../desktop/src/lib/settingsApi', () => ({ testProviderConnection: async (...args: any[]) => { calls.legacy.push(args); return { ok: true, models: [], latencyMs: 1, message: 'wrong authority' }; } }));
const { create, act } = await import('react-test-renderer');
useEngineStore.setState({ status: scenario === 'offline' ? 'disconnected' : scenario === 'degraded' ? 'degraded' : 'ready' });
const { ProviderConfigModal } = await import('../../../desktop/src/components/settings/ProviderConfigModal');
const entry = { id: edit ? 'my-api' : 'custom', name: 'My endpoint', kind: 'custom' as const, baseUrl: '', tagline: 'Compatible API' };
let view: ReturnType<typeof create>;
await act(async () => { view = create(React.createElement(ProviderConfigModal, { entry, existing: edit ? { id: 'my-api', name: 'My endpoint', kind: 'custom', baseUrl: 'https://example.com/v1', model: 'owner/model', keyStorage: 'engine', addedAt: 1 } as any : null, open: true, onOpenChange() {}, onSave: (v: any) => calls.saves.push(v), onRemove: async () => {} })); });
const input = (id: string, value: string) => act(() => view.root.findByProps({ id }).props.onChange({ target: { value } }));
input('xr-provider-base', scenario === 'invalid-url' ? 'javascript:alert(1)' : 'https://example.com/v1');
input('xr-provider-model', 'owner/model');
if (!['keyless', 'edit'].includes(scenario)) input('xr-provider-key', 'fixture-provider-secret');
if (scenario === 'selection-failure') {
  const checkbox = view.root.findAllByType('input').find(n => n.props.type === 'checkbox');
  assert.ok(checkbox, 'custom form must offer engine-default selection');
  act(() => checkbox.props.onChange({ target: { checked: true } }));
}
const button = view.root.findAllByType('button').find(n => n.props.children === (scenario === 'test-through-engine' ? 'Save & test endpoint' : 'Save'));
assert.ok(button, 'expected an explicitly labelled engine action');
if (['keyed', 'keyless', 'edit', 'rotate'].includes(scenario)) assert.equal(button.props.disabled, false);
await act(async () => { button.props.onClick(); await new Promise(r => setTimeout(r, 0)); });
if (['invalid-url', 'offline', 'degraded'].includes(scenario)) {
  assert.equal(calls.register.length, 0); assert.equal(calls.saves.length, 0);
} else if (scenario === 'register-rejected') {
  assert.equal(calls.register.length, 1); assert.equal(calls.saves.length, 0);
} else {
  assert.equal(calls.register.length, 1, 'must register through the engine');
  assert.equal(calls.register[0].defaultModel, 'owner/model');
  assert.equal(calls.register[0].id, edit ? 'my-api' : undefined);
  if (scenario === 'selection-failure') { assert.equal(calls.defaults.length, 1); assert.equal(calls.saves.length, 0); }
  else if (scenario === 'test-through-engine') { assert.equal(calls.probe.length, 1); assert.equal(calls.legacy.length, 0); }
  else {
    assert.equal(calls.saves.length, 1); assert.equal(calls.saves[0].id, edit ? 'my-api' : 'ack-provider');
    assert.equal(calls.saves[0].model, 'owner/model'); assert.equal(calls.saves[0].apiKey, null);
    assert.ok(!JSON.stringify(calls.saves).includes('fixture-provider-secret'));
  }
}
await act(async () => { view.unmount(); });
console.log(JSON.stringify({ scenario, ok: true }));
