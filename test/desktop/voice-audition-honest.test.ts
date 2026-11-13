/*
 * S-1 — the onboarding voice audition must be the voice you actually get.
 *
 * The wizard used to synthesise every sample with `speechSynthesis` and a
 * regex-matched OS voice while labelling the card "Ahmad · Piper kusal", then
 * saved that id as `ttsVoice`. The user heard A and was shipped B, and nothing
 * in the UI ever said so.
 *
 * The engine has always had the honest path: POST /voice/test-tts renders the
 * exact id with a real Piper model and returns `{wav, sampleRate}`, erroring
 * `voice-not-installed` (409) with the byte size when the model is missing.
 * These tests pin the wizard to that path and pin the fallback to being
 * labelled as a fallback.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('S-1 · voice audition is the engine voice', () => {
  const step = read('screens/Onboarding/StepVoice.tsx');

  test('the preview path calls the engine, not the OS speech engine', () => {
    expect(step).toContain('voiceApi.testTts');
    // The sample text and the selected id both go to the engine, so the audio
    // returned is that voice — not a lookalike.
    expect(step).toMatch(/testTts\([^)]*id[^)]*\)/);
  });

  test('a missing voice model is a visible state that names the download size', () => {
    expect(step).toContain("'voice-not-installed'");
    // The 409 body carries `bytes`; the copy must surface it in MB.
    expect(step).toContain('/ 1e6');
  });

  test('every fallback is labelled as a system stand-in, never as XR', () => {
    // Both degraded paths (missing model, unreachable engine) route through
    // the OS voice AND say so. `mode` drives the header copy.
    expect(step).toContain('previewWithOsVoice');
    expect(step).toMatch(/stand-in[\s\S]{0,120}system voice/i);
    expect(step).toMatch(/not XR/);
  });

  test('the preset ids are engine TTS ids, so the saved choice is the heard choice', () => {
    const models = readFileSync(
      join(resolve(import.meta.dir, '..', '..'), 'src', 'voice', 'models.ts'),
      'utf8',
    );
    for (const id of ['piper-kusal', 'piper-kristin', 'piper-ryan', 'piper-amy']) {
      expect(step).toContain(`id: '${id}'`);
      expect(models).toContain(id);
    }
  });
});

describe('S-1 · the route contract the wizard relies on', () => {
  const routes = readFileSync(
    join(resolve(import.meta.dir, '..', '..'), 'src', 'daemon', 'routes', 'voice.routes.ts'),
    'utf8',
  );
  const api = read('voice/voiceApi.ts');

  test('test-tts 409s with the byte size before spending a synthesis', () => {
    expect(routes).toContain('voice-not-installed');
    expect(routes).toMatch(/voice-not-installed[\s\S]{0,120}bytes: entryBytes/);
  });

  test('the response may carry no bytes — the desktop type says so', () => {
    // `preview()` returns `{ok:true, engine, detail}` when the host spoke
    // through its own system voice. Typing `wav` as required made every caller
    // assume bytes and crash on base64ToBytes(undefined).
    expect(api).toMatch(/wav\?:[\s\S]{0,200}\/voice\/test-tts'/);
  });

  test('the Settings preview handles the no-bytes success', () => {
    const sections = read('screens/Voice/components/sections.tsx');
    const idx = sections.indexOf('voiceApi.testTts');
    expect(idx).toBeGreaterThan(-1);
    expect(sections.slice(idx, idx + 400)).toContain('if (!res.wav)');
  });
});
