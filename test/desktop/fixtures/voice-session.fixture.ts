import '../helpers/dom-shim';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { defaultVoiceSettings } from '../../../src/voice/types';
import { EngineDown } from '../../../desktop/src/engine/transport';

const scenario = process.argv[2];
const deferred = () => {
  let resolve!: (v?: any) => void, reject!: (e: unknown) => void;
  return { promise: new Promise<any>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
};
const wait = () => new Promise(r => setTimeout(r, 0));
const g = globalThis as any;
g.location = { hash: '', pathname: '/' };
g.requestAnimationFrame = () => 1;
g.setInterval = () => 1;
g.clearInterval = () => {};
mock.module('sonner', () => ({ toast: Object.assign(() => {}, { error() {}, warning() {} }) }));
mock.module('../../../desktop/src/engine/approvals', () => ({ bridgeEngineApproval: async () => {} }));
mock.module('../../../desktop/src/lib/approvalEvents', () => ({ sendNotification() {}, decideApproval() {} }));
mock.module('../../../desktop/src/lib/orb', () => ({ orbSetState: async () => {} }));
mock.module('../../../desktop/src/lib/theater', () => ({ emitTheater() {} }));
mock.module('../../../desktop/src/lib/tauri', () => ({ isTauri: () => false }));
const readers: Array<{ payload: (s: string) => void; signal: AbortSignal }> = [];
mock.module('../../../desktop/src/engine/sse', () => ({ readSse: async (_r: Response, payload: (s: string) => void, signal: AbortSignal) => {
  readers.push({ payload, signal });
  await new Promise<void>(r => signal.aborted ? r() : signal.addEventListener('abort', () => r(), { once: true }));
} }));
const statusGate = deferred(), startGate = deferred(), stopGate = deferred(), audioGate = deferred(), headerGate = deferred();
const commands: string[] = [], eventSignals: AbortSignal[] = [], decoded: ReturnType<typeof deferred>[] = [], pcm: string[] = [];
let played = 0, starts = 0, stoppedSources = 0, connectedSources = 0, disconnectedNodes = 0;
let delayStart = scenario === 'late-start-ack', delayStop = false;
mock.module('../../../desktop/src/voice/voiceApi', () => ({ voiceApi: {
  session: async (action: string) => { commands.push(action); if (action === 'start' && delayStart) await startGate.promise; if (action === 'stop' && delayStop) await stopGate.promise; return { state: action === 'start' ? 'listening' : 'idle' }; },
  audio: async (bytes: string) => { pcm.push(bytes); return audioGate.promise; },
  played: async () => { played++; }, bargeIn: async () => {},
  events: async (signal: AbortSignal) => { eventSignals.push(signal); return scenario === 'stale-event-headers' && eventSignals.length === 1 ? headerGate.promise : new Response(''); },
} }));
const requests: Array<{ constraints: MediaStreamConstraints; gate: ReturnType<typeof deferred> }> = [];
let automaticMic = !['stop-late-mic', 'engine-replaced', 'hold-release-during-start', 'toggle-cancels-start'].includes(scenario);
const makeStream = (id: string) => {
  const track = { onended: null as null | (() => void), stops: 0, stop() { this.stops++; } };
  return { id, track, getTracks: () => [track], getAudioTracks: () => [track] };
};
const streams: ReturnType<typeof makeStream>[] = [];
Object.defineProperty(g, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async (constraints: MediaStreamConstraints) => {
  const gate = deferred(); requests.push({ constraints, gate });
  if (scenario === 'selected-device-failure') throw new DOMException('selected mic removed', 'NotFoundError');
  if (automaticMic) { const stream = makeStream(`mic-${streams.length}`); streams.push(stream); gate.resolve(stream); }
  return gate.promise;
} } } });
const node = () => ({ connect() {}, disconnect() { disconnectedNodes++; } });
const ctx: any = { state: 'running', sampleRate: 48000, destination: {},
  createMediaStreamSource() { connectedSources++; if (scenario === 'graph-failure-tracks') throw new Error('graph unavailable'); return node(); },
  createGain: () => ({ ...node(), gain: { value: 0 } }),
  createAnalyser: () => ({ ...node(), getFloatTimeDomainData(data: Float32Array) { data.fill(0); } }),
  createScriptProcessor: () => ({ ...node(), onaudioprocess: null }),
  decodeAudioData: async () => { const gate = deferred(); decoded.push(gate); return gate.promise; },
  createBufferSource: () => ({ ...node(), detune: { value: 0 }, onended: null, stop() { stoppedSources++; }, start() { if (scenario === 'playback-graph-failure') throw new Error('output unavailable'); starts++; } }),
};
g.AudioContext = class { constructor() { return ctx; } };
const { useEngineStore } = await import('../../../desktop/src/stores/engineStore');
const { useVoiceStore: store } = await import('../../../desktop/src/voice/voiceStore');
const { VoiceController } = await import('../../../desktop/src/voice/session');
const settings = { ...defaultVoiceSettings(), wakeSound: false, desktop: { ...defaultVoiceSettings().desktop!, micDeviceId: 'selected-input', activation: scenario.startsWith('hold-') ? 'hold' : 'tap' } };
const status = { settings, stt: { loaded: true } } as any;
useEngineStore.setState({ generation: 70, status: 'ready' });
store.setState({ settings: settings as any, refreshStatus: async () => scenario === 'stop-before-status' ? statusGate.promise : scenario === 'hold-start-failure' ? null : status });
const controller = new VoiceController(); const internal = controller as any;
const grant = (index: number) => { const stream = makeStream(`manual-${index}`); streams.push(stream); requests[index].gate.resolve(stream); return stream; };
const begin = async () => { assert.equal(await controller.start(), true); await wait(); };
const tts = (text = 'reply') => internal.onEvent({ type: 'tts', wav: 'AA==', text });

