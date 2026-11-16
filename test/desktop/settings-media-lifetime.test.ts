import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
for (const scenario of ['mic-late-permission', 'mic-stop-pending', 'mic-graph-error', 'stt-late-permission', 'stt-selected-device', 'stt-unmount-recording', 'tts-unmount-debounce', 'tts-late-engine', 'tts-late-decode', 'tts-newer-wins', 'mic-new-engine', 'stt-new-engine', 'tts-new-engine']) {
  test(`Settings media lifetime: ${scenario}`, () => {
    const res = Bun.spawnSync([process.execPath, 'run', './test/desktop/fixtures/settings-media.fixture.tsx', scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 5000,
    });
    expect({ exit: res.exitCode, error: res.exitCode ? res.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(res.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
