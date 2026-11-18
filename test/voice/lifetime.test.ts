import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceSession } from '../../src/daemon/routes/voice.routes.ts';
import { VoicePipeline } from '../../src/voice/pipeline.ts';
import { defaultVoiceSettings } from '../../src/voice/types.ts';

const deferred = <T = any>() => {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(r => { resolve = r; }), resolve };
};
const wait = () => new Promise(r => setTimeout(r, 0));
const stub = () => ({ audit() {}, recordCost() {}, workspaceId: 'voice-lifetime-test' }) as any;
const settings = () => ({ ...defaultVoiceSettings(), sttBackend: 'disabled' as const, ttsBackend: 'disabled' as const, bargeInCancelsRun: true });
const sessions: VoiceSession[] = [];
let previousHome: string | undefined, home: string;
beforeEach(() => { previousHome = process.env.XR_HOME; home = mkdtempSync(join(tmpdir(), 'xr-voice-owner-')); process.env.XR_HOME = home; });
afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
  if (previousHome === undefined) delete process.env.XR_HOME; else process.env.XR_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});
const session = () => { const s = new VoiceSession(stub(), settings()); sessions.push(s); s.start(); return s; };
const audio = { ok: true, engine: 'fixture', spokenText: 'reply', audio: new Uint8Array([1]) };
function pipeline(options: { stt?: () => Promise<any>; tts?: () => Promise<any>; listen?: () => Promise<Uint8Array>; play?: () => { stop(): void; done?: Promise<void> } } = {}) {
  let plays = 0;
  const p = new VoicePipeline({ store: stub(), settings: { ...settings(), ttsBackend: 'http' },
    stt: { transcribe: options.stt ?? (async () => ({ ok: true, text: 'confirm' })) } as any,
    tts: { speak: options.tts ?? (async () => audio) } as any,
    listen: options.listen, play: () => { plays++; return options.play?.() ?? { stop() {} }; },
  });
  return { p, plays: () => plays };
}

test('session stop discards a pending transcript before events, routing or state resurrection', async () => {
  const s = session(), gate = deferred(); let routed = 0;
  const events: any[] = []; s.subscribe(e => events.push(e));
  (s as any).transcribe = () => gate.promise;
  s.pipeline.processText = async () => { routed++; return { handled: true, reply: '' }; };
  const pending = (s as any).process(new Uint8Array()); s.stop();
  gate.resolve({ ok: true, text: 'old command', backend: 'fixture' }); await pending;
  expect(s.state).toBe('idle'); expect(routed).toBe(0); expect(events.some(e => e.type === 'final')).toBe(false);
});

test('an old process finalizer cannot release a restarted session current utterance', async () => {
  const s = session(), old = deferred(), newer = deferred();
  (s as any).transcribe = () => old.promise;
  const first = (s as any).process(new Uint8Array()); s.stop(); s.start();
  (s as any).transcribe = () => newer.promise;
  const second = (s as any).process(new Uint8Array());
  const owner = (s as any).busy;
  old.resolve({ ok: true, text: '', backend: 'fixture' }); await first;
  expect((s as any).busy).toBe(owner); expect(s.state).toBe('thinking');
  newer.resolve({ ok: true, text: '', backend: 'fixture' }); await second; expect(s.state).toBe('listening');
});

for (const action of ['stop', 'reconfigure'] as const) {
  test(`session ${action} discards already-started synthesis from the old pipeline`, async () => {
    const s = session(), gate = deferred(); const events: any[] = []; s.subscribe(e => events.push(e));
    (s.pipeline as any).settings.ttsBackend = 'http';
    (s.pipeline as any).deps.tts.speak = () => gate.promise;
    const speaking = s.say('old reply'); await wait();
    if (action === 'stop') s.stop(); else s.reconfigure({ ...settings(), ttsVoice: 'new-voice' });
    gate.resolve(audio); await speaking;
    expect(events.some(e => e.type === 'tts')).toBe(false);
    expect(s.state).toBe(action === 'stop' ? 'idle' : 'listening');
  });
}

