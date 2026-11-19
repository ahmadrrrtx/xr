import { expect, test } from 'bun:test';
import { VoiceDownloads, type VoiceBundleProgress } from '../../src/voice/downloads.ts';
import type { DownloadProgress, VoiceModelEntry } from '../../src/voice/models.ts';
const entry = (id: string): VoiceModelEntry => ({ id, component: 'stt', name: id, dir: id, detail: '', files: [{ path: 'model', url: 'https://fixture.invalid/model', bytes: 10 }] });
const pending = () => { let resolve!: (p: DownloadProgress) => void; return { promise: new Promise<DownloadProgress>(r => { resolve = r; }), resolve: (p: DownloadProgress) => resolve(p) }; };
const done = (id: string): DownloadProgress => ({ id, component: 'stt', received: 10, total: 10, percent: 100, status: 'done' });
test('a bundle is busy before headers, between entries, and retains its terminal evidence', async () => {
  const parts = [pending(), pending()]; let calls = 0;
  const events: VoiceBundleProgress[] = [];
  const d = new VoiceDownloads(p => events.push(p), { cancel() {}, download: async (_e, emit) => { const out = await parts[calls++].promise; emit(out); return out; } });
  const run = d.start([entry('one'), entry('two')]);
  if (!run.started) throw new Error('expected admission');
  expect(d.busy()).toBe(true); expect(d.current()?.status).toBe('downloading');
  // B15 — a concurrent start is refused with a typed result, never a thrown 'download-busy'.
  expect(d.start([entry('three')])).toMatchObject({ started: false, reason: 'busy' });
  parts[0].resolve(done('one')); await new Promise(r => setTimeout(r, 0));
  expect(d.busy()).toBe(true); expect(d.current()?.id).toBe('two');
  expect(events.some(p => p.status === 'done')).toBe(false);
  parts[1].resolve(done('two')); await run.done;
  expect(d.busy()).toBe(false); expect(d.current()?.status).toBe('done'); expect(d.current()?.bundleReceived).toBe(20);
});
test('cancelling at an entry boundary prevents the next entry and remains observable', async () => {
  let calls = 0; let d: VoiceDownloads;
  d = new VoiceDownloads(p => { if (p.received === 10) d.cancel(); }, { cancel() {}, download: async (_e, emit) => { calls++; const out = done('one'); emit(out); return out; } });
  const run = d.start([entry('one'), entry('two')]); if (run.started) await run.done;
  expect(calls).toBe(1); expect(d.current()?.status).toBe('cancelled'); expect(d.busy()).toBe(false);
});
test('download failures survive completion of the detached worker for polling clients', async () => {
  const d = new VoiceDownloads(() => {}, { cancel() {}, download: async () => ({ ...done('one'), status: 'error', detail: 'fixture error' }) });
  const run = d.start([entry('one'), entry('two')]); if (run.started) await run.done;
  expect(d.current()?.status).toBe('error'); expect(d.current()?.detail).toBe('fixture error');
});
