import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const scenarios = [
  'stop-before-status', 'stop-late-mic', 'concurrent-start', 'late-start-ack',
  'restart-during-stop', 'overlapping-switch', 'stop-during-switch',
  'graph-failure-tracks', 'selected-device-failure', 'stop-during-decode',
  'tts-stop-during-decode', 'newer-tts-wins', 'stale-audio-failure',
  'stale-audio-success', 'engine-replaced', 'stale-event-headers',
  'stale-event-callback', 'hold-release-during-start', 'playback-graph-failure',
  'hold-start-failure', 'engine-ended', 'terminal-download-release', 'toggle-cancels-start',
];
for (const scenario of scenarios) {
  test(`voice session lifetime: ${scenario}`, () => {
    const res = Bun.spawnSync([process.execPath, 'run', './test/desktop/fixtures/voice-session.fixture.ts', scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 5000,
    });
    expect({ exit: res.exitCode, error: res.exitCode ? res.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(res.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