test('hard session stop aborts the execution even when ordinary barge-in cancellation is disabled', () => {
  const s = session(); (s.pipeline as any).settings.bargeInCancelsRun = false;
  const ac = new AbortController(); (s.pipeline as any).runAbort = ac;
  s.stop(); expect(ac.signal.aborted).toBe(true);
});

test('callbacks from an old pipeline cannot publish phases after session restart', () => {
  const s = session(), old = s.pipeline as any;
  s.stop(); s.start(); old.deps.onPhase('tool'); expect(s.state).toBe('listening');
});

test('a prior semantic probe cannot assign its verdict to a newer probe', async () => {
  const s = session(), old = deferred(), newer = deferred();
  (s as any).stt.transcribe = () => old.promise; (s as any).probeSemantic();
  (s as any).semantic = null; (s as any).stt.transcribe = () => newer.promise; (s as any).probeSemantic();
  const owner = (s as any).semantic;
  old.resolve({ text: 'and' }); await wait(); expect(owner.verdict).toBeUndefined();
  newer.resolve({ text: 'This is complete.' }); await wait(); expect(owner.verdict).toBe('complete');
});

test('barge-in invalidates pending synthesis, not only an already playing source', async () => {
  const gate = deferred(); const { p, plays } = pipeline({ tts: () => gate.promise });
  const speaking = p.say('late reply'); p.bargeIn(); gate.resolve(audio); await speaking; expect(plays()).toBe(0);
});

test('a prior playback completion cannot clear a newer source owner', async () => {
  const completions = [deferred<void>(), deferred<void>()]; let stops = 0, index = 0;
  const { p } = pipeline({ play: () => ({ done: completions[index++].promise, stop() { stops++; } }) });
  await p.say('one'); await p.say('two'); completions[0].resolve(); await wait(); p.bargeIn();
  expect(stops).toBe(2); completions[1].resolve();
});

test('cancelled utterance transcription cannot dispatch a new command', async () => {
  const gate = deferred(); const { p } = pipeline({ stt: () => gate.promise }); let dispatched = 0;
  p.processText = async () => { dispatched++; return { handled: true, reply: '' }; };
  const work = p.processUtterance(new Uint8Array()); p.bargeIn(true);
  gate.resolve({ ok: true, text: 'old command' }); await work; expect(dispatched).toBe(0);
});

test('a pending spoken approval remains fail-closed after cancellation', async () => {
  const gate = deferred<Uint8Array>(); const { p } = pipeline({ listen: () => gate.promise });
  const approval = p.voiceApprover()({ tool: 'shell', reason: 'run a command' }); await wait(); p.bargeIn(true);
  gate.resolve(new Uint8Array([1])); expect(await approval).toBe(false);
});

test('cancellation while intent dispatch yields cannot start its fallback or reply', async () => {
  const { p, plays } = pipeline(); const result = p.processText('doctor'); p.bargeIn(true);
  expect(await result).toEqual({ handled: false, reply: '' }); expect(plays()).toBe(0);
});

test('discarding late speech does not erase the cost of work already billed', async () => {
  const s = session(), gate = deferred(); const costs: any[] = [], events: any[] = [];
  (s as any).store.recordCost = (...args: any[]) => costs.push(args); s.subscribe(e => events.push(e));
  (s.pipeline as any).settings.ttsBackend = 'http'; (s.pipeline as any).deps.tts.speak = () => gate.promise;
  const work = s.say('old billable reply'); s.stop(); gate.resolve({ ...audio, estimatedUsd: 0.01 }); await work;
  expect(costs.length).toBe(1); expect(events.some(e => e.type === 'tts')).toBe(false);
});

test('the research abort owner remains attached until the research promise settles', async () => {
  const { p } = pipeline(), gate = deferred(); let signal: AbortSignal | undefined;
  (p as any).runVoiceResearch = async (_topic: string, owner: AbortSignal) => { signal = owner; await gate.promise; return { handled: false, reply: '' }; };
  const work = p.processText('research distant planets'); await wait(); p.bargeIn(true);
  expect(signal?.aborted).toBe(true); gate.resolve(undefined); await work;
});
