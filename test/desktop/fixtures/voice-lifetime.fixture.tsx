import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
mock.module('react', () => ({ ...React, default: React }));
mock.module('../../../desktop/node_modules/react/index.js', () => ({ ...React, default: React }));
const box = ({ children }: any) => React.createElement('div', null, children);
mock.module('../../../desktop/src/screens/Onboarding/parts', () => ({
  Reveal: box, StepHeader: ({ title, sub }: any) => React.createElement('header', null, title, sub),
  OptionCard: ({ right, onClick, ariaLabel }: any) => React.createElement('div', { onClick, 'aria-label': ariaLabel }, right),
}));
const scenario = process.argv[2];
const g = globalThis as any;
if (scenario !== 'unmount-without-os-speech') g.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() {} };
else delete g.speechSynthesis;
g.SpeechSynthesisUtterance = class { constructor(public text: string) {} };
const played: string[] = [];
const audio: any[] = [];
g.Audio = class {
  onended: (() => void) | null = null; onerror: (() => void) | null = null; paused = false;
  constructor(public src: string) { audio.push(this); }
  async play() { played.push(this.src.split(',')[1]); }
  pause() { this.paused = true; }
  removeAttribute() {} load() {}
};
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { resolve, promise }; };
const downloadGate = deferred();
const requests: Array<{ id: string; task: ReturnType<typeof deferred>; signal?: AbortSignal }> = [];
const { EngineHttpError } = await import('../../../desktop/src/engine/transport');
const realTimeout = globalThis.setTimeout;
g.setTimeout = ((fn: any, ms: number, ...args: any[]) => realTimeout(fn, ms === 1000 ? 0 : ms, ...args)) as typeof setTimeout;
const { withinDeadline, ...deadline } = await import('../../../desktop/src/engine/deadline');
mock.module('../../../desktop/src/engine/deadline', () => ({ ...deadline, withinDeadline: (fn: any, ms: number, signal?: AbortSignal) => withinDeadline(fn, ms >= 600_000 ? 15 : ms, signal) }));
mock.module('../../../desktop/src/voice/voiceApi', () => ({ voiceApi: {
  testTts: async (_text: string, id: string, _speed?: number, options?: { signal?: AbortSignal }) => {
    if (scenario.startsWith('download-') && requests.length === 0) {
      const task = deferred(); requests.push({ id, task });
      throw new EngineHttpError(409, '/voice/test-tts', { error: 'voice-not-installed', bytes: 1000000 });
    }
    const task = deferred(); requests.push({ id, task, signal: options?.signal }); return task.promise;
  },
  download: async () => ({ started: [{ id: 'piper-kusal' }], bytes: 1000000 }),
  status: async () => {
    if (scenario === 'download-timeout') return new Promise(() => {});
    if (scenario === 'download-unmount') return downloadGate.promise;
    if (scenario === 'download-status-error') throw new Error('fixture status failed');
    return { download: scenario === 'download-error' ? { status: 'error' } : scenario === 'download-cancelled' ? { status: 'cancelled' } : null };
  },
  voices: async () => ({ voices: [{ id: 'piper-kusal', installed: ['download-success', 'download-voice-without-runtime'].includes(scenario) }] }),
  models: async () => ({ runtime: { installed: scenario !== 'download-voice-without-runtime' }, espeak: { installed: true } }),
} }));
const { create, act } = await import('react-test-renderer');
const { useOnboardingStore } = await import('../../../desktop/src/stores/onboarding');
const { StepVoice } = await import('../../../desktop/src/screens/Onboarding/StepVoice');
let view: ReturnType<typeof create>;
await act(async () => { view = create(React.createElement(StepVoice)); });
const preview = (name: string) => act(() => view.root.findByProps({ 'aria-label': `Preview ${name} voice` }).props.onClick({ stopPropagation() {} }));
const settle = async (index: number, wav: string) => act(async () => { requests[index].task.resolve({ ok: true, wav, engine: 'fixture' }); await new Promise(r => realTimeout(r, 0)); });
if (scenario === 'persist-speed') {
  act(() => view.root.findByProps({ id: 'voice-speed' }).props.onChange({ target: { value: '1.25' } }));
  assert.equal(useOnboardingStore.getState().ttsSpeed, 1.25);
} else if (scenario.startsWith('download-')) {
  await act(async () => { preview('Ahmad'); await new Promise(r => realTimeout(r, 0)); });
  const download = view.root.findAllByType('button').find(n => n.children.some(c => typeof c === 'string' && c.includes('Download voice')));
  assert.ok(download);
  await act(async () => { download.props.onClick(); await new Promise(r => realTimeout(r, scenario === 'download-unmount' ? 3 : 45)); });
  if (scenario === 'download-unmount') {
    await act(async () => { view.unmount(); downloadGate.resolve({ download: null }); await new Promise(r => realTimeout(r, 0)); });
    assert.equal(requests.length, 1); assert.equal(played.length, 0);
  } else if (scenario === 'download-success') {
    assert.equal(requests.length, 2, 'installed voice re-auditions'); await settle(1, 'installed'); assert.deepEqual(played, ['installed']);
  } else {
    assert.equal(requests.length, 1, 'a failed, absent or timed-out download cannot auto-audition');
    assert.match(JSON.stringify(view.toJSON()), /failed|not installed|not install|timed out|deadline|cancelled/i);
  }
} else {
  preview('Ahmad');
  if (scenario === 'unmount-without-os-speech') {
    await act(async () => { view.unmount(); }); await settle(0, 'old'); assert.equal(played.length, 0);
  } else if (scenario === 'stop-pending') {
    preview('Ahmad'); assert.ok(requests[0].signal?.aborted); await settle(0, 'old'); assert.equal(played.length, 0);
  } else if (scenario === 'newer-preview-wins') {
    preview('Nova'); assert.ok(requests[0].signal?.aborted); await settle(1, 'new'); await settle(0, 'old'); assert.deepEqual(played, ['new']);
  } else {
    await settle(0, 'old'); const ended = audio[0].onended;
    preview('Nova'); await settle(1, 'new'); act(() => ended?.());
    assert.ok(view.root.findByProps({ 'aria-label': 'Preview Nova voice' }).props.className.includes('bg-accent text-accent-contrast'));
  }
}
await act(async () => { view.unmount(); });
console.log(JSON.stringify({ scenario, ok: true }));
