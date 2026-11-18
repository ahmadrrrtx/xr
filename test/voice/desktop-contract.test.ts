/** The actual desktop mapping must survive the engine's actual sanitizer. */
import { expect, test } from 'bun:test';
import { engineModeFor } from '../../desktop/src/voice/audio.ts';
import { sanitizeVoicePatch } from '../../src/voice/settings.ts';

for (const [activation, wake, expected] of [
  ['hold', false, 'push-to-talk'], ['tap', true, 'push-to-talk'],
  ['always', true, 'wake-word'], ['always', false, 'always-listen'],
] as const) {
  test(`${activation}/${wake} maps to an engine-accepted mode`, () => {
    const mapped = engineModeFor(activation, wake);
    expect(mapped).toBe(expected);
    expect(sanitizeVoicePatch({ mode: mapped }).mode).toBe(expected);
  });
}

test('noise suppression is a canonical top-level setting, not an unrecognized desktop field', () => {
  expect(sanitizeVoicePatch({ noiseSuppression: false }).noiseSuppression).toBe(false);
});
