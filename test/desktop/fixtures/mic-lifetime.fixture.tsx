import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
mock.module('react', () => ({ ...React, default: React }));
mock.module('../../../desktop/node_modules/react/index.js', () => ({ ...React, default: React }));
const box = ({ children }: any) => React.createElement('div', null, children);
mock.module('../../../desktop/src/screens/Onboarding/parts', () => ({ Reveal: box, StepHeader: box, Toggle: () => null }));
const scenario = process.argv[2];
const g = globalThis as any;
let grant!: (stream: any) => void;
const permission = new Promise<any>(r => { grant = r; });
let stops = 0, contexts = 0;
const calls: MediaStreamConstraints[] = [];
Object.defineProperty(g, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async (args: MediaStreamConstraints) => { calls.push(args); return permission; } } } });
g.AudioContext = class {
  constructor() { contexts++; if (scenario === 'audio-context-error') throw new Error('context unavailable'); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 512, getFloatTimeDomainData(a: Float32Array) { a.fill(0); } }; }
  async close() {}
};
g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
const detections: boolean[] = [];
mock.module('../../../desktop/src/lib/detect', () => ({ detectMics: async (requestPermission: boolean) => { detections.push(requestPermission); return { devices: [{ id: 'input-two', label: 'Second mic' }], permission: 'granted' }; } }));
const { create, act } = await import('react-test-renderer');
const { useOnboardingStore } = await import('../../../desktop/src/stores/onboarding');
useOnboardingStore.setState({ micSelected: 'input-two', mics: scenario === 'no-auto-permission' ? null : { devices: [{ id: 'input-two', label: 'Second mic' }], permission: 'granted' } });
const { StepMicSetup } = await import('../../../desktop/src/screens/Onboarding/StepMicSetup');
let view: ReturnType<typeof create>;
await act(async () => { view = create(React.createElement(StepMicSetup)); });
if (scenario === 'no-auto-permission') {
  assert.deepEqual(detections, [false], 'entering the step must not request microphone permission');
} else {
  act(() => view.root.findAllByType('button')[0].props.onClick());
  if (scenario === 'late-permission') await act(async () => { view.unmount(); });
  if (scenario === 'stop-pending') act(() => view.root.findAllByType('button')[0].props.onClick());
  await act(async () => { grant({ getTracks: () => [{ stop: () => { stops++; } }] }); await new Promise(r => setTimeout(r, 0)); });
  if (scenario === 'late-permission' || scenario === 'stop-pending') { assert.equal(contexts, 0); assert.equal(stops, 1); assert.equal(calls.length, 1); }
  else if (scenario === 'selected-device') assert.deepEqual((calls[0].audio as MediaTrackConstraints).deviceId, { exact: 'input-two' });
  else if (scenario === 'input-change') {
    act(() => view.root.findByType('select').props.onChange({ target: { value: 'input-three' } }));
    assert.equal(stops, 1, 'changing device stops the previous input');
  } else assert.equal(stops, 1, 'a failed AudioContext must release the granted stream');
}
await act(async () => { view.unmount(); });
console.log(JSON.stringify({ scenario, ok: true }));
