import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { defaultVoiceSettings } from '../../../src/voice/types';
import { EngineHttpError } from '../../../desktop/src/engine/transport';
const scenario = process.argv[2];
const wait = () => new Promise(r => setTimeout(r, 0));
const deferred = () => { let resolve!: (v: any) => void; return { promise: new Promise<any>(r => { resolve = r; }), resolve: (v: any) => resolve(v) }; };
const gate = deferred();
const settings = { ...defaultVoiceSettings(), revision: 'r0', ttsVoice: 'old' };
let engine = { ...settings };
const calls: any[] = [];
mock.module('../../../desktop/src/voice/voiceApi', () => ({ voiceApi: {
  settingsGet: async () => ({ settings: engine }),
  settingsSet: async (patch: any, revision: string) => {
    calls.push({ patch, revision });
    if (['write-conflict', 'pending-conflict'].includes(scenario)) throw new EngineHttpError(409, '/voice/settings', { error: 'Voice settings changed elsewhere' });
    if (scenario === 'serial-writes' && calls.length === 1) await gate.promise;
    engine = { ...engine, ...patch, revision: `r${calls.length}`, desktop: { ...engine.desktop!, ...patch.desktop } };
    return { settings: engine };
  },
  status: async () => ['late-status', 'new-engine'].includes(scenario) ? gate.promise : ({ settings: engine }),
} }));
const { useEngineStore } = await import('../../../desktop/src/stores/engineStore');
const { useVoiceStore: store } = await import('../../../desktop/src/voice/voiceStore');
useEngineStore.setState({ status: 'ready' }); store.setState({ settings: settings as any });
if (scenario === 'serial-writes') {
  const first = store.getState().applySettings({ ttsVoice: 'one' });
  const second = store.getState().applySettings({ ttsSpeed: 1.2 });
  await wait(); assert.equal(calls.length, 1); gate.resolve({}); await Promise.all([first, second]);
  assert.deepEqual(calls.map(c => c.revision), ['r0', 'r1']); assert.equal(store.getState().settings?.ttsVoice, 'one');
} else if (scenario === 'late-status' || scenario === 'new-engine') {
  const old = store.getState().refreshStatus(); await wait();
  if (scenario === 'late-status') await store.getState().applySettings({ ttsVoice: 'new' });
  else { useEngineStore.setState({ generation: 8 }); store.setState({ settings: { ...settings, ttsVoice: 'new', revision: 'other-engine' } as any }); }
  gate.resolve({ settings }); await old; assert.equal(store.getState().settings?.ttsVoice, 'new');
  if (scenario === 'new-engine') assert.equal(store.getState().stale, true);
} else if (scenario === 'write-conflict') {
  engine = { ...engine, revision: 'r2', ttsVoice: 'other-window' };
  await assert.rejects(store.getState().applySettings({ ttsVoice: 'stale-choice' }));
  assert.equal(calls.length, 1); assert.equal(calls[0].revision, 'r0'); assert.equal(store.getState().settings?.ttsVoice, 'other-window');
} else {
  const prefs = await import('../../../desktop/src/voice/onboardingPreferences');
  await prefs.queueOnboardingVoice({ ttsVoice: 'offline-choice', ttsSpeed: 1.2, micSelected: null, noiseSuppression: true, wakeWordEnabled: false }, 'r0');
  engine = { ...engine, revision: 'r2', ttsVoice: 'other-window' };
  await store.getState().refreshStatus(); await store.getState().refreshStatus();
  assert.equal(calls.length, 1); assert.match(store.getState().preferenceError!, /conflict/);
  assert.equal(store.getState().settings?.ttsVoice, 'other-window'); assert.equal((await prefs.pendingOnboardingVoice())?.engineRevision, 'r0');
  await store.getState().resolvePendingPreferences(false); assert.equal(await prefs.pendingOnboardingVoice(), null);
}
console.log(JSON.stringify({ scenario, ok: true }));
