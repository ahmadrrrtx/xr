import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
mock.module('react', () => ({ ...React, default: React }));
mock.module('../../../desktop/node_modules/react/index.js', () => ({ ...React, default: React }));
const box = ({ children }: any) => React.createElement('div', null, children);
mock.module('../../../desktop/src/components/settings/primitives', () => ({ SettingsSection: box, SettingRow: box }));
mock.module('../../../desktop/src/components/settings/controls', () => ({ Select: (p: any) => React.createElement('select', { ...p, 'aria-label': p.ariaLabel }), LabeledSlider: (p: any) => React.createElement('input', { ...p, 'aria-label': p.label }), Segmented: () => null, Toggle: () => null }));
mock.module('../../../desktop/src/components/ui/button', () => ({ Button: (p: any) => React.createElement('button', p) }));
mock.module('../../../desktop/src/screens/Voice/components/shared', () => ({ PermissionCard: () => null }));
mock.module('sonner', () => ({ toast: Object.assign(() => {}, { info() {}, error() {} }) }));
const scenario = process.argv[2];
const deferred = () => { let resolve!: (v: any) => void; return { promise: new Promise<any>(r => { resolve = r; }), resolve: (v: any) => resolve(v) }; };
const g = globalThis as any; const realTimeout = setTimeout;
g.setTimeout = ((fn: any, ms: number, ...args: any[]) => realTimeout(fn, [350, 3000].includes(ms) ? 2 : ms, ...args)) as typeof setTimeout;
const wait = (ms = 0) => new Promise(r => realTimeout(r, ms));
const permission = deferred(), decoded = deferred();
let stops = 0, connected = 0, played = 0;
const constraints: any[] = [], tts: Array<ReturnType<typeof deferred>> = [];
Object.defineProperty(g, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async (c: any) => { constraints.push(c); return permission.promise; } } } });
const ctx: any = { state: 'running', destination: {}, sampleRate: 48000,
  createMediaStreamSource() { connected++; if (scenario === 'mic-graph-error') throw new Error('graph unavailable'); return { connect() {}, disconnect() {} }; },
  createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }), createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
  decodeAudioData: async () => scenario === 'tts-late-decode' ? decoded.promise : ({}),
  createBufferSource: () => ({ detune: { value: 0 }, connect() {}, disconnect() {}, stop() {}, start() { played++; }, onended: null }),
};
mock.module('../../../desktop/src/voice/session', () => ({ voice: { ensureContext: () => ctx }, probeMicrophones: async () => {} }));
mock.module('../../../desktop/src/voice/voiceApi', () => ({ voiceApi: {
  testTts: async () => { const task = deferred(); tts.push(task); return task.promise; }, transcribe: async () => ({ ok: true, text: 'fixture' }),
} }));
const { useEngineStore } = await import('../../../desktop/src/stores/engineStore');
const { useVoiceStore } = await import('../../../desktop/src/voice/voiceStore');
const { defaultVoiceSettings } = await import('../../../src/voice/types');
useVoiceStore.setState({ settings: { ...defaultVoiceSettings(), desktop: { ...defaultVoiceSettings().desktop!, micDeviceId: 'input-two' } } as any,
  voices: [{ id: 'default', kind: 'offline', label: 'Fixture', gender: 'male', accent: 'en', detail: '', bytes: 1, installed: true, downloadable: true }], status: { stt: { loaded: true } } as any });
const { create, act } = await import('react-test-renderer');
const { MicrophoneSection, SttSection, TtsSection } = await import('../../../desktop/src/screens/Voice/components/sections');
let view: ReturnType<typeof create>;
await act(async () => { view = create(React.createElement(scenario.startsWith('mic-') ? MicrophoneSection : scenario.startsWith('stt-') ? SttSection : TtsSection)); });
const click = (id: string) => act(() => view.root.findByProps({ 'data-testid': id }).props.onClick());
const grant = () => permission.resolve({ getTracks: () => [{ stop() { stops++; } }] });
if (scenario.startsWith('tts-')) {
  click('voice-tts-preview');
  if (scenario === 'tts-unmount-debounce') { await act(async () => { view.unmount(); await wait(12); }); assert.equal(tts.length, 0); }
  else {
    await act(async () => { await wait(8); }); assert.equal(tts.length, 1);
    if (scenario === 'tts-new-engine') act(() => useEngineStore.setState({ generation: 888 }));
    if (scenario === 'tts-late-decode') { await act(async () => { tts[0].resolve({ ok: true, wav: 'AA==' }); await wait(); }); }
    if (scenario === 'tts-newer-wins') {
      click('voice-tts-preview'); click('voice-tts-preview'); await act(async () => { await wait(8); });
      assert.equal(tts.length, 2); await act(async () => { tts[1].resolve({ ok: true, wav: 'AA==' }); await wait(); });
      await act(async () => { tts[0].resolve({ ok: true, wav: 'AA==' }); await wait(); }); assert.equal(played, 1);
    } else {
      await act(async () => { view.unmount(); });
      await act(async () => { tts[0].resolve({ ok: true, wav: 'AA==' }); decoded.resolve({}); await wait(); }); assert.equal(played, 0);
    }
  }
} else {
  click(scenario.startsWith('mic-') ? 'voice-test-mic' : 'voice-test-stt');
  if (scenario.endsWith('late-permission')) await act(async () => { view.unmount(); });
  if (scenario.endsWith('new-engine')) act(() => useEngineStore.setState({ generation: 888 }));
  if (scenario === 'mic-stop-pending') click('voice-test-mic');
  await act(async () => { grant(); await wait(scenario === 'stt-selected-device' ? 8 : 0); });
  if (scenario.endsWith('late-permission') || scenario === 'mic-stop-pending' || scenario.endsWith('new-engine')) { assert.equal(stops, 1); assert.equal(connected, 0); }
  else if (scenario === 'mic-graph-error') assert.equal(stops, 1);
  else if (scenario === 'stt-selected-device') assert.deepEqual(constraints[0].audio.deviceId, { exact: 'input-two' });
  else { await act(async () => { view.unmount(); }); assert.equal(stops, 1); }
}
await act(async () => { view.unmount(); });
console.log(JSON.stringify({ scenario, ok: true }));
