import { afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeHandler } from '../../src/daemon/server';
import { Store } from '../../src/state/workspace-store';
import { loadConfig, saveConfig } from '../../src/config/config';
import { getVoiceSettings, patchVoiceSettings, recordVoiceTest } from '../../src/voice/settings';
const original = loadConfig().config.voice;
const store = new Store(join(mkdtempSync(join(tmpdir(), 'xr-voice-cas-')), 'state.db'));
const handler = makeHandler(store, 'voice-revision-fixture');
afterAll(() => { const c = loadConfig().config; c.voice = original; saveConfig(c); store.close(); });
const call = (body?: unknown, auth = true) => handler(new Request('http://127.0.0.1/api/v1/voice/settings', {
  method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer voice-revision-fixture' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}));
test('two windows with the same revision cannot silently replace each other', async () => {
  const before = await (await call()).json() as any;
  expect(typeof before.settings.revision).toBe('string');
  const responses = await Promise.all([
    call({ expectedRevision: before.settings.revision, ttsVoice: 'piper-amy' }),
    call({ expectedRevision: before.settings.revision, ttsVoice: 'piper-ryan' }),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const winner = await responses.find(r => r.status === 200)!.json() as any;
  const conflict = await responses.find(r => r.status === 409)!.json() as any;
  expect(conflict.revision).toBe(winner.settings.revision);
  expect((await (await call()).json() as any).settings.ttsVoice).toBe(winner.settings.ttsVoice);
  expect(loadConfig().config.voice.revision).toBeUndefined(); // computed, not another settings store
});
test('missing revision and anonymous writes fail closed; config/CLI changes invalidate the previous revision', async () => {
  const before = getVoiceSettings();
  expect([400, 428]).toContain((await call({ ttsSpeed: 1.2 })).status);
  expect((await call({ expectedRevision: before.revision, ttsSpeed: 1.2 }, false)).status).toBe(401);
  expect(getVoiceSettings().revision).toBe(before.revision);
  recordVoiceTest({ ok: true, at: new Date().toISOString() });
  expect(getVoiceSettings().revision).toBe(before.revision); // diagnostics are not competing user intent
  patchVoiceSettings({ noiseSuppression: !before.noiseSuppression });
  expect((await call({ expectedRevision: before.revision, ttsSpeed: 1.2 })).status).toBe(409);
});
