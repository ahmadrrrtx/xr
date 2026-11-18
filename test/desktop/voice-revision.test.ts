import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
for (const scenario of ['serial-writes', 'late-status', 'new-engine', 'write-conflict', 'pending-conflict']) {
  test(`voice revision: ${scenario}`, () => {
    const res = Bun.spawnSync([process.execPath, 'run', './test/desktop/fixtures/voice-revision.fixture.ts', scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 5000,
    });
    expect({ exit: res.exitCode, error: res.exitCode ? res.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(res.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
