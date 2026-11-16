import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
const cases = {
  voice: ['unmount-without-os-speech', 'newer-preview-wins', 'stop-pending', 'stale-ended', 'download-error', 'download-not-installed', 'download-timeout', 'download-cancelled', 'download-status-error', 'download-voice-without-runtime', 'download-success', 'download-unmount', 'persist-speed'],
  mic: ['late-permission', 'stop-pending', 'selected-device', 'input-change', 'no-auto-permission', 'audio-context-error'],
};
for (const [kind, scenarios] of Object.entries(cases)) for (const scenario of scenarios) {
  test(`onboarding ${kind} lifetime: ${scenario}`, () => {
    const res = Bun.spawnSync([process.execPath, 'run', `./test/desktop/fixtures/${kind}-lifetime.fixture.tsx`, scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    expect({ exit: res.exitCode, error: res.exitCode ? res.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(res.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