try {
  if (scenario === 'stop-before-status') {
    const task = controller.start(); await wait(); await controller.stop(); statusGate.resolve(status);
    assert.equal(await task, false); assert.equal(store.getState().active, false); assert.equal(requests.length, 0); assert.deepEqual(commands, []);
  } else if (['stop-late-mic', 'engine-replaced', 'toggle-cancels-start'].includes(scenario)) {
    const task = controller.start(); await wait();
    if (scenario === 'engine-replaced') useEngineStore.setState({ generation: 71 });
    else if (scenario === 'toggle-cancels-start') await controller.toggle(); else await controller.stop();
    const stream = grant(0); assert.equal(await task, false); assert.equal(stream.track.stops, 1); assert.equal(connectedSources, 0); assert.deepEqual(commands, []);
  } else if (scenario === 'concurrent-start') {
    const one = controller.start(), two = controller.start(); assert.deepEqual(await Promise.all([one, two]), [true, true]);
    assert.equal(requests.length, 1); assert.deepEqual(commands, ['start']);
  } else if (scenario === 'late-start-ack') {
    const task = controller.start(); await wait(); const stopped = controller.stop(); await wait();
    assert.deepEqual(commands, ['start']); delayStart = false; startGate.resolve(); await Promise.all([task, stopped]);
    assert.equal(await task, false); assert.deepEqual(commands, ['start', 'stop']); assert.equal(store.getState().active, false);
  } else if (scenario === 'restart-during-stop') {
    await begin(); delayStop = true; const stopped = controller.stop(); await wait(); const next = controller.start(); await wait();
    assert.deepEqual(commands, ['start', 'stop']); delayStop = false; stopGate.resolve(); await stopped; assert.equal(await next, true);
    assert.deepEqual(commands, ['start', 'stop', 'start']); assert.equal(store.getState().sessionState, 'listening');
  } else if (scenario === 'overlapping-switch' || scenario === 'stop-during-switch') {
    await begin(); automaticMic = false; const one = controller.switchDevice('one'); await wait();
    if (scenario === 'overlapping-switch') {
      const two = controller.switchDevice('two'); await wait(); const newest = grant(2); await two; const stale = grant(1); await one;
      assert.equal(internal.mic.stream, newest); assert.equal(stale.track.stops, 1); assert.equal(store.getState().active, true);
    } else {
      await controller.stop(); const stale = grant(1); await one; assert.equal(stale.track.stops, 1); assert.equal(internal.mic, null);
    }
  } else if (scenario === 'graph-failure-tracks' || scenario === 'selected-device-failure') {
    let error: unknown; let result: boolean | undefined;
    try { result = await controller.start(); } catch (e) { error = e; }
    assert.equal(error, undefined); assert.equal(result, false); assert.equal(store.getState().active, false); assert.deepEqual(commands, []);
    if (scenario === 'graph-failure-tracks') assert.equal(streams[0].track.stops, 1);
    else { assert.equal(requests.length, 1); assert.deepEqual((requests[0].constraints.audio as MediaTrackConstraints).deviceId, { exact: 'selected-input' }); }
  } else if (['stop-during-decode', 'tts-stop-during-decode', 'newer-tts-wins', 'playback-graph-failure'].includes(scenario)) {
    await begin(); tts('old'); await wait(); assert.equal(decoded.length, 1);
    if (scenario === 'stop-during-decode') await controller.stop();
    else if (scenario === 'tts-stop-during-decode') internal.onEvent({ type: 'tts_stop' });
    else if (scenario === 'newer-tts-wins') { tts('new'); await wait(); decoded[1].resolve({ duration: 1 }); await wait(); }
    decoded[0].resolve({ duration: 1 }); await wait();
    assert.equal(starts, scenario === 'newer-tts-wins' ? 1 : 0);
    if (scenario !== 'playback-graph-failure') assert.equal(played, 0);
    else { assert.ok(store.getState().error); assert.ok(disconnectedNodes >= 2); }
    if (scenario === 'newer-tts-wins') assert.equal(stoppedSources, 0);
  } else if (scenario.startsWith('stale-audio-')) {
    await begin(); internal.pending.push(new Int16Array([1])); internal.flush(); assert.equal(pcm.length, 1);
    await controller.stop(); await begin(); internal.sendFailures = 3;
    if (scenario === 'stale-audio-failure') audioGate.reject(new EngineDown('unreachable')); else audioGate.resolve({ ok: true });
    await wait(); assert.equal(store.getState().active, true); assert.equal(store.getState().error, null); assert.equal(internal.sendFailures, 3);
  } else if (scenario.startsWith('stale-event-')) {
    const release = controller.retain(); await wait(); release(); const releaseNew = controller.retain(); await wait();
    if (scenario === 'stale-event-headers') {
      assert.equal(readers.length, 1); headerGate.resolve(new Response('')); await wait(); assert.equal(readers.length, 1);
    } else {
      assert.equal(readers.length, 2); await begin(); readers[0].payload(JSON.stringify({ type: 'error', detail: 'old-stream', message: 'stale stream' }));
      assert.equal(store.getState().error, null);
    }
    assert.equal(store.getState().connected, true); releaseNew();
  } else if (scenario === 'hold-start-failure') {
    await controller.pressStart(); assert.equal(store.getState().active, false); assert.equal(store.getState().pressed, false);
  } else if (scenario === 'engine-ended') {
    await begin(); internal.onEvent({ type: 'state', state: 'idle' });
    assert.equal(store.getState().active, false); assert.equal(streams[0].track.stops, 1); assert.deepEqual(commands, ['start']);
  } else if (scenario === 'terminal-download-release') {
    const release = controller.retain(); await wait(); store.setState({ downloadBusy: true }); release();
    assert.equal(eventSignals[0].aborted, false);
    readers[0].payload(JSON.stringify({ type: 'download', component: 'tts', id: 'voice', status: 'done' }));
    assert.equal(eventSignals[0].aborted, true);
  } else if (scenario === 'hold-release-during-start') {
    const pressed = controller.pressStart(); await wait(); controller.pressEnd(); grant(0); await pressed;
    assert.equal(store.getState().active, true); assert.equal(store.getState().pressed, false); assert.equal(store.getState().muted, true);
  } else throw new Error(`Unknown scenario: ${scenario}`);
} finally {
  await controller.stop();
}
console.log(JSON.stringify({ scenario, ok: true }));
